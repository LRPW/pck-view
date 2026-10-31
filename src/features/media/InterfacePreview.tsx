import {useGameFontFamily} from "./GameFonts";
import {ResourceLoading} from "./ResourceLoading";
import {GfxPreview} from "./GfxPreview";
import {invoke} from "@tauri-apps/api/core";
import {SubDialogCanvas} from "./SubDialogCanvas";
import {TextureFrame, useInterfaceTextures} from './InterfaceTextures';
import {useMemo, useState, type PointerEvent as ReactPointerEvent} from 'react';

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
                                     fileName = ''
                                 }: {
    text: string; entries: { name: string }[]; selection?: number; onSelect?: (index: number) => void;
    onGeometry?: (index: number, values: Record<string, number>) => void; grid?: number; disabled?: boolean;
    onOpen?: (index: number) => void;
    fileName?: string; initialZoom?: number; onZoom?: (zoom: number) => void;
}) {
    const fontFamily = useGameFontFamily();
    const [zoom, setZoom] = useState(initialZoom);
    const [selected, setSelected] = useState<Element | null>(null);
    const model = useMemo(() => {
        // The text editor preserves BOM characters; XML parsers expect them
        // to have been consumed by the byte decoder.
        const source = text.replace(/^[\s\uFEFF]+/, '').replace(/\u0000+$/, '');
        const doc = new DOMParser().parseFromString(source, 'application/xml');
        if (doc.querySelector('parsererror')) return null;
        return Array.from(doc.getElementsByTagName('*')).find(e => e.tagName.toUpperCase() === 'DIALOG') ?? null;
    }, [text]);
    const value = (e: Element, name: string) => Array.from(e.attributes).find(a => a.name.toLowerCase() === name.toLowerCase())?.value ?? '';
    const number = (e: Element, name: string, fallback: number) => {
        const raw = value(e, name);
        return raw && Number.isFinite(Number(raw)) ? Math.max(-10000, Math.min(10000, Number(raw))) : fallback;
    };
    const {textures, missing, progress, loading} = useInterfaceTextures(model, entries);
    const nodes = model ? Array.from(model.ownerDocument.getElementsByTagName('*')) : [];
    const active = selection === undefined ? selected : nodes[selection];

    function gesture(event: ReactPointerEvent<HTMLElement>, element: Element, edge = '') {
        if (disabled || !onGeometry || event.button !== 0) return;
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
        target.setPointerCapture(event.pointerId);
        const move = (e: PointerEvent) => {
            const dx = (e.clientX - startX) / zoom, dy = (e.clientY - startY) / zoom;
            if (!edge) result = {x: snap(original.x + dx), y: snap(original.y + dy)};
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
            for (const [key, v] of Object.entries(result)) box.style.setProperty(({
                x: 'left',
                y: 'top',
                Width: 'width',
                Height: 'height'
            } as Record<string, string>)[key], `${v}px`);
        };
        const finish = (e: PointerEvent) => {
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
    const controls = Array.from(model.children).filter(e => value(e, 'Name'));
    const width = Math.max(1, number(model, 'Width', 800));
    const height = Math.max(1, number(model, 'Height', 600));
    return <div
        style={{flex: 1, minWidth: 0, minHeight: 0, width: '100%', display: 'flex', flexDirection: 'column', gap: 12}}>
        <div>Макет AUInterface · {value(model, 'Name')} · {width} × {height}
            <label style={{marginLeft: 16}}>Масштаб <select value={zoom} onChange={e => {
                setZoom(Number(e.target.value));
                onZoom?.(Number(e.target.value));
            }}>
                {[0.25, 0.5, 0.75, 1, 1.5, 2].map(z => <option key={z} value={z}>{z * 100}%</option>)}
            </select></label>
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
        <div style={{overflow: 'auto', flex: 1, minWidth: 0, minHeight: 200, background: '#101720', padding: 16}}>
            <div style={{
                position: 'relative',
                width: width * zoom,
                height: height * zoom,
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
                    outline: '1px solid #8192a8',
                    background: grid > 1 ? 'radial-gradient(#71849b 1px, transparent 1px)' : 'transparent',
                    backgroundSize: `${grid}px ${grid}px`
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
                            width: value(e, 'Width') ? Math.max(0, number(e, 'Width', 100)) : 'max-content',
                            height: Math.max(0, number(e, 'Height', 22)),
                            border: 'none',
                            outline: active === e ? '1px solid #ffce67' : 'none',
                            background: 'transparent',
                            touchAction: 'none',
                            color: '#eef4ff',
                            overflow: 'visible',
                            fontSize: txt ? Math.max(8, Math.min(72, number(txt, 'FontSize', 12))) : 12,
                            padding: 0,
                            textAlign: /BUTTON/i.test(e.tagName) ? 'center' : 'left',
                            cursor: 'pointer',
                        }}><TextureFrame element={e}
                                         textures={textures}/>{Array.from(e.getElementsByTagName("*")).filter(r => r.tagName.toUpperCase() === "GFX").map((r, n) =>
                            <GfxPreview key={n} file={r.getAttribute("FileName") ?? ""} entries={entries}
                                        embedded/>)}{e.tagName.toUpperCase() === "SUBDIALOG" && value(e, "DialogFile") &&
                            <span style={{
                                position: "absolute",
                                inset: 0,
                                overflow: "hidden",
                                pointerEvents: "none"
                            }}><SubDialogCanvas file={value(e, "DialogFile")} parentFile={fileName} entries={entries}/></span>}<span
                            style={{
                                position: 'relative',
                                pointerEvents: 'none',
                                whiteSpace: 'nowrap',
                                fontFamily: txt ? fontFamily(value(txt, 'FontName')) : undefined,
                                fontWeight: txt && value(txt, 'Bold') === 'true' ? 'bold' : undefined,
                                color: txt && /^(\d+,){3}\d+$/.test(value(txt, 'Color')) ? 'rgba(' + value(txt, 'Color').split(',').map((v, i) => i === 3 ? Number(v) / 255 : v).join(',') + ')' : undefined
                            }}>{txt && value(txt, 'String')}</span>{active === e && onGeometry && !disabled && ["n", "s", "e", "w", "nw", "ne", "sw", "se"].map(edge =>
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
