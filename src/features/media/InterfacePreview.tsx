import {EditorSwitch} from '../editor/EditorSwitch';
import {flexLayout, type LayoutBox} from './flex-layout';
import {uiTextStyle} from './ui-text-style';
import {useGameFontFamily} from "./GameFonts";
import {ResourceLoading} from "./ResourceLoading";
import {GfxPreview} from "./GfxPreview";
import {useResourceInvoke} from '../editor/resource-context';
import {SubDialogCanvas} from "./SubDialogCanvas";
import {TextureFrame, useInterfaceTextures} from './InterfaceTextures';
import {type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState} from 'react';

export function interfaceType(name: string) {
    return /\.xml$/i.test(name);
}

export function InterfacePreview({
                                     text,
                                     entries,
                                     selection,
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
                                     fileName = ''
                                 }: {
    hiddenElements?: string[];
    gridAnchor?: [number, number];
    borders?: boolean; borderOverrides?: Record<string, boolean>;
    text: string; entries: { name: string }[]; selection?: number; onSelect?: (index: number) => void;
    onGeometry?: (index: number, values: Record<string, number>) => void; grid?: number; disabled?: boolean;
    onOpen?: (index: number) => void;
    fileName?: string; initialZoom?: number; onZoom?: (zoom: number) => void;
}) {
    const invoke = useResourceInvoke();
    const fontFamily = useGameFontFamily();
    const [zoom, setZoom] = useState(initialZoom);
    const canvasRef = useRef<HTMLDivElement>(null);
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
    const {textures, missing, progress, loading} = useInterfaceTextures(model, entries);
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
        let result: Record<string, number> = {};
        const snap = (v: number) => Math.round(v / grid) * grid;
        const siblings = Array.from(element.parentElement?.children ?? []).filter(other => other !== element && value(other, 'Name'));
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
            if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
            if (e.type !== 'pointercancel' && Object.keys(result).length) onGeometry(index, result);
        };
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', finish);
        target.addEventListener('pointercancel', finish);
    }

    if (!model) return <div role="status">Файл не содержит корректного XML-окна AUInterface (DIALOG).</div>;
    const controls = [...layout.keys()].filter(e => {
        for (let p: Element | null = e; p && p !== model; p = p.parentElement) if (hiddenElements.includes(value(p, 'Name'))) return false;
        return true;
    });
    const width = Math.max(1, number(model, 'Width', 800));
    const height = Math.max(1, number(model, 'Height', 600));
    return <div
        style={{flex: 1, minWidth: 0, minHeight: 0, width: '100%', display: 'flex', flexDirection: 'column', gap: 12}}>
        <div>Макет AUInterface · {value(model, 'Name')} · {width} × {height}
            <label style={{marginLeft: 16}}>Масштаб <select value={zoom} onChange={e => {
                setZoom(Number(e.target.value));
                onZoom?.(Number(e.target.value));
            }}>
                {zoomSteps.map(z => <option key={z} value={z}>{z * 100}%</option>)}
            </select></label>
            <EditorSwitch label="Направляющие и привязка к элементам" showLabel checked={smartGuides}
                          change={checked => {
                              setSmartGuides(checked);
                              setGuides({});
                          }}/>
        </div>

        {loading && <ResourceLoading label="Загрузка текстур" completed={progress.completed} total={progress.total}
                                     detail={progress.current}/>}
        {missing.length > 0 && <details>
            <summary>Не загружено текстур: {missing.length}</summary>
            <div>{missing.map(path => <button key={path} style={{
                display: "block",
                textAlign: "left",
                color: "#8ed8ff",
                textDecoration: "underline"
            }} onClick={() => {
                void invoke("open_resource_window", {name: path}).catch(e => window.alert(String(e)));
            }}>{path} ↗</button>)}</div>
        </details>}
        <div ref={canvasRef} title="Ctrl + колесо мыши — масштаб"
             style={{overflow: 'auto', flex: 1, minWidth: 0, minHeight: 200, background: '#101720', padding: 16}}>
            <div style={{
                position: 'relative',
                width: width * zoom,
                height: height * zoom,
                outline: '2px solid #9bb5d6',
                boxShadow: '0 0 0 3px #080e17, 0 6px 24px #0008',
                overflow: 'hidden',
                flexShrink: 0
            }}>
                <div style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width,
                    height,
                    transform: `scale(${zoom})`,
                    transformOrigin: 'top left',
                    backgroundColor: '#202936',
                    backgroundImage: [
                        ...(grid > 1 ? [
                            'linear-gradient(to right, rgba(145, 165, 190, 0.22) 1px, transparent 1px)',
                            'linear-gradient(to bottom, rgba(145, 165, 190, 0.22) 1px, transparent 1px)'
                        ] : []),
                        'conic-gradient(#2a3545 25%, transparent 0 50%, #2a3545 0 75%, transparent 0)'
                    ].join(', '),
                    backgroundSize: [...(grid > 1 ? [`${grid}px ${grid}px`, `${grid}px ${grid}px`] : []), '32px 32px'].join(', ')
                }}>
                    <TextureFrame element={model} textures={textures}/>
                    {controls.map((e, i) => {
                        const txt = Array.from(e.children).find(c => c.tagName.toUpperCase() === 'TEXT');
                        return <button key={i}
                                       title={`${e.tagName}: ${value(e, 'Name')}${value(e, 'DialogFile') ? ' → ' + value(e, 'DialogFile') : ''}`}
                                       onDoubleClick={() => onOpen?.(nodes.indexOf(e))}
                                       onPointerDown={ev => gesture(ev, e)} onClick={() => {
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
                            outline: active === e ? '1px solid #ffce67' : (borderOverrides[value(e, 'Name') || String(nodes.indexOf(e))] ?? borders) ? '1px dashed #8192a8' : 'none',
                            background: 'transparent',
                            touchAction: 'none',
                            color: '#eef4ff',
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
                                background: "#ffce67",
                                border: "1px solid #111",
                                zIndex: 10,
                                left: edge.includes("w") ? -4 : edge.includes("e") ? "calc(100% - 3px)" : "calc(50% - 3px)",
                                top: edge.includes("n") ? -4 : edge.includes("s") ? "calc(100% - 3px)" : "calc(50% - 3px)",
                                cursor: `${edge}-resize`,
                                touchAction: "none"
                            }}/>)}</button>;
                    })}
                    {guides.x !== undefined && <div aria-hidden="true" style={{
                        position: 'absolute',
                        left: guides.x,
                        top: 0,
                        height: '100%',
                        width: 0,
                        borderLeft: `${1 / zoom}px solid ${guides.x === width / 2 ? '#ff4545' : '#f472d0'}`,
                        pointerEvents: 'none',
                        zIndex: 100
                    }}/>}
                    {guides.y !== undefined && <div aria-hidden="true" style={{
                        position: 'absolute',
                        top: guides.y,
                        left: 0,
                        width: '100%',
                        height: 0,
                        borderTop: `${1 / zoom}px solid ${guides.y === height / 2 ? '#ff4545' : '#f472d0'}`,
                        pointerEvents: 'none',
                        zIndex: 100
                    }}/>}
                </div>
            </div>
        </div>
        {selected && controls.includes(selected) && <pre style={{
            maxHeight: 140,
            overflow: 'auto',
            margin: 0
        }}>{selected.tagName + '\n' + Array.from(selected.attributes).map(a => `${a.name}: ${a.value}`).join('\n')}</pre>}
    </div>;
}
