import {GameFonts, useGameFonts} from "./GameFonts";
import {ResourceLoading} from "./ResourceLoading";
import {XmlTree} from "./XmlTree";
import {invoke} from '@tauri-apps/api/core';
import {useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent} from 'react';
import {InterfacePreview} from './InterfacePreview';

export function InterfaceEditor({
                                    text,
                                    entries,
                                    onChange,
                                    disabled,
                                    onOpenDialog,
                                    initialView,
                                    onViewChange,
                                    fileName
                                }: {
    text: string;
    entries: { name: string }[];
    onChange: (text: string) => void;
    disabled: boolean;
    onOpenDialog?: (file: string) => void;
    fileName?: string;
    initialView?: { selection: number; zoom: number };
    onViewChange?: (view: { selection: number; zoom: number }) => void;
}) {
    const gameFonts = useGameFonts(entries);
    const [selection, setSelection] = useState(initialView?.selection ?? 0);
    const [zoom, setZoom] = useState(initialView?.zoom ?? 1);
    useEffect(() => {
        onViewChange?.({selection, zoom});
    }, [selection, zoom, onViewChange]);
    const [undo, setUndo] = useState<string[]>([]), [redo, setRedo] = useState<string[]>([]);
    const [error, setError] = useState('');
    const [newType, setNewType] = useState('STILLIMAGEBUTTON');
    const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
    const [rename, setRename] = useState<string | null>(null);
    const types = ['STILLIMAGEBUTTON', 'LABEL', 'EDIT', 'IMAGEPICTURE', 'CHECK', 'RADIO', 'LIST', 'COMBO', 'TREE', 'PROGRESS', 'SLIDER', 'SCROLL', 'TEXT', 'VERTICALTEXT', 'SUBDIALOG', 'CONSOLE', 'WINDOWPICTURE'];
    const [grid, setGrid] = useState(8), [snap, setSnap] = useState(true);
    const [treeWidth, setTreeWidth] = useState(190), [propertiesWidth, setPropertiesWidth] = useState(240);

    function resizePanel(event: ReactPointerEvent<HTMLDivElement>, side: 'tree' | 'properties') {
        const target = event.currentTarget, start = event.clientX;
        const width = side === 'tree' ? treeWidth : propertiesWidth;
        target.setPointerCapture(event.pointerId);
        const move = (e: PointerEvent) => {
            const next = Math.max(120, Math.min(600, width + (e.clientX - start) * (side === 'tree' ? 1 : -1)));
            (side === 'tree' ? setTreeWidth : setPropertiesWidth)(next);
        };
        const end = () => {
            target.removeEventListener('pointermove', move);
            target.removeEventListener('pointerup', end);
            target.removeEventListener('pointercancel', end);
        };
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', end);
        target.addEventListener('pointercancel', end);
    }

    const doc = useMemo(() => new DOMParser().parseFromString(text.replace(/^[\s\uFEFF]+/, '').replace(/\u0000+$/, ''), 'application/xml'), [text]);
    const nodes = Array.from(doc.getElementsByTagName('*'));
    const selected = nodes[selection];
    const valid = !doc.querySelector('parsererror') && nodes.some(e => e.tagName.toUpperCase() === 'DIALOG');
    const root = nodes.find(e => e.tagName.toUpperCase() === 'DIALOG');
    const isControl = !!selected && selected.parentElement === root && types.includes(selected.tagName.toUpperCase());
    const editingText = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest('input,textarea,select,[contenteditable="true"]');

    function openDialog(index: number) {
        if (disabled) return;
        const element = nodes[index];
        const resource = element?.getAttribute('FileName');
        if (resource) {
            if (/\.xml$/i.test(resource)) onOpenDialog?.(resource);
            else void invoke('open_resource_window', {name: resource}).catch(e => setError(String(e)));
            return;
        }
        if (element?.tagName.toUpperCase() !== 'SUBDIALOG') return;
        const file = element.getAttribute('DialogFile');
        if (!file) {
            setError('У SUBDIALOG не указан DialogFile');
            return;
        }
        onOpenDialog?.(file);
    }

    function insert(source: Element, offset = true) {
        if (disabled || !root || !types.includes(source.tagName.toUpperCase())) return;
        const clone = doc.importNode(source, true);
        const used = new Set(nodes.map(e => e.getAttribute('Name')).filter(Boolean));
        for (const element of [clone, ...Array.from(clone.getElementsByTagName('*'))]) {
            const base = element.getAttribute('Name');
            if (!base) continue;
            let name = base, suffix = 1;
            while (used.has(name)) name = `${base}_${suffix++}`;
            element.setAttribute('Name', name);
            used.add(name);
        }
        if (offset) for (const axis of ['x', 'y']) {
            const raw = Number(clone.getAttribute(axis) ?? 0);
            clone.setAttribute(axis, String((Number.isFinite(raw) ? raw : 0) + (snap ? grid : 8)));
        }
        root.appendChild(clone);
        setSelection(Array.from(doc.getElementsByTagName('*')).indexOf(clone));
        commit();
    }

    function create() {
        const element = doc.createElement(newType);
        for (const [name, value] of Object.entries({
            Name: newType,
            x: '16',
            y: '16',
            Width: '120',
            Height: '28'
        })) element.setAttribute(name, value);
        const label = doc.createElement('Text');
        label.setAttribute('String', newType);
        label.setAttribute('FontSize', '12');
        element.appendChild(label);
        insert(element, false);
    }

    function remove() {
        if (!isControl || disabled) return;
        selected.remove();
        setSelection(0);
        commit();
    }

    function pasteXml(xml: string) {
        const source = new DOMParser().parseFromString(xml.replace(/^\uFEFF/, ''), 'application/xml');
        if (source.querySelector('parsererror') || !types.includes(source.documentElement.tagName.toUpperCase())) {
            setError('Буфер должен содержать XML одного элемента AUInterface');
            return;
        }
        insert(source.documentElement);
    }

    async function clipboard(action: 'copy' | 'paste') {
        setMenu(null);
        try {
            if (action === 'copy' && isControl) await navigator.clipboard.writeText(new XMLSerializer().serializeToString(selected));
            if (action === 'paste' && !disabled) pasteXml(await navigator.clipboard.readText());
        } catch {
            setError('Нет доступа к буферу обмена. Используйте Ctrl+C / Ctrl+V в дереве.');
        }
    }

    function commit() {
        setUndo(old => [...old.slice(-99), text]);
        setRedo([]);
        const prefix = text.startsWith('\uFEFF') ? '\uFEFF' : '';
        onChange(prefix + new XMLSerializer().serializeToString(doc));
        setError('');
    }

    function change(name: string, value: string) {
        if (!selected || disabled) return;
        if (name === 'Name' && nodes.some(n => n !== selected && n.getAttribute('Name') === value)) {
            setError('Имя уже используется');
            return;
        }
        if (/^(x|y|Width|Height|FontSize)$/i.test(name) && (!Number.isFinite(Number(value)) || value.trim() === '' || (/^(Width|Height|FontSize)$/i.test(name) && Number(value) < 0))) {
            setError('Введите допустимое число');
            return;
        }
        selected.setAttribute(name, value);
        commit();
    }

    if (!valid) return <InterfacePreview fileName={fileName} text={text} entries={entries}/>;
    return <GameFonts.Provider value={gameFonts.names}>
        <div className="ui-editor" tabIndex={0} onCopy={event => {
            if (editingText(event.target) || !isControl) return;
            event.preventDefault();
            event.clipboardData.setData('text/plain', new XMLSerializer().serializeToString(selected));
        }} onPaste={event => {
            if (editingText(event.target) || disabled) return;
            event.preventDefault();
            const source = new DOMParser().parseFromString(event.clipboardData.getData('text/plain').replace(/^\uFEFF/, ''), 'application/xml');
            if (source.querySelector('parsererror') || !types.includes(source.documentElement.tagName.toUpperCase())) {
                setError('Буфер должен содержать XML одного элемента AUInterface');
                return;
            }
            insert(source.documentElement);
        }} onKeyDown={event => {
            if (editingText(event.target) || disabled) return;
            if (event.key === 'F2' && selected?.hasAttribute('Name')) {
                event.preventDefault();
                setRename(selected.getAttribute('Name'));
            }
            if (event.key === 'Delete') {
                event.preventDefault();
                remove();
            }
            if ((event.ctrlKey || event.metaKey) && event.code === 'KeyD' && isControl) {
                event.preventDefault();
                event.stopPropagation();
                insert(selected);
            }
        }}>
            {menu && <div className="xml-context-backdrop" onPointerDown={() => setMenu(null)} onContextMenu={e => {
                e.preventDefault();
                setMenu(null);
            }}>
                <div role="menu" aria-label="Действия элемента" className="xml-context-menu" style={{
                    left: Math.max(0, Math.min(menu.x, window.innerWidth - 230)),
                    top: Math.max(0, Math.min(menu.y, window.innerHeight - 280))
                }} onPointerDown={e => e.stopPropagation()} onKeyDown={e => {
                    if (e.key === 'Escape') setMenu(null);
                }}>
                    <button role="menuitem" autoFocus disabled={disabled} onClick={() => {
                        setMenu(null);
                        create();
                    }}>＋ Создать {newType}</button>
                    <button role="menuitem" disabled={disabled || !isControl} onClick={() => {
                        setMenu(null);
                        insert(selected);
                    }}>⧉ Дублировать <kbd>Ctrl+D</kbd></button>
                    <button role="menuitem" disabled={!isControl}
                            onClick={() => void clipboard('copy')}>Копировать <kbd>Ctrl+C</kbd></button>
                    <button role="menuitem" disabled={disabled}
                            onClick={() => void clipboard('paste')}>Вставить <kbd>Ctrl+V</kbd></button>
                    <button role="menuitem" disabled={disabled || !selected?.hasAttribute('Name')} onClick={() => {
                        setMenu(null);
                        setRename(selected.getAttribute('Name'));
                    }}>✎ Переименовать <kbd>F2</kbd></button>
                    <button role="menuitem" disabled={disabled || !isControl} onClick={() => {
                        setMenu(null);
                        remove();
                    }}>Удалить <kbd>Delete</kbd></button>
                </div>
            </div>}
            {rename !== null && <form className="xml-rename" onSubmit={e => {
                e.preventDefault();
                if (!rename.trim()) {
                    setError('Имя не может быть пустым');
                    return;
                }
                if (nodes.some(n => n !== selected && n.getAttribute('Name') === rename.trim())) {
                    setError('Имя уже используется');
                    return;
                }
                change('Name', rename.trim());
                setRename(null);
            }}>
                <label>Имя элемента <input autoFocus value={rename} onChange={e => setRename(e.target.value)}
                                           onFocus={e => e.target.select()} onKeyDown={e => {
                    if (e.key === 'Escape') setRename(null);
                }}/></label>
                <button disabled={disabled}>Применить</button>
                <button type="button" onClick={() => setRename(null)}>Отмена</button>
            </form>}
            {gameFonts.status.loading &&
                <ResourceLoading label="Загрузка игровых шрифтов" completed={gameFonts.status.completed}
                                 total={gameFonts.status.total}/>}
            {gameFonts.status.failed.length > 0 && <details>
                <summary>Не загружено шрифтов: {gameFonts.status.failed.length}</summary>
                <pre>{gameFonts.status.failed.join("\n")}</pre>
            </details>}
            <div className="ui-editor-toolbar">
                <strong>Редактор AUInterface</strong>
                <select aria-label="Тип нового элемента" value={newType}
                        onChange={e => setNewType(e.target.value)}>{types.map(type => <option
                    key={type}>{type}</option>)}</select>
                <button disabled={disabled} onClick={create}>Создать</button>
                <button disabled={disabled || !isControl} onClick={() => insert(selected)}>Дублировать</button>
                <button disabled={disabled || !isControl} onClick={remove}>Удалить</button>
                <label><input type="checkbox" checked={snap}
                              onChange={e => setSnap(e.target.checked)}/> Привязка</label>
                <label>Сетка <select value={grid}
                                     onChange={e => setGrid(Number(e.target.value))}>{[1, 2, 4, 8, 16, 32].map(v =>
                    <option key={v}>{v}</option>)}</select> px</label>
                <button disabled={disabled || !undo.length} onClick={() => {
                    setRedo(old => [...old, text]);
                    onChange(undo[undo.length - 1]);
                    setUndo(old => old.slice(0, -1));
                }}>Отменить
                </button>
                <button disabled={disabled || !redo.length} onClick={() => {
                    setUndo(old => [...old, text]);
                    onChange(redo[redo.length - 1]);
                    setRedo(old => old.slice(0, -1));
                }}>Повторить
                </button>
            </div>
            <div className="ui-editor-workspace">
                <aside className="ui-editor-tree" style={{width: treeWidth}} aria-label="Структура интерфейса">
                    <XmlTree doc={doc} selection={selection} onOpen={openDialog} onSelect={index => {
                        setSelection(index);
                        setRename(null);
                    }} onContext={(_, x, y) => setMenu({x, y})}/>
                </aside>
                <div className="ui-panel-splitter" role="separator" aria-label="Ширина дерева"
                     aria-orientation="vertical" onPointerDown={e => resizePanel(e, 'tree')}/>
                <section className="ui-editor-canvas"><InterfacePreview fileName={fileName} text={text}
                                                                        entries={entries} initialZoom={zoom}
                                                                        onZoom={setZoom} selection={selection}
                                                                        onSelect={setSelection} onOpen={openDialog}
                                                                        disabled={disabled} grid={snap ? grid : 1}
                                                                        onGeometry={(index, values) => {
                                                                            if (disabled || !nodes[index]) return;
                                                                            for (const [key, value] of Object.entries(values)) nodes[index].setAttribute(key, String(value));
                                                                            setSelection(index);
                                                                            commit();
                                                                        }}/></section>
                <div className="ui-panel-splitter" role="separator" aria-label="Ширина свойств"
                     aria-orientation="vertical" onPointerDown={e => resizePanel(e, 'properties')}/>
                <aside className="ui-editor-properties" style={{width: propertiesWidth}}>
                    <strong>{selected?.tagName} · Свойства</strong>
                    <p>Все XML-атрибуты, включая ресурсы и команды. Enter или потеря фокуса — применить.</p>
                    {error && <p role="alert">{error}</p>}
                    {selected && Array.from(selected.attributes).map(a => <label
                        key={`${selection}:${a.name}:${a.value}`}>{a.name}<input disabled={disabled}
                                                                                 defaultValue={a.value} onBlur={e => {
                        if (e.target.value !== a.value) change(a.name, e.target.value);
                    }} onKeyDown={e => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                    }}/></label>)}
                    {selected && <form key={selection} onSubmit={e => {
                        e.preventDefault();
                        const data = new FormData(e.currentTarget);
                        const name = String(data.get('name') ?? '').trim();
                        if (!/^[A-Za-z_][\w.-]*$/.test(name)) {
                            setError('Недопустимое имя атрибута');
                            return;
                        }
                        change(name, String(data.get('value') ?? ''));
                    }}><input name="name" placeholder="Новый атрибут" required disabled={disabled}/><input name="value"
                                                                                                           placeholder="Значение"
                                                                                                           disabled={disabled}/>
                        <button disabled={disabled}>Добавить</button>
                    </form>}
                </aside>
            </div>
        </div>
    </GameFonts.Provider>;
}
