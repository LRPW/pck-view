import {EditorSwitch} from '../editor/EditorSwitch';
import {useColumnWidth} from '../editor/useColumnWidth';
import {canonicalFontName, UI_FONTS} from './ui-fonts';
import {GameFonts, useGameFonts} from "./GameFonts";
import {ResourceLoading} from "./ResourceLoading";
import {XmlTree} from "./XmlTree";
import {useResourceInvoke} from '../editor/resource-context';
import {type PointerEvent as ReactPointerEvent, useEffect, useMemo, useState} from 'react';
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
    const invoke = useResourceInvoke();
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
    const types = ['DIV', 'STILLIMAGEBUTTON', 'LABEL', 'EDIT', 'IMAGEPICTURE', 'CHECK', 'RADIO', 'LIST', 'COMBO', 'TREE', 'PROGRESS', 'SLIDER', 'SCROLL', 'TEXT', 'VERTICALTEXT', 'SUBDIALOG', 'CONSOLE', 'WINDOWPICTURE'];
    const [hiddenElements, setHiddenElements] = useState<string[]>([]);
    const [gridAnchor, setGridAnchor] = useState<[number, number]>([0, 0]);
    const [borders, setBorders] = useState(true);
    const [borderOverrides, setBorderOverrides] = useState<Record<string, boolean>>({});
    const borderKey = (element: Element) => element.getAttribute('Name') ?? String(nodes.indexOf(element));

    const [grid, setGrid] = useState(8), [snap, setSnap] = useState(true);
    const [treeWidth, setTreeWidth] = useColumnWidth('interface.tree', 190), [propertiesWidth, setPropertiesWidth] = useColumnWidth('interface.properties', 240);

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
    const selectedBorder = selected ? (borderOverrides[borderKey(selected)] ?? borders) : borders;
    const isControl = !!selected && (selected.parentElement === root || selected.parentElement?.tagName.toUpperCase() === 'DIV') && types.includes(selected.tagName.toUpperCase());
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
        const parent = selected?.tagName.toUpperCase() === 'DIV' ? selected : selected?.parentElement?.tagName.toUpperCase() === 'DIV' ? selected.parentElement : root;
        parent.appendChild(clone);
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
        if (newType === 'DIV') {
            element.setAttribute('Direction', 'row');
            element.setAttribute('AutoSize', 'true');
            element.setAttribute('Gap', '8');
            insert(element, false);
            return;
        }
        const label = doc.createElement('Text');
        label.setAttribute('String', newType);
        label.setAttribute('FontSize', '12');
        label.setAttribute('FontName', 'text');
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

    function align(axis: 'x' | 'y', position: 'start' | 'center' | 'end') {
        if (!isControl || disabled || !root) return;
        const container = selected.parentElement;
        if (container?.tagName.toUpperCase() === 'DIV') {
            container.setAttribute(axis === 'x' ? 'HorizontalAlign' : 'VerticalAlign', String(position === 'start' ? 0 : position === 'center' ? 1 : 2));
            commit();
            return;
        }
        const dimension = axis === 'x' ? 'Width' : 'Height';
        const read = (element: Element, name: string, fallback: number) => {
            const raw = Array.from(element.attributes).find(a => a.name.toLowerCase() === name.toLowerCase())?.value;
            return raw && Number.isFinite(Number(raw)) ? Number(raw) : fallback;
        };
        const available = read(root, dimension, axis === 'x' ? 800 : 600) - read(selected, dimension, axis === 'x' ? 100 : 22);
        const attribute = Array.from(selected.attributes).find(a => a.name.toLowerCase() === axis)?.name ?? axis;
        selected.setAttribute(attribute, String(position === 'start' ? 0 : Math.round(available / (position === 'center' ? 2 : 1))));
        commit();
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
                <EditorSwitch label="Привязка" showLabel checked={snap} change={setSnap}/>
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
            <div className="ui-editor-toolbar" role="group" aria-label="Выравнивание и рамки">
                <div className="ui-ribbon-group" role="group" aria-label="Выравнивание относительно окна">
                    <div className="ui-ribbon-buttons">
                        {(['x', 'y'] as const).map(axis => <div className="ui-ribbon-cluster" key={axis}>
                            {(['start', 'center', 'end'] as const).map((position, index) => {
                                const label = axis === 'x'
                                    ? ['По левому краю', 'По центру горизонтально', 'По правому краю'][index]
                                    : ['По верхнему краю', 'По центру вертикально', 'По нижнему краю'][index];
                                return <button key={position} className="ui-ribbon-button"
                                               title={label + (selected?.parentElement?.tagName.toUpperCase() === 'DIV' ? ' — содержимое DIV' : ' относительно окна')}
                                               aria-label={label} disabled={disabled || !isControl}
                                               onClick={() => align(axis, position)}>
                                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                        <g transform={axis === 'y' ? 'translate(24 0) rotate(90)' : undefined}>
                                            <path
                                                d={position === 'start' ? 'M4 3v18' : position === 'end' ? 'M20 3v18' : 'M12 3v18'}
                                                stroke="currentColor" strokeWidth="1.5"/>
                                            {[10, 6, 13].map((width, row) => <rect key={row}
                                                                                   x={position === 'start' ? 6 : position === 'end' ? 18 - width : 12 - width / 2}
                                                                                   y={5 + row * 5} width={width}
                                                                                   height="3" rx=".5"
                                                                                   fill="currentColor"/>)}
                                        </g>
                                    </svg>
                                </button>;
                            })}
                        </div>)}
                    </div>
                    <small>{selected?.parentElement?.tagName.toUpperCase() === 'DIV' ? 'Содержимое DIV' : 'Выравнивание по окну'}</small>
                </div>
                <div className="ui-ribbon-group" role="group" aria-label="Якорь привязки к сетке">
                    <div className="ui-grid-anchor">
                        {[0, 0.5, 1].flatMap((y, row) => [0, 0.5, 1].map((x, column) => {
                            const label = [['Верхний левый', 'Верхний центр', 'Верхний правый'], ['Середина слева', 'Центр', 'Середина справа'], ['Нижний левый', 'Нижний центр', 'Нижний правый']][row][column];
                            return <button key={x + ':' + y} className="ui-ribbon-button"
                                           aria-label={'Якорь: ' + label} title={'Якорь сетки: ' + label}
                                           aria-pressed={gridAnchor[0] === x && gridAnchor[1] === y}
                                           onClick={() => setGridAnchor([x, y])}>•</button>;
                        }))}
                    </div>
                    <small>Якорь сетки</small>
                </div>
                <div className="ui-ribbon-group" role="group" aria-label="Видимость рамок">
                    <div className="ui-ribbon-buttons">
                        <button className="ui-ribbon-button" aria-pressed={borders} aria-label="Рамки всех элементов"
                                title="Показать / скрыть рамки всех элементов" onClick={() => {
                            setBorders(!borders);
                            setBorderOverrides({});
                        }}>
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                 strokeWidth="1.5" aria-hidden="true">
                                <rect x="3" y="3" width="7" height="7"/>
                                <rect x="14" y="3" width="7" height="7"/>
                                <rect x="3" y="14" width="7" height="7"/>
                                <rect x="14" y="14" width="7" height="7"/>
                            </svg>
                        </button>
                        <button className="ui-ribbon-button" aria-pressed={selectedBorder} disabled={!isControl}
                                aria-label="Рамка выбранного элемента"
                                title="Показать / скрыть рамку выбранного элемента"
                                onClick={() => {
                                    if (selected) setBorderOverrides(old => ({
                                        ...old,
                                        [borderKey(selected)]: !selectedBorder
                                    }));
                                }}>
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                 strokeWidth="1.5" aria-hidden="true">
                                <rect x="5" y="5" width="14" height="14" strokeDasharray="3 2"/>
                                {[3, 17].flatMap(x => [3, 17].map(y => <rect key={x + ':' + y} x={x} y={y} width="4"
                                                                             height="4" fill="currentColor"
                                                                             stroke="none"/>))}
                            </svg>
                        </button>
                    </div>
                    <small>Рамки элементов</small>
                </div>
            </div>
            <div className="ui-editor-workspace">
                <aside className="ui-editor-tree" style={{width: treeWidth}} aria-label="Структура интерфейса">
                    <XmlTree onMove={disabled ? undefined : (source, target, inside) => {
                        const element = nodes[source], destination = nodes[target];
                        const parent = inside ? destination : destination?.parentElement;
                        if (!element || !parent || destination === element || element.contains(parent) || !(parent === root || parent.tagName.toUpperCase() === 'DIV') || !types.includes(element.tagName.toUpperCase())) return;
                        parent.insertBefore(element, inside ? null : destination);
                        setSelection(Array.from(doc.getElementsByTagName('*')).indexOf(element));
                        commit();
                    }} hiddenElements={hiddenElements}
                             onToggleVisibility={name => setHiddenElements(old => old.includes(name) ? old.filter(n => n !== name) : [...old, name])}
                             doc={doc} selection={selection} onOpen={openDialog} onSelect={index => {
                        setSelection(index);
                        setRename(null);
                    }} onContext={(_, x, y) => setMenu({x, y})}/>
                </aside>
                <div className="ui-panel-splitter" role="separator" aria-label="Ширина дерева"
                     aria-orientation="vertical" onPointerDown={e => resizePanel(e, 'tree')}/>
                <section className="ui-editor-canvas"><InterfacePreview fileName={fileName} text={text}
                                                                        entries={entries} initialZoom={zoom}
                                                                        hiddenElements={hiddenElements}
                                                                        borders={borders}
                                                                        borderOverrides={borderOverrides}
                                                                        gridAnchor={gridAnchor}
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
                    {selected?.tagName.toUpperCase() === 'DIV' && <fieldset>
                        <legend>Flex контейнер</legend>
                        <p>При автосайзе размер равен содержимому. Для выравнивания в свободном пространстве отключите
                            автосайз и задайте Width/Height.</p>
                        <label>Направление<select disabled={disabled}
                                                  value={selected.getAttribute('Direction') ?? 'row'}
                                                  onChange={e => change('Direction', e.target.value)}>
                            <option value="row">Горизонтально</option>
                            <option value="column">Вертикально</option>
                        </select></label>
                        <EditorSwitch label="Размер по детям" showLabel disabled={disabled}
                                      checked={selected.getAttribute('AutoSize') !== 'false'}
                                      change={checked => change('AutoSize', String(checked))}/>
                        {['HorizontalAlign', 'VerticalAlign'].map(key => <label key={key}>{key}<select
                            disabled={disabled} value={selected.getAttribute(key) ?? '0'}
                            onChange={e => change(key, e.target.value)}>
                            <option value="0">Начало</option>
                            <option value="1">Центр</option>
                            <option value="2">Конец</option>
                        </select></label>)}
                        {['Gap', 'Padding'].map(key => <label key={key}>{key}<input key={text + key} type="number"
                                                                                    min="0" disabled={disabled}
                                                                                    defaultValue={selected.getAttribute(key) ?? '0'}
                                                                                    onBlur={e => {
                                                                                        if (e.target.value && Number(e.target.value) >= 0) change(key, e.target.value);
                                                                                    }}/></label>)}
                    </fieldset>}
                    {isControl && <fieldset>
                        <legend>Основные параметры</legend>
                        {(() => {
                            const tag = selected.tagName.toUpperCase();
                            if (!['LABEL', 'EDIT', 'LIST', 'COMBO', 'CHECK', 'RADIO', 'VERTICALTEXT'].includes(tag)) return null;
                            const attribute = tag === 'EDIT' ? 'TextAlign' : 'Align';
                            const vertical = tag === 'LIST';
                            const labels = vertical ? ['Сверху', 'По центру', 'Снизу'] : ['Слева', 'По центру', 'Справа'];
                            const fallback = ['CHECK', 'RADIO'].includes(tag) ? '1' : tag === 'VERTICALTEXT' ? '2' : '0';
                            return <div className="ui-property-align">
                                <span>{attribute}{vertical ? ' · по вертикали' : ''}</span>
                                <div className="ui-ribbon-buttons" role="group"
                                     aria-label={vertical ? 'Вертикальное выравнивание текста' : 'Выравнивание текста'}>
                                    {labels.map((label, index) => <button type="button" key={index}
                                                                          className="ui-ribbon-button"
                                                                          title={label} aria-label={label}
                                                                          disabled={disabled}
                                                                          aria-pressed={(selected.getAttribute(attribute) ?? fallback) === String(index)}
                                                                          onClick={() => change(attribute, String(index))}>
                                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                            <g transform={vertical ? 'translate(24 0) rotate(90)' : undefined}>
                                                {[16, 10, 16, 10].map((width, row) => <path key={row}
                                                                                            d={`M${index === 0 ? 4 : index === 1 ? 12 - width / 2 : 20 - width} ${5 + row * 4}h${width}`}
                                                                                            stroke="currentColor"
                                                                                            strokeWidth="1.7"
                                                                                            strokeLinecap="round"/>)}
                                            </g>
                                        </svg>
                                    </button>)}
                                </div>
                            </div>;
                        })()}
                        {['x', 'y', 'Width', 'Height', 'TextOffsetX', 'TextOffsetY', 'Command'].map(name => <label
                            key={selection + ':' + name + ':' + text}>{name}<input disabled={disabled}
                                                                                   defaultValue={selected.getAttribute(name) ?? ''}
                                                                                   placeholder="Не задано"
                                                                                   onBlur={e => {
                                                                                       if (e.target.value && e.target.value !== selected.getAttribute(name)) change(name, e.target.value);
                                                                                   }} onKeyDown={e => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                        }}/></label>)}
                    </fieldset>}
                    {error && <p role="alert">{error}</p>}
                    {isControl && <fieldset>
                        <legend>Положение в дереве</legend>
                        <select aria-label="Родитель элемента" disabled={disabled}
                                value={nodes.indexOf(selected.parentElement!)} onChange={e => {
                            const parent = nodes[Number(e.target.value)];
                            if (!parent || parent === selected || selected.contains(parent)) return;
                            parent.appendChild(selected);
                            setSelection(Array.from(doc.getElementsByTagName('*')).indexOf(selected));
                            commit();
                        }}>{nodes.filter(n => (n === root || n.tagName.toUpperCase() === 'DIV') && n !== selected && !selected.contains(n)).map(n =>
                            <option key={nodes.indexOf(n)}
                                    value={nodes.indexOf(n)}>{n.getAttribute('Name') ?? n.tagName}</option>)}</select>
                        <button disabled={disabled || !selected.previousElementSibling} onClick={() => {
                            selected.parentElement!.insertBefore(selected, selected.previousElementSibling);
                            setSelection(Array.from(doc.getElementsByTagName('*')).indexOf(selected));
                            commit();
                        }}>↑ Выше
                        </button>
                        <button disabled={disabled || !selected.nextElementSibling} onClick={() => {
                            const next = selected.nextElementSibling;
                            if (next) selected.parentElement!.insertBefore(next, selected);
                            setSelection(Array.from(doc.getElementsByTagName('*')).indexOf(selected));
                            commit();
                        }}>↓ Ниже
                        </button>
                    </fieldset>}
                    {selected && Array.from(selected.attributes).filter(a => {
                        const name = a.name.toLowerCase();
                        if (name === 'fontname') return false;
                        if (isControl && ['x', 'y', 'width', 'height', 'textoffsetx', 'textoffsety', 'command'].includes(name)) return false;
                        const tag = selected.tagName.toUpperCase();
                        if (tag === 'DIV' && ['direction', 'autosize', 'horizontalalign', 'verticalalign', 'gap', 'padding'].includes(name)) return false;
                        if (isControl && ['LABEL', 'EDIT', 'LIST', 'COMBO', 'CHECK', 'RADIO', 'VERTICALTEXT'].includes(tag) && name === (tag === 'EDIT' ? 'textalign' : 'align')) return false;
                        return true;
                    }).map(a => <label
                        key={`${selection}:${a.name}:${a.value}`}>{a.name}<input disabled={disabled}
                                                                                 defaultValue={a.value} onBlur={e => {
                        if (e.target.value !== a.value) change(a.name, e.target.value);
                    }} onKeyDown={e => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                    }}/></label>)}
                    {selected && (selected.hasAttribute('FontName') || selected.tagName.toUpperCase() === 'TEXT') &&
                        <label>FontName
                            <select aria-label="Шрифт" disabled={disabled}
                                    value={canonicalFontName(selected.getAttribute('FontName') ?? 'text')}
                                    onChange={e => change('FontName', e.target.value)}>
                                {UI_FONTS.map(font => <option key={font.name} value={font.name}>{font.name}</option>)}
                                {selected.getAttribute('FontName') && !UI_FONTS.some(font => font.name === canonicalFontName(selected.getAttribute('FontName')!)) &&
                                    <option
                                        value={selected.getAttribute('FontName')!}>{selected.getAttribute('FontName')}</option>}
                            </select>
                        </label>}
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
