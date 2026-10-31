import {t, useLanguage} from '../../i18n/index';
import {useEffect, useRef, useState} from 'react';

export function ImageViewer({src, name, onError}: { src: string; name: string; onError: () => void }) {
    useLanguage();
    const stage = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({width: 0, height: 0});
    const [view, setView] = useState({scale: 1, x: 0, y: 0});
    const current = useRef(view);
    current.current = view;
    const drag = useRef<{ x: number; y: number; left: number; top: number } | undefined>(undefined);

    function center(scale: number) {
        const el = stage.current;
        if (el) setView({
            scale,
            x: (el.clientWidth - size.width * scale) / 2,
            y: (el.clientHeight - size.height * scale) / 2
        });
    }

    function fit() {
        const el = stage.current;
        if (el && size.width) center(Math.min(1, el.clientWidth / size.width, el.clientHeight / size.height));
    }

    useEffect(() => {
        const el = stage.current;
        if (!el) return;
        const wheel = (event: WheelEvent) => {
            event.preventDefault();
            const rect = el.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
            const old = current.current,
                delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientHeight : 1);
            const scale = Math.max(0.01, Math.min(64, old.scale * Math.exp(-delta * 0.002)));
            const next = {scale, x: x - (x - old.x) * scale / old.scale, y: y - (y - old.y) * scale / old.scale};
            current.current = next;
            setView(next);
        };
        el.addEventListener('wheel', wheel, {passive: false});
        return () => el.removeEventListener('wheel', wheel);
    }, []);
    useEffect(() => {
        fit();
    }, [size]);
    return <>
        <div className="media-toolbar">
            <button onClick={fit}>{t("Вписать")}</button>
            <button onClick={() => center(1)}>100%</button>
            <span>{Math.round(view.scale * 100)}%</span><span>{size.width} × {size.height}</span></div>
        <div ref={stage} className="image-stage zoom-stage" onDoubleClick={fit}
             onPointerDown={event => {
                 if (event.button !== 0 && event.button !== 1) return;
                 event.preventDefault();
                 drag.current = {x: event.clientX, y: event.clientY, left: view.x, top: view.y};
                 event.currentTarget.setPointerCapture(event.pointerId);
                 event.currentTarget.style.cursor = 'grabbing';
             }}
             onPointerMove={event => {
                 const d = drag.current;
                 if (d) setView(old => ({...old, x: d.left + event.clientX - d.x, y: d.top + event.clientY - d.y}));
             }}
             onPointerUp={event => {
                 drag.current = undefined;
                 event.currentTarget.style.cursor = 'grab';
                 if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
             }}
             onLostPointerCapture={event => {
                 drag.current = undefined;
                 event.currentTarget.style.cursor = 'grab';
             }}>
            <img src={src} alt={name} draggable={false} onError={onError} onLoad={event => {
                const img = event.currentTarget;
                setSize({width: img.naturalWidth, height: img.naturalHeight});
            }}
                 style={{
                     width: size.width || undefined,
                     height: size.height || undefined,
                     transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`
                 }}/>
        </div>
    </>;
}
