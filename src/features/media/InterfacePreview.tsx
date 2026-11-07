import {t} from "../../i18n";
import {Box, Button, Field, Select} from "@chakra-ui/react";
import {type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState} from 'react';
import {AccordionItem, AccordionItemContent, AccordionItemTrigger, AccordionRoot} from "../../components/ui/accordion";
import {SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValueText} from "../../components/ui/select";
import {EditorSwitch} from '../editor/EditorSwitch';
import {useResourceInvoke} from '../editor/resource-context';
import {selectCollection} from '../editor/select-collection';
import {flexLayout, type LayoutBox} from './flex-layout';
import {useGameFontFamily} from "./GameFonts";
import {GfxPreview} from "./GfxPreview";
import {TextureFrame, useInterfaceTextures} from './InterfaceTextures';
import {ResourceLoading} from "./ResourceLoading";
import {SubDialogCanvas} from "./SubDialogCanvas";
import {uiTextStyle} from './ui-text-style';

export function interfaceType(name: string) {
    return /\.xml$/i.test(name);
}

export function InterfacePreview({
                                     text,
                                     entries,
                                     selection, selections = [], onSelections,
                                     onSelect,
                                     onGeometry,
                                     onOpen,
                                     grid = 1,
                                     disabled = false,
                                     initialZoom = 1,
                                     onZoom,
                                     gridAnchor = [0, 0],
                                     hiddenElements = [],
                                     borders = false,
                                     borderOverrides = {},
                                     capture,
                                     fileName = ''
                                 }: {
    capture?: (report: { textures: number; missing: string[] }) => void;
    hiddenElements?: string[];
    gridAnchor?: [number, number];
    borders?: boolean;
    borderOverrides?: Record<string, boolean>;
    text: string;
    entries: { name: string }[];
    selection?: number;
    selections?: number[];
    onSelections?: (indices: number[]) => void;
    onSelect?: (index: number) => void;
    onGeometry?: (index: number, values: Record<string, number>) => void;
    grid?: number;
    disabled?: boolean;
    onOpen?: (index: number) => void;
    fileName?: string;
    initialZoom?: number;
    onZoom?: (zoom: number) => void;
}) {
    const invoke = useResourceInvoke();
    const fontFamily = useGameFontFamily();
    const [zoom, setZoom] = useState(initialZoom);
    const canvasRef = useRef<HTMLDivElement>(null);
    const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
    const marqueeCleanup = useRef<(() => void) | null>(null);
    useEffect(() => () => marqueeCleanup.current?.(), []);

    function startMarquee(event: ReactPointerEvent<HTMLDivElement>) {
        if (capture || event.button !== 0 || (event.target as Element).closest('[data-geometry-index]')) return;
        event.preventDefault();
        const canvas = event.currentTarget;
        const rect = canvas.getBoundingClientRect();
        const start = {
            x: event.clientX - rect.left + canvas.scrollLeft,
            y: event.clientY - rect.top + canvas.scrollTop
        };
        const initial = event.ctrlKey || event.metaKey || event.shiftKey ? [...selections] : [];
        if (!initial.length) {
            onSelections?.([]);
            onSelect?.(-1);
            setSelected(null);
        }
        let moved = false;
        const move = (e: PointerEvent) => {
            const bounds = canvas.getBoundingClientRect();
            const end = {x: e.clientX - bounds.left + canvas.scrollLeft, y: e.clientY - bounds.top + canvas.scrollTop};
            if (!moved && Math.hypot(end.x - start.x, end.y - start.y) < 4) return;
            moved = true;
            const box = {
                x: Math.min(start.x, end.x),
                y: Math.min(start.y, end.y),
                width: Math.abs(end.x - start.x),
                height: Math.abs(end.y - start.y)
            };
            setMarquee(box);
            const hits = Array.from(canvas.querySelectorAll<HTMLElement>('[data-geometry-index]')).filter(element => {
                const r = element.getBoundingClientRect();
                const left = r.left - bounds.left + canvas.scrollLeft, top = r.top - bounds.top + canvas.scrollTop;
                return r.width > 0 && r.height > 0 && left < box.x + box.width && left + r.width > box.x && top < box.y + box.height && top + r.height > box.y;
            }).map(element => Number(element.dataset.geometryIndex));
            const next = [...new Set([...initial, ...hits])];
            onSelections?.(next);
            onSelect?.(next.at(-1) ?? -1);
        };
        const finish = () => {
            cleanup();
            setMarquee(null);
        };
        const cancel = () => {
            cleanup();
            setMarquee(null);
            onSelections?.(initial);
            onSelect?.(initial.at(-1) ?? -1);
        };
        const cleanup = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', finish);
            window.removeEventListener('pointercancel', cancel);
            marqueeCleanup.current = null;
        };
        marqueeCleanup.current?.();
        marqueeCleanup.current = cleanup;
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', finish);
        window.addEventListener('pointercancel', cancel);
    }

    const zoomRef = useRef(zoom);
    const onZoomRef = useRef(onZoom);
    zoomRef.current = zoom;
    onZoomRef.current = onZoom;
    const zoomSteps = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20];
    const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
    const [smartGuides, setSmartGuides] = useState(true);
    const [selected, setSelected] = useState<Element | null>(null);
    const model = useMemo(() => {
        // The text editor preserves BOM characters; XML parsers expect them
        // to have been consumed by the byte decoder.
        const source = text.replace(/^[\s\uFEFF]+/, '').replace(/\u0000+$/, '');
        const doc = new DOMParser().parseFromString(source, 'application/xml');
        if (doc.querySelector('parsererror')) return null;
        return Array.from(doc.getElementsByTagName('*')).find(e => e.tagName.toUpperCase() === 'DIALOG') ?? null;
    }, [text]);
    const hasModel = !!model;
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const wheel = (event: WheelEvent) => {
            if (!event.ctrlKey) return;
            event.preventDefault();
            event.stopPropagation();
            if (!event.deltaY) return;
            const current = zoomRef.current;
            const next = event.deltaY < 0
                ? zoomSteps.find(step => step > current) ?? zoomSteps[zoomSteps.length - 1]
                : [...zoomSteps].reverse().find(step => step < current) ?? zoomSteps[0];
            if (next === current) return;
            zoomRef.current = next;
            setZoom(next);
            onZoomRef.current?.(next);
        };
        // React wheel listeners are passive; a native listener also blocks WebView page zoom.
        canvas.addEventListener('wheel', wheel, {passive: false});
        return () => canvas.removeEventListener('wheel', wheel);
    }, [hasModel]);

    const layout = useMemo(() => model ? flexLayout(model) : new Map<Element, LayoutBox>(), [model]);
    const value = (e: Element, name: string) => Array.from(e.attributes).find(a => a.name.toLowerCase() === name.toLowerCase())?.value ?? '';
    const number = (e: Element, name: string, fallback: number) => {
        const box = layout.get(e);
        if (box && ['x', 'y', 'Width', 'Height'].includes(name) && (e.parentElement?.tagName.toUpperCase() === 'DIV' || e.tagName.toUpperCase() === 'DIV')) return ({
            x: box.x,
            y: box.y,
            Width: box.width,
            Height: box.height
        } as Record<string, number>)[name];
        const raw = value(e, name);
        return raw && Number.isFinite(Number(raw)) ? Math.max(-10000, Math.min(10000, Number(raw))) : fallback;
    };
    const {textures, missing, progress, loading, settled} = useInterfaceTextures(model, entries);
    useEffect(() => {
        if (capture && settled) capture({textures: Object.keys(textures).length, missing});
    }, [capture, settled, textures, missing]);
    const nodes = model ? Array.from(model.ownerDocument.getElementsByTagName('*')) : [];
    const active = selection === undefined ? selected : nodes[selection];

    function gesture(event: ReactPointerEvent<HTMLElement>, element: Element, edge = '') {
        if (disabled || !onGeometry || event.button !== 0) return;
        if (element.parentElement?.tagName.toUpperCase() === 'DIV') {
            event.preventDefault();
            event.stopPropagation();
            onSelect?.(nodes.indexOf(element));
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const index = nodes.indexOf(element);
        if (event.ctrlKey || event.metaKey || event.shiftKey) {
            const current = selections.length ? selections : selection === undefined ? [] : [selection];
            const next = event.shiftKey && selection !== undefined ? nodes.map((node, i) => ({node, i})).filter(({
                                                                                                                     node,
                                                                                                                     i
                                                                                                                 }) => i >= Math.min(selection, index) && i <= Math.max(selection, index) && node.hasAttribute('Name')).map(({i}) => i) : current.includes(index) ? current.filter(value => value !== index) : [...current, index];
            onSelections?.(next);
            onSelect?.(next.at(-1) ?? index);
            return;
        }
        if (!selections.includes(index)) onSelections?.([index]);
        onSelect?.(index);
        const target = event.currentTarget;
        const box = (edge ? target.parentElement : target) as HTMLElement;
        const startX = event.clientX, startY = event.clientY;
        const original = {
            x: number(element, 'x', 0),
            y: number(element, 'y', 0),
            Width: box.offsetWidth,
            Height: box.offsetHeight
        };
        const initialStyle = box.getAttribute('style');
        const group = !edge && selections.includes(index) ? selections.map(i => nodes[i]).filter(node => node && node !== element && !selections.some(j => nodes[j] !== node && nodes[j]?.contains(node))) : [];
        const groupBoxes = group.map(node => ({
            node,
            box: canvasRef.current?.querySelector<HTMLElement>('[data-geometry-index="' + nodes.indexOf(node) + '"]')
        })).filter(item => item.box).map(item => ({...item, style: item.box!.getAttribute('style')}));
        let result: Record<string, number> = {};
        const snap = (v: number) => Math.round(v / grid) * grid;
        const siblings = Array.from(element.parentElement?.children ?? []).filter(other => other !== element && !selections.includes(nodes.indexOf(other)) && value(other, 'Name'));
        const references = (axis: 'x' | 'y') => siblings.flatMap(other => {
            const start = number(other, axis, 0);
            const size = number(other, axis === 'x' ? 'Width' : 'Height', axis === 'x' ? 100 : 22);
            return [start, start + size / 2, start + size];
        });
        const documentCenterX = number(model!, 'Width', 800) / 2;
        const documentCenterY = number(model!, 'Height', 600) / 2;
        const referenceX = [...references('x'), documentCenterX];
        const referenceY = [...references('y'), documentCenterY];
        const alignToOthers = (start: number, size: number, anchorFraction: number, references: number[]) => {
            let distance = 6 / zoom, offset = 0, guide: number | undefined;
            const anchor = start + size * anchorFraction;
            for (const reference of references) {
                const delta = reference - anchor;
                if (Math.abs(delta) <= distance) {
                    distance = Math.abs(delta);
                    offset = delta;
                    guide = reference;
                }
            }
            return {position: start + offset, guide};
        };
        target.setPointerCapture(event.pointerId);
        const move = (e: PointerEvent) => {
            const dx = (e.clientX - startX) / zoom, dy = (e.clientY - startY) / zoom;
            if (!edge) result = {
                x: snap(original.x + dx + original.Width * gridAnchor[0]) - original.Width * gridAnchor[0],
                y: snap(original.y + dy + original.Height * gridAnchor[1]) - original.Height * gridAnchor[1]
            };
            else {
                const left = edge.includes('w') ? Math.min(original.x + original.Width - 1, snap(original.x + dx)) : original.x;
                const top = edge.includes('n') ? Math.min(original.y + original.Height - 1, snap(original.y + dy)) : original.y;
                result = {
                    x: left,
                    y: top,
                    Width: edge.includes('w') ? original.x + original.Width - left : edge.includes('e') ? Math.max(1, snap(original.Width + dx)) : original.Width,
                    Height: edge.includes('n') ? original.y + original.Height - top : edge.includes('s') ? Math.max(1, snap(original.Height + dy)) : original.Height
                };
            }
            if (!edge && smartGuides) {
                // Compare raw motion so the grid cannot hide a nearby alignment.
                const horizontal = alignToOthers(original.x + dx, original.Width, gridAnchor[0], referenceX);
                const vertical = alignToOthers(original.y + dy, original.Height, gridAnchor[1], referenceY);
                if (horizontal.guide !== undefined) result.x = horizontal.position;
                if (vertical.guide !== undefined) result.y = vertical.position;
                setGuides({x: horizontal.guide, y: vertical.guide});
            }
            if (!edge && result.x !== undefined && result.y !== undefined) for (const item of groupBoxes) {
                item.box!.style.left = (number(item.node, 'x', 0) + result.x - original.x) + 'px';
                item.box!.style.top = (number(item.node, 'y', 0) + result.y - original.y) + 'px';
            }
            for (const [key, v] of Object.entries(result)) box.style.setProperty(({
                x: 'left',
                y: 'top',
                Width: 'width',
                Height: 'height'
            } as Record<string, string>)[key], `${v}px`);
        };
        const finish = (e: PointerEvent) => {
            setGuides({});
            target.removeEventListener('pointermove', move);
            target.removeEventListener('pointerup', finish);
            target.removeEventListener('pointercancel', finish);
            if (initialStyle !== null) box.setAttribute('style', initialStyle);
            for (const item of groupBoxes) if (item.style !== null) item.box!.setAttribute('style', item.style);
            if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
            if (e.type !== 'pointercancel' && Object.keys(result).length) onGeometry(index, result);
        };
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', finish);
        target.addEventListener('pointercancel', finish);
    }

    if (!model) return <Box
        role="status">{t("The file does not contain a valid AUInterface XML window (DIALOG).")}</Box>;
    const controls = [...layout.keys()].filter(e => {
        for (let p: Element | null = e; p && p !== model; p = p.parentElement) if (hiddenElements.includes(value(p, 'Name'))) return false;
        return true;
    });
    const width = Math.max(1, number(model, 'Width', 800));
    const height = Math.max(1, number(model, 'Height', 600));
    return <Box
        style={{flex: 1, minWidth: 0, minHeight: 0, width: '100%', display: 'flex', flexDirection: 'column', gap: 12}}>
        {!capture && <>
            <Box display="flex" alignItems="center" flexWrap="wrap" gap="3" px="3" py="2" bg="bg.panel"
                 borderBottomWidth="1px"
                 fontSize="sm">{t("AUInterface layout · ")}{value(model, 'Name')} · {width} × {height}
                <Field.Root width="auto" flexDirection="row" alignItems="center" gap="2" ml="auto"><Field.Label
                    mb="0">{t("Zoom")}</Field.Label><SelectRoot size="sm" lazyMount unmountOnExit width="100px"
                                                                minW="100px"
                                                                collection={selectCollection(<>{zoomSteps.map(z =>
                                                                    <option key={z}
                                                                            value={z}>{z * 100}%</option>)}</>)}
                                                                value={[String(zoom)]}
                                                                onValueChange={async ({value: [value]}) => {
                                                                    setZoom(Number(value));
                                                                    onZoom?.(Number(value));
                                                                }}><SelectTrigger><SelectValueText/></SelectTrigger><SelectContent><Select.Context>{select => select.collection.items.map(item =>
                    <SelectItem key={select.collection.getItemValue(item)}
                                item={item}>{t(select.collection.stringifyItem(item))}</SelectItem>)}</Select.Context></SelectContent></SelectRoot></Field.Root>
                <EditorSwitch label={t("Guides and element snapping")} showLabel checked={smartGuides}
                              change={checked => {
                                  setSmartGuides(checked);
                                  setGuides({});
                              }}/>
            </Box>

            {loading &&
                <ResourceLoading label={t("Loading textures")} completed={progress.completed} total={progress.total}
                                 detail={progress.current}/>}
            {missing.length > 0 && <AccordionRoot collapsible defaultValue={false ? ["content"] : []}><AccordionItem
                value="content"><AccordionItemTrigger>{t("Textures not loaded: ")}{missing.length}</AccordionItemTrigger><AccordionItemContent><Box>{missing.map(path =>
                <Button key={path} style={{
                    display: "block",
                    textAlign: "left",
                    color: "var(--chakra-colors-cyan-300)",
                    textDecoration: "underline"
                }} onClick={() => {
                    void invoke("open_resource_window", {name: path}).catch(e => window.alert(String(e)));
                }}>{path} ↗</Button>)}</Box></AccordionItemContent></AccordionItem></AccordionRoot>}</>}
        <Box ref={canvasRef} onPointerDown={startMarquee} title={t("Ctrl + mouse wheel — zoom")}
             style={{
                 position: 'relative',
                 overflow: 'auto',
                 flex: 1,
                 minWidth: 0,
                 minHeight: capture ? 0 : 200,
                 background: 'var(--chakra-colors-preview-background)',
                 padding: capture ? 0 : 16
             }}>
            {marquee &&
                <Box pointerEvents="none" position="absolute" zIndex="10" borderWidth="1px" borderColor="blue.400"
                     bg="blue.500/15"
                     style={{left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height}}/>}
            <Box data-preview-dialog style={{
                position: 'relative',
                width: width * zoom,
                height: height * zoom,
                outline: '2px solid var(--chakra-colors-preview-frame)',
                boxShadow: '0 0 0 3px var(--chakra-colors-preview-shadow), 0 6px 24px var(--chakra-colors-black-alpha-500)',
                overflow: 'hidden',
                flexShrink: 0
            }}>
                <Box style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width,
                    height,
                    transform: `scale(${zoom})`,
                    transformOrigin: 'top left',
                    backgroundColor: 'var(--chakra-colors-preview-checker-base)',
                    backgroundImage: [
                        ...(grid > 1 ? [
                            'linear-gradient(to right, var(--chakra-colors-preview-grid) 1px, transparent 1px)',
                            'linear-gradient(to bottom, var(--chakra-colors-preview-grid) 1px, transparent 1px)'
                        ] : []),
                        'conic-gradient(var(--chakra-colors-preview-checker-square) 25%, transparent 0 50%, var(--chakra-colors-preview-checker-square) 0 75%, transparent 0)'
                    ].join(', '),
                    backgroundSize: [...(grid > 1 ? [`${grid}px ${grid}px`, `${grid}px ${grid}px`] : []), '32px 32px'].join(', ')
                }}>
                    <TextureFrame element={model} textures={textures}/>
                    {controls.map((e, i) => {
                        const txt = Array.from(e.children).find(c => c.tagName.toUpperCase() === 'TEXT');
                        return <Button key={i}
                                       title={`${e.tagName}: ${value(e, 'Name')}${value(e, 'DialogFile') ? ' → ' + value(e, 'DialogFile') : ''}`}
                                       onDoubleClick={() => onOpen?.(nodes.indexOf(e))}
                                       data-geometry-index={nodes.indexOf(e)} onPointerDown={ev => gesture(ev, e)}
                                       onClick={event => {
                                           if (event.ctrlKey || event.metaKey || event.shiftKey) return;
                                           setSelected(e);
                                           onSelect?.(nodes.indexOf(e));
                                       }} style={{
                            position: 'absolute',
                            left: number(e, 'x', 0),
                            top: number(e, 'y', 0),
                            boxSizing: 'border-box',
                            margin: 0,
                            minWidth: 0,
                            minHeight: 0,
                            maxWidth: 'none',
                            maxHeight: 'none',
                            display: 'block',
                            lineHeight: 1,
                            width: e.tagName.toUpperCase() === 'DIV' || e.parentElement?.tagName.toUpperCase() === 'DIV' || value(e, 'Width') ? Math.max(0, number(e, 'Width', 100)) : 'max-content',
                            transform: !value(e, 'Width') && e.tagName.toUpperCase() === 'LABEL' ? `translateX(${number(e, 'Align', 0) === 1 ? '-50%' : number(e, 'Align', 0) === 2 ? '-100%' : '0'})` : undefined,
                            height: Math.max(0, number(e, 'Height', 22)),
                            border: 'none',
                            outline: (active === e || selections.includes(nodes.indexOf(e))) ? '1px solid var(--chakra-colors-fg-warning)' : (borderOverrides[value(e, 'Name') || String(nodes.indexOf(e))] ?? borders) ? '1px dashed var(--chakra-colors-preview-outline)' : 'none',
                            background: 'transparent',
                            touchAction: 'none',
                            color: 'var(--chakra-colors-preview-text)',
                            overflow: 'visible',
                            fontSize: txt ? Math.max(8, Math.min(72, number(txt, 'FontSize', 12))) : 12,
                            padding: 0,
                            textAlign: /BUTTON/i.test(e.tagName) ? 'center' : 'left',
                            cursor: 'pointer',
                        }}>{!value(e, 'Width') && <span aria-hidden="true" style={{
                            visibility: 'hidden',
                            whiteSpace: 'nowrap', ...uiTextStyle(txt),
                            fontFamily: txt ? fontFamily(value(txt, 'FontName')) : undefined
                        }}>{txt && value(txt, 'String')}</span>}<TextureFrame element={e}
                                                                              textures={textures}/>{(e.tagName.toUpperCase() === 'DIV' ? [] : Array.from(e.getElementsByTagName("*"))).filter(r => r.tagName.toUpperCase() === "GFX").map((r, n) =>
                            <GfxPreview key={n} file={r.getAttribute("FileName") ?? ""} entries={entries}
                                        embedded/>)}{e.tagName.toUpperCase() === "SUBDIALOG" && value(e, "DialogFile") &&
                            <span style={{
                                position: "absolute",
                                inset: 0,
                                overflow: "hidden",
                                pointerEvents: "none"
                            }}><SubDialogCanvas file={value(e, "DialogFile")} parentFile={fileName} entries={entries}/></span>}<span
                            style={{
                                position: 'absolute',
                                left: (number(e, 'Align', /BUTTON/i.test(e.tagName) ? 1 : 0) === 1 ? '50%' : number(e, 'Align', 0) === 2 ? '100%' : 0),
                                top: /BUTTON/i.test(e.tagName) ? '50%' : 0,
                                transform: `translate(${number(e, 'Align', /BUTTON/i.test(e.tagName) ? 1 : 0) === 1 ? '-50%' : number(e, 'Align', 0) === 2 ? '-100%' : '0'}, ${/BUTTON/i.test(e.tagName) ? '-50%' : '0'}) translate(${number(e, 'TextOffsetX', 0)}px, ${number(e, 'TextOffsetY', 0)}px)`,
                                pointerEvents: 'none',
                                whiteSpace: 'nowrap',
                                fontFamily: txt ? fontFamily(value(txt, 'FontName')) : undefined,
                                ...uiTextStyle(txt),
                            }}>{txt && value(txt, 'String')}</span>{active === e && onGeometry && !disabled && e.parentElement?.tagName.toUpperCase() !== 'DIV' && ["n", "s", "e", "w", "nw", "ne", "sw", "se"].map(edge =>
                            <span key={edge} onPointerDown={ev => gesture(ev, e, edge)} style={{
                                position: "absolute",
                                width: 7,
                                height: 7,
                                background: "var(--chakra-colors-fg-warning)",
                                border: "1px solid var(--chakra-colors-preview-handle-border)",
                                zIndex: 10,
                                left: edge.includes("w") ? -4 : edge.includes("e") ? "calc(100% - 3px)" : "calc(50% - 3px)",
                                top: edge.includes("n") ? -4 : edge.includes("s") ? "calc(100% - 3px)" : "calc(50% - 3px)",
                                cursor: `${edge}-resize`,
                                touchAction: "none"
                            }}/>)}</Button>;
                    })}
                    {guides.x !== undefined && <Box aria-hidden="true" style={{
                        position: 'absolute',
                        left: guides.x,
                        top: 0,
                        height: '100%',
                        width: 0,
                        borderLeft: t("{value0}px solid {value1}", {
                            value0: 1 / zoom,
                            value1: guides.x === width / 2 ? 'var(--chakra-colors-fg-error)' : 'var(--chakra-colors-pink-400)'
                        }),
                        pointerEvents: 'none',
                        zIndex: 100
                    }}/>}
                    {guides.y !== undefined && <Box aria-hidden="true" style={{
                        position: 'absolute',
                        top: guides.y,
                        left: 0,
                        width: '100%',
                        height: 0,
                        borderTop: t("{value0}px solid {value1}", {
                            value0: 1 / zoom,
                            value1: guides.y === height / 2 ? 'var(--chakra-colors-fg-error)' : 'var(--chakra-colors-pink-400)'
                        }),
                        pointerEvents: 'none',
                        zIndex: 100
                    }}/>}
                </Box>
            </Box>
        </Box>
        {selected && controls.includes(selected) && <pre style={{
            maxHeight: 140,
            overflow: 'auto',
            margin: 0
        }}>{selected.tagName + '\n' + Array.from(selected.attributes).map(a => `${a.name}: ${a.value}`).join('\n')}</pre>}
    </Box>;
}
