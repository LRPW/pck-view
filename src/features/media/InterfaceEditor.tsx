import {DTF_TYPES} from '../editor/dtf-layout';
import {InterfaceProperties} from './InterfaceProperties';
import {ControllerGenerator} from './ControllerGenerator';
import {matchesShortcut} from '../../app/shortcuts';
import {message, t} from "../../i18n";
import {Alert, Box, Button, Field, Flex, Input, Select, Text} from "@chakra-ui/react";
import type {ComponentProps} from "react";
import {type PointerEvent as ReactPointerEvent, useEffect, useMemo, useState} from 'react';
import {AccordionItem, AccordionItemContent, AccordionItemTrigger, AccordionRoot} from "../../components/ui/accordion";
import {SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValueText} from "../../components/ui/select";
import {EditorSwitch} from '../editor/EditorSwitch';
import {useClientVersion, useResourceInvoke} from '../editor/resource-context';
import {selectCollection} from '../editor/select-collection';
import {useColumnWidth} from '../editor/useColumnWidth';
import {GameFonts, useGameFonts} from "./GameFonts";
import {InterfacePreview} from './InterfacePreview';
import {ResourceLoading} from "./ResourceLoading";
import {canonicalFontName, normalizeUiFontNames, xmlFontName} from './ui-fonts';
import {XmlTree} from "./XmlTree";

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
    const [selections, setSelections] = useState<number[]>([]);
    const [zoom, setZoom] = useState(initialView?.zoom ?? 1);
    useEffect(() => {
        onViewChange?.({selection, zoom});
    }, [selection, zoom, onViewChange]);
    const [undo, setUndo] = useState<string[]>([]), [redo, setRedo] = useState<string[]>([]);
    const [error, setError] = useState('');
    const lrpw = useClientVersion() === '1.5.5-lrpw';
    const [chosenType, setNewType] = useState('STILLIMAGEBUTTON');
    const newType = !lrpw && chosenType === 'DIV' ? 'STILLIMAGEBUTTON' : chosenType;
    const [menu, setMenu] = useState<{ x: number; y: number; element?: boolean } | null>(null);
    const [createMenu, setCreateMenu] = useState(false);
    const [rename, setRename] = useState<string | null>(null);
    const types = ['DIV', 'STILLIMAGEBUTTON', 'LABEL', 'EDIT', 'IMAGEPICTURE', 'CHECK', 'RADIO', 'LIST', 'COMBO', 'TREE', 'PROGRESS', 'SLIDER', 'SCROLL', 'TEXT', 'VERTICALTEXT', 'SUBDIALOG', 'CONSOLE', 'WINDOWPICTURE'].filter(type => (lrpw || type !== 'DIV') && (!fileName?.toLowerCase().endsWith('.dtf') || DTF_TYPES.includes(type)));
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
            setError(t("SUBDIALOG has no DialogFile"));
            return;
        }
        onOpenDialog?.(file);
    }

    function insert(source: Element, offset = true) {
        if (!lrpw && [source, ...Array.from(source.querySelectorAll('*'))].some(element => element.tagName.toUpperCase() === 'DIV' || Array.from(element.attributes).some(attribute => attribute.name.toLowerCase() === 'fontname' && canonicalFontName(attribute.value) === 'mono'))) {
            setError(t('DIV and mono require 1.5.5 (LRPW)'));
            return;
        }
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

    function create(type = newType) {
        const element = doc.createElement(type);
        for (const [name, value] of Object.entries({
            Name: type,
            x: '16',
            y: '16',
            Width: '120',
            Height: '28'
        })) element.setAttribute(name, value);
        if (type === 'DIV') {
            element.setAttribute('Direction', 'row');
            element.setAttribute('AutoSize', 'true');
            element.setAttribute('Gap', '8');
            insert(element, false);
            return;
        }
        if (fileName?.toLowerCase().endsWith('.dtf') && !['LABEL', 'STILLIMAGEBUTTON'].includes(type)) {
            insert(element, false);
            return;
        }
        const label = doc.createElement('Text');
        label.setAttribute('String', type);
        label.setAttribute('FontSize', '12');
        label.setAttribute('FontName', xmlFontName('text'));
        element.appendChild(label);
        insert(element, false);
    }

    function remove() {
        if (!isControl || disabled) return;
        const targets = (selections.length ? selections : [selection]).map(index => nodes[index]).filter(element => element && element !== root);
        for (const element of targets) element.remove();
        setSelections([]);
        setSelection(0);
        commit();
    }

    function pasteXml(xml: string) {
        const source = new DOMParser().parseFromString(xml.replace(/^\uFEFF/, ''), 'application/xml');
        if (source.querySelector('parsererror') || !types.includes(source.documentElement.tagName.toUpperCase())) {
            setError(t("The clipboard must contain one AUInterface XML element"));
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
            setError(t("Clipboard access is unavailable. Use Ctrl+C / Ctrl+V in the tree."));
        }
    }

    function commit() {
        setUndo(old => [...old.slice(-99), text]);
        setRedo([]);
        const prefix = text.startsWith('\uFEFF') ? '\uFEFF' : '';
        onChange(normalizeUiFontNames(prefix + new XMLSerializer().serializeToString(doc)));
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

    function changeFont({value}: { value: string[] }) {
        change('FontName', xmlFontName(value[0]));
    }

    function change(name: string, value: string) {
        if (!lrpw && name.toLowerCase() === 'fontname' && canonicalFontName(value) === 'mono') {
            setError(t('DIV and mono require 1.5.5 (LRPW)'));
            return;
        }
        if (!selected || disabled) return;
        if (name === 'Name' && nodes.some(n => n !== selected && n.getAttribute('Name') === value)) {
            setError(t("This name is already in use"));
            return;
        }
        if (/^(x|y|Width|Height|FontSize)$/i.test(name) && (!Number.isFinite(Number(value)) || value.trim() === '' || (/^(Width|Height|FontSize)$/i.test(name) && Number(value) < 0))) {
            setError(t("Enter a valid number"));
            return;
        }
        if (value === '') {
            selected.removeAttribute(name);
            commit();
            return;
        }
        selected.setAttribute(name, name.toLowerCase() === 'fontname' ? xmlFontName(value) : value);
        commit();
    }

    if (!valid) return <InterfacePreview fileName={fileName} text={text} entries={entries}/>;
    const handleDivCopy: ComponentProps<"div">["onCopy"] = event => {
        if (editingText(event.target) || !isControl) return;
        event.preventDefault();
        event.clipboardData.setData('text/plain', new XMLSerializer().serializeToString(selected));
    };
    const handleDivPaste: ComponentProps<"div">["onPaste"] = event => {
        if (editingText(event.target) || disabled) return;
        event.preventDefault();
        const source = new DOMParser().parseFromString(event.clipboardData.getData('text/plain').replace(/^\uFEFF/, ''), 'application/xml');
        if (source.querySelector('parsererror') || !types.includes(source.documentElement.tagName.toUpperCase())) {
            setError(t("The clipboard must contain one AUInterface XML element"));
            return;
        }
        insert(source.documentElement);
    };
    const handleDivKeyDown: ComponentProps<"div">["onKeyDown"] = event => {
        if (editingText(event.target) || disabled) return;
        if (event.key === 'F2' && selected?.hasAttribute('Name')) {
            event.preventDefault();
            setRename(selected.getAttribute('Name'));
        }
        if (event.key === 'Delete') {
            event.preventDefault();
            remove();
        }
        if (matchesShortcut(event.nativeEvent, 'duplicate') && isControl) {
            event.preventDefault();
            event.stopPropagation();
            insert(selected);
        }
    };
    const handleFormSubmit: ComponentProps<"form">["onSubmit"] = e => {
        e.preventDefault();
        if (!rename?.trim()) {
            setError(t("The name cannot be empty"));
            return;
        }
        if (nodes.some(n => n !== selected && n.getAttribute('Name') === rename.trim())) {
            setError(t("This name is already in use"));
            return;
        }
        change('Name', rename.trim());
        setRename(null);
    };
    const handleButtonClick: ComponentProps<typeof Button>["onClick"] = () => {
        setRedo(old => [...old, text]);
        onChange(undo[undo.length - 1]);
        setUndo(old => old.slice(0, -1));
    };
    const handleButtonClick2: ComponentProps<typeof Button>["onClick"] = () => {
        setUndo(old => [...old, text]);
        onChange(redo[redo.length - 1]);
        setRedo(old => old.slice(0, -1));
    };
    const handleButtonClick3: ComponentProps<typeof Button>["onClick"] = () => {
        if (selected) setBorderOverrides(old => ({
            ...old,
            [borderKey(selected)]: !selectedBorder
        }));
    };
    const handleInterfacePreviewGeometry: ComponentProps<typeof InterfacePreview>["onGeometry"] = (index, values) => {
        if (disabled || !nodes[index]) return;
        if (selections.includes(index) && selections.length > 1 && values.x !== undefined && values.y !== undefined && values.Width === undefined) {
            const dx = values.x - Number(nodes[index].getAttribute('x') ?? 0),
                dy = values.y - Number(nodes[index].getAttribute('y') ?? 0);
            const elements = selections.map(i => nodes[i]).filter(Boolean);
            for (const element of elements) {
                if (elements.some(parent => parent !== element && parent.contains(element))) continue;
                element.setAttribute('x', String(Number(element.getAttribute('x') ?? 0) + dx));
                element.setAttribute('y', String(Number(element.getAttribute('y') ?? 0) + dy));
            }
        } else for (const [key, value] of Object.entries(values)) nodes[index].setAttribute(key, String(value));
        setSelection(index);
        commit();
    };
    const handleSelectRootValueChange: ComponentProps<typeof Select.Root>["onValueChange"] = async ({value: [value]}) => {
        const parent = nodes[Number(value)];
        if (!parent || parent === selected || selected.contains(parent)) return;
        parent.appendChild(selected);
        setSelection(Array.from(doc.getElementsByTagName('*')).indexOf(selected));
        commit();
    };
    const handleButtonClick4: ComponentProps<typeof Button>["onClick"] = () => {
        selected.parentElement!.insertBefore(selected, selected.previousElementSibling);
        setSelection(Array.from(doc.getElementsByTagName('*')).indexOf(selected));
        commit();
    };
    const handleButtonClick5: ComponentProps<typeof Button>["onClick"] = () => {
        const next = selected.nextElementSibling;
        if (next) selected.parentElement!.insertBefore(next, selected);
        setSelection(Array.from(doc.getElementsByTagName('*')).indexOf(selected));
        commit();
    };
    const handleFormSubmit2: ComponentProps<"form">["onSubmit"] = e => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const name = String(data.get('name') ?? '').trim();
        if (!/^[A-Za-z_][\w.-]*$/.test(name)) {
            setError(t("Invalid attribute name"));
            return;
        }
        change(name, String(data.get('value') ?? ''));
    };
    return <GameFonts.Provider value={gameFonts.names}>
        <Box className="ui-editor" tabIndex={0} onCopy={handleDivCopy} onPaste={handleDivPaste}
             onKeyDown={handleDivKeyDown}>
            {menu && <Box className="xml-context-backdrop" onPointerDown={() => setMenu(null)} onContextMenu={e => {
                e.preventDefault();
                setMenu(null);
            }}>
                <Box role="menu" aria-label={t("Element actions")} className="xml-context-menu" style={{
                    left: Math.max(0, Math.min(menu.x, window.innerWidth - 230)),
                    top: Math.max(0, Math.min(menu.y, window.innerHeight - 280))
                }} onPointerDown={e => e.stopPropagation()} onKeyDown={e => {
                    if (e.key === 'Escape') setMenu(null);
                }}>
                    <Box position="relative" onMouseEnter={() => setCreateMenu(true)}>
                        <Button role="menuitem" autoFocus disabled={disabled} aria-haspopup="menu"
                                aria-expanded={createMenu}
                                onClick={() => setCreateMenu(value => !value)} onKeyDown={event => {
                            if (event.key === 'ArrowRight') {
                                event.preventDefault();
                                setCreateMenu(true);
                            }
                        }}>{t('Create')} <span>›</span></Button>
                        {createMenu && <Box role="menu" aria-label={t('New element type')} position="absolute"
                                            left={menu.x > window.innerWidth - 470 ? 'auto' : '100%'}
                                            right={menu.x > window.innerWidth - 470 ? '100%' : 'auto'} top="0"
                                            width="220px" maxH="min(480px, 65vh)" overflowY="auto" bg="bg.panel"
                                            borderWidth="1px" rounded="md" shadow="lg" p="1" zIndex="1">
                            {types.map(type => <Button key={type} role="menuitem" variant="ghost" size="sm" width="full"
                                                       justifyContent="start" onClick={() => {
                                setMenu(null);
                                setCreateMenu(false);
                                create(type);
                            }}>{type}</Button>)}
                        </Box>}
                    </Box>
                    {menu.element && <>
                        <Button role="menuitem" disabled={disabled || !isControl} onClick={() => {
                            setMenu(null);
                            insert(selected);
                        }}>{t("⧉ Duplicate ")}</Button>
                        <Button role="menuitem" disabled={disabled || !isControl} onClick={() => {
                            setMenu(null);
                            insert(selected, false);
                        }}>{t('Clone')}</Button>
                        <Button role="menuitem" disabled={!isControl}
                                onClick={() => void clipboard('copy')}>{t("Copy ")}<kbd>Ctrl+C</kbd></Button>
                        <Button role="menuitem" disabled={disabled}
                                onClick={() => void clipboard('paste')}>{t("Paste ")}<kbd>Ctrl+V</kbd></Button>
                        <Button role="menuitem" disabled={disabled || !selected?.hasAttribute('Name')} onClick={() => {
                            setMenu(null);
                            setRename(selected.getAttribute('Name'));
                        }}>{t("✎ Rename ")}<kbd>F2</kbd></Button>
                        <Button role="menuitem" disabled={disabled || !isControl} onClick={() => {
                            setMenu(null);
                            remove();
                        }}>{t("Delete ")}<kbd>Delete</kbd></Button>
                    </>}
                </Box>
            </Box>}
            {rename !== null && <form className="xml-rename" onSubmit={handleFormSubmit}>
                <Field.Root width="auto"><Field.Label>{t("Element name")}</Field.Label><Input autoFocus value={rename}
                                                                                              onChange={e => setRename(e.target.value)}
                                                                                              onFocus={e => e.target.select()}
                                                                                              onKeyDown={e => {
                                                                                                  if (e.key === 'Escape') setRename(null);
                                                                                              }}/></Field.Root>
                <Button disabled={disabled}>{t("Apply")}</Button>
                <Button type="button" onClick={() => setRename(null)}>{t("Cancel")}</Button>
            </form>}
            {gameFonts.status.loading &&
                <ResourceLoading label={t("Loading game fonts")} completed={gameFonts.status.completed}
                                 total={gameFonts.status.total}/>}
            {gameFonts.status.failed.length > 0 &&
                <AccordionRoot collapsible defaultValue={false ? ["content"] : []}><AccordionItem
                    value="content"><AccordionItemTrigger>{t("Fonts not loaded: ")}{gameFonts.status.failed.length}</AccordionItemTrigger><AccordionItemContent>
                    <pre>{gameFonts.status.failed.join("\n")}</pre>
                </AccordionItemContent></AccordionItem></AccordionRoot>}
            <Flex align="center" justify="space-between" gap="3" px="3" py="2" borderBottomWidth="1px" bg="bg.panel">
                <Text fontSize="sm" fontWeight="semibold">{t("AUInterface editor")}</Text>
                <ControllerGenerator xml={text} fileName={fileName ?? 'Interface.xml'}/>
            </Flex>
            <Flex align="center" gap="3" wrap="wrap" px="3" py="2" bg="bg.panel" css={{'& button': {flexShrink: 0}}}>
                <Flex align="center" gap="1.5">
                    <SelectRoot size="sm" lazyMount unmountOnExit width="200px" minW="160px" flexShrink="0"
                                collection={selectCollection(<>{types.map(type => <option
                                    key={type}>{type}</option>)}</>)} value={[String(newType)]}
                                onValueChange={async ({value: [value]}) => setNewType(value)}
                                aria-label={t("New element type")}><SelectTrigger><SelectValueText/></SelectTrigger><SelectContent><Select.Context>{select => select.collection.items.map(item =>
                        <SelectItem key={select.collection.getItemValue(item)}
                                    item={item}>{t(select.collection.stringifyItem(item))}</SelectItem>)}</Select.Context></SelectContent></SelectRoot>
                    <Button size="sm" colorPalette="teal" disabled={disabled}
                            onClick={() => create()}>{t("Create")}</Button>
                </Flex>
                <Flex align="center" gap="1.5" borderLeftWidth="1px" pl="3">
                    <Button size="sm" variant="ghost" disabled={disabled || !isControl}
                            onClick={() => insert(selected)}>{t("Duplicate")}</Button>
                    <Button size="sm" variant="ghost" disabled={disabled || !isControl}
                            onClick={remove}>{t("Delete")}</Button>
                </Flex>
                <Flex align="center" gap="3" borderLeftWidth="1px" pl="3">
                    <EditorSwitch label={t("Snapping")} showLabel checked={snap} change={setSnap}/>
                    <Field.Root width="auto" flexDirection="row" alignItems="center" gap="2"><Field.Label mb="0"
                                                                                                          whiteSpace="nowrap">{t("Grid px")}</Field.Label><SelectRoot
                        size="sm" lazyMount
                        unmountOnExit width="76px" minW="76px"
                        collection={selectCollection(<>{[1, 2, 4, 8, 16, 32].map(v =>
                            <option
                                key={v}>{v}</option>)}</>)}
                        value={[String(grid)]}
                        onValueChange={async ({value: [value]}) => setGrid(Number(value))}><SelectTrigger><SelectValueText/></SelectTrigger><SelectContent><Select.Context>{select => select.collection.items.map(item =>
                        <SelectItem key={select.collection.getItemValue(item)}
                                    item={item}>{t(select.collection.stringifyItem(item))}</SelectItem>)}</Select.Context></SelectContent></SelectRoot></Field.Root>
                </Flex>
                <Flex align="center" gap="1" ml="auto">
                    <Button size="sm" variant="ghost" disabled={disabled || !undo.length}
                            onClick={handleButtonClick}>{t("Undo")}</Button>
                    <Button size="sm" variant="ghost" disabled={disabled || !redo.length}
                            onClick={handleButtonClick2}>{t("Retry")}</Button>
                </Flex>
            </Flex>
            <Box className="ui-editor-toolbar" px="3" py="2" bg="bg.subtle" borderTopWidth="1px" borderBottomWidth="1px"
                 role="group" aria-label={t("Alignment and borders")}>
                <Box className="ui-ribbon-group" role="group" aria-label={t("Align relative to the window")}>
                    <Box className="ui-ribbon-buttons">
                        {(['x', 'y'] as const).map(axis => <Box className="ui-ribbon-cluster" key={axis}>
                            {(['start', 'center', 'end'] as const).map((position, index) => {
                                const label = axis === 'x'
                                    ? [t("Align left"), t("Center horizontally"), t("Align right")][index]
                                    : [t("Align top"), t("Center vertically"), t("Align bottom")][index];
                                return <Button key={position} className="ui-ribbon-button"
                                               title={label + (selected?.parentElement?.tagName.toUpperCase() === 'DIV' ? t(" — DIV content") : t(" relative to the window"))}
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
                                </Button>;
                            })}
                        </Box>)}
                    </Box>
                    <small>{selected?.parentElement?.tagName.toUpperCase() === 'DIV' ? t("DIV content") : t("Window alignment")}</small>
                </Box>
                <Box className="ui-ribbon-group" role="group" aria-label={t("Grid snap anchor")}>
                    <Box className="ui-grid-anchor">
                        {[0, 0.5, 1].flatMap((y, row) => [0, 0.5, 1].map((x, column) => {
                            const label = [[t("Top left"), t("Top center"), t("Top right")], [t("Middle left"), t("Center"), t("Middle right")], [t("Bottom left"), t("Bottom center"), t("Bottom right")]][row][column];
                            return <Button key={x + ':' + y} className="ui-ribbon-button"
                                           aria-label={"Anchor: " + label} title={"Grid anchor: " + label}
                                           aria-pressed={gridAnchor[0] === x && gridAnchor[1] === y}
                                           onClick={() => setGridAnchor([x, y])}>•</Button>;
                        }))}
                    </Box>
                    <small>{t("Grid anchor")}</small>
                </Box>
                <Box className="ui-ribbon-group" role="group" aria-label={t("Border visibility")}>
                    <Box className="ui-ribbon-buttons">
                        <Button className="ui-ribbon-button" aria-pressed={borders}
                                aria-label={t("All element borders")}
                                title={t("Show / hide all element borders")} onClick={() => {
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
                        </Button>
                        <Button className="ui-ribbon-button" aria-pressed={selectedBorder} disabled={!isControl}
                                aria-label={t("Selected element border")}
                                title={t("Show / hide the selected element border")}
                                onClick={handleButtonClick3}>
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                 strokeWidth="1.5" aria-hidden="true">
                                <rect x="5" y="5" width="14" height="14" strokeDasharray="3 2"/>
                                {[3, 17].flatMap(x => [3, 17].map(y => <rect key={x + ':' + y} x={x} y={y} width="4"
                                                                             height="4" fill="currentColor"
                                                                             stroke="none"/>))}
                            </svg>
                        </Button>
                    </Box>
                    <small>{t("Element borders")}</small>
                </Box>
            </Box>
            <Box className="ui-editor-workspace">
                <aside className="ui-editor-tree" style={{width: treeWidth}} aria-label={t("Interface structure")}
                       onContextMenu={event => {
                           if (event.defaultPrevented) return;
                           event.preventDefault();
                           setSelection(nodes.indexOf(root!));
                           setCreateMenu(false);
                           setMenu({x: event.clientX, y: event.clientY, element: false});
                       }}>
                    <XmlTree onMove={disabled ? undefined : (source, target, inside) => {
                        const element = nodes[source], destination = nodes[target];
                        const parent = inside ? destination : destination?.parentElement;
                        if (!element || !parent || destination === element || element.contains(parent) || !(parent === root || parent.tagName.toUpperCase() === 'DIV') || !types.includes(element.tagName.toUpperCase())) return;
                        const moved = (selections.includes(source) ? selections : [source]).map(index => nodes[index]).filter(node => node && types.includes(node.tagName.toUpperCase()));
                        const top = moved.filter(node => !moved.some(other => other !== node && other.contains(node)));
                        if (top.some(node => node === parent || node.contains(parent) || node === destination)) return;
                        for (const node of top) parent.insertBefore(node, inside ? null : destination);
                        const reordered = Array.from(doc.getElementsByTagName('*'));
                        setSelections(moved.map(node => reordered.indexOf(node)));
                        setSelection(Array.from(doc.getElementsByTagName('*')).indexOf(element));
                        commit();
                    }} hiddenElements={hiddenElements}
                             onToggleVisibility={name => setHiddenElements(old => old.includes(name) ? old.filter(n => n !== name) : [...old, name])}
                             doc={doc} selection={selection} selections={selections} onSelections={setSelections}
                             onOpen={openDialog} onSelect={index => {
                        setSelection(index);
                        setRename(null);
                    }} onContext={(index, x, y) => {
                        setSelection(index);
                        setCreateMenu(false);
                        setMenu({x, y, element: true});
                    }}/>
                </aside>
                <Box className="ui-panel-splitter" role="separator" aria-label={t("Tree width")}
                     aria-orientation="vertical" onPointerDown={e => resizePanel(e, 'tree')}/>
                <section className="ui-editor-canvas"><InterfacePreview fileName={fileName} text={text}
                                                                        entries={entries} initialZoom={zoom}
                                                                        hiddenElements={hiddenElements}
                                                                        borders={borders}
                                                                        borderOverrides={borderOverrides}
                                                                        gridAnchor={gridAnchor}
                                                                        onZoom={setZoom} selection={selection}
                                                                        selections={selections}
                                                                        onSelections={setSelections}
                                                                        onSelect={index => {
                                                                            setSelection(index);
                                                                        }} onOpen={openDialog}
                                                                        disabled={disabled} grid={snap ? grid : 1}
                                                                        onGeometry={handleInterfacePreviewGeometry}/>
                </section>
                <Box className="ui-panel-splitter" role="separator" aria-label={t("Properties width")}
                     aria-orientation="vertical" onPointerDown={e => resizePanel(e, 'properties')}/>
                <aside className="ui-editor-properties" style={{width: propertiesWidth}}>
                    <strong>{selected?.tagName} {t(" · Properties")}</strong>
                    {selected?.tagName.toUpperCase() === 'DIV' && <fieldset>
                        <legend>{t("Flex container")}</legend>
                        <p>{t("Auto size follows the content. To align within free space, disable auto size and set Width/Height.")}</p>
                        <Field.Root width="auto"><Field.Label>{t("Direction")}</Field.Label><SelectRoot size="sm"
                                                                                                        lazyMount
                                                                                                        unmountOnExit
                                                                                                        minW="140px"
                                                                                                        collection={selectCollection(<>
                                                                                                            <option
                                                                                                                value="row">{t("Horizontal")}</option>
                                                                                                            <option
                                                                                                                value="column">{t("Vertical")}</option>
                                                                                                        </>)}
                                                                                                        value={[String(selected.getAttribute('Direction') ?? 'row')]}
                                                                                                        onValueChange={async ({value: [value]}) => change('Direction', value)}
                                                                                                        disabled={disabled}><SelectTrigger><SelectValueText/></SelectTrigger><SelectContent><Select.Context>{select => select.collection.items.map(item =>
                            <SelectItem key={select.collection.getItemValue(item)}
                                        item={item}>{t(select.collection.stringifyItem(item))}</SelectItem>)}</Select.Context></SelectContent></SelectRoot></Field.Root>
                        <EditorSwitch label={t("Size to content")} showLabel disabled={disabled}
                                      checked={selected.getAttribute('AutoSize') !== 'false'}
                                      change={checked => change('AutoSize', String(checked))}/>
                        {['HorizontalAlign', 'VerticalAlign'].map(key => <Field.Root width="auto"
                                                                                     key={key}><Field.Label>{t(key)}</Field.Label><SelectRoot
                            size="sm" lazyMount unmountOnExit minW="140px" collection={selectCollection(<>
                            <option value="0">{t("Start")}</option>
                            <option value="1">{t("Center")}</option>
                            <option value="2">{t("End")}</option>
                        </>)} value={[String(selected.getAttribute(key) ?? '0')]}
                            onValueChange={async ({value: [value]}) => change(key, value)}
                            disabled={disabled}><SelectTrigger><SelectValueText/></SelectTrigger><SelectContent><Select.Context>{select => select.collection.items.map(item =>
                            <SelectItem key={select.collection.getItemValue(item)}
                                        item={item}>{t(select.collection.stringifyItem(item))}</SelectItem>)}</Select.Context></SelectContent></SelectRoot></Field.Root>)}
                        {['Gap', 'Padding'].map(key => <Field.Root width="auto"
                                                                   key={key}><Field.Label>{t(key)}</Field.Label><Input
                            key={text + key} type="number"
                            min="0" disabled={disabled}
                            defaultValue={selected.getAttribute(key) ?? '0'}
                            onBlur={e => {
                                if (e.target.value && Number(e.target.value) >= 0) change(key, e.target.value);
                            }}/></Field.Root>)}
                    </fieldset>}
                    {error && <Alert.Root status="error" size="sm"
                                          role="alert"><Alert.Indicator/><Alert.Content>{message(error)}</Alert.Content></Alert.Root>}
                    {isControl && <fieldset>
                        <legend>{t("Position in tree")}</legend>
                        <SelectRoot size="sm" lazyMount unmountOnExit minW="140px"
                                    collection={selectCollection(<>{nodes.filter(n => (n === root || n.tagName.toUpperCase() === 'DIV') && n !== selected && !selected.contains(n)).map(n =>
                                        <option key={nodes.indexOf(n)}
                                                value={nodes.indexOf(n)}>{n.getAttribute('Name') ?? n.tagName}</option>)}</>)}
                                    value={[String(nodes.indexOf(selected.parentElement!))]}
                                    onValueChange={handleSelectRootValueChange} aria-label={t("Element parent")}
                                    disabled={disabled}><SelectTrigger><SelectValueText/></SelectTrigger><SelectContent><Select.Context>{select => select.collection.items.map(item =>
                            <SelectItem key={select.collection.getItemValue(item)}
                                        item={item}>{t(select.collection.stringifyItem(item))}</SelectItem>)}</Select.Context></SelectContent></SelectRoot>
                        <Button disabled={disabled || !selected.previousElementSibling}
                                onClick={handleButtonClick4}>{t("↑ Move up")}</Button>
                        <Button disabled={disabled || !selected.nextElementSibling}
                                onClick={handleButtonClick5}>{t("↓ Move down")}</Button>
                    </fieldset>}
                    {selected &&
                        <InterfaceProperties allowMono={lrpw} element={selected} disabled={disabled} change={change}/>}
                    {selected &&
                        <form key={selection} onSubmit={handleFormSubmit2}><Field.Root width="auto"><Input name="name"
                                                                                                           placeholder={t("New attribute")}
                                                                                                           required
                                                                                                           disabled={disabled}/></Field.Root><Field.Root
                            width="auto"><Input
                            name="value"
                            placeholder={t("Value")}
                            disabled={disabled}/></Field.Root>
                            <Button disabled={disabled}>{t("Add")}</Button>
                        </form>}
                </aside>
            </Box>
        </Box>
    </GameFonts.Provider>;
}
