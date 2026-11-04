import {useEffect, useRef, useState} from 'react';
import {useResourceActive, useResourceInvoke} from '../editor/resource-context';
import {save} from '@tauri-apps/plugin-dialog';
import {ResourceLoading} from './ResourceLoading';

export function NativeGfxPreview({file, embedded = false}: { file: string; embedded?: boolean }) {
    const invoke = useResourceInvoke();
    const active = useResourceActive();
    const activeRef = useRef(active);
    activeRef.current = active;
    const session = useRef<number | undefined>(undefined);
    const [exporting, setExporting] = useState(false);
    const [exportStatus, setExportStatus] = useState('');
    const viewport = useRef<HTMLDivElement>(null);
    const renderSize = useRef([512, 512]);
    useEffect(() => {
        if (embedded || !viewport.current) return;
        const observer = new ResizeObserver(([entry]) => {
            const {width, height} = entry.contentRect;
            const ratio = window.devicePixelRatio || 1;
            const scale = Math.min(ratio, 2560 / Math.max(1, width, height));
            renderSize.current = [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
        });
        observer.observe(viewport.current);
        return () => observer.disconnect();
    }, [embedded]);
    const canvas = useRef<HTMLCanvasElement>(null);
    const isModel = /\.(mox|ecm|smd|ski|bon)$/i.test(file);
    const hasAnimations = /\.(smd|ecm)$/i.test(file);
    const [animations, setAnimations] = useState<{ name: string; track: string }[]>([]);
    const [animation, setAnimation] = useState('');
    const pendingAnimation = useRef<number | undefined>(undefined);
    const orbit = useRef([Math.PI / 4, Math.atan(0.6 / Math.sqrt(2)), 1]);
    const drag = useRef<{ x: number; y: number } | undefined>(undefined);
    const playing = useRef(true), restart = useRef(false);
    const [paused, setPaused] = useState(false), [error, setError] = useState('');
    const [loading, setLoading] = useState('Загрузка ресурса…');
    useEffect(() => {
        setExportStatus('');
        session.current = undefined;
        setAnimations([]);
        setAnimation('');
        pendingAnimation.current = undefined;
        playing.current = true;
        restart.current = false;
        setPaused(false);
        orbit.current = [Math.PI / 4, Math.atan(0.6 / Math.sqrt(2)), 1];
        let disposed = false, id: number | undefined, timer: ReturnType<typeof setTimeout>;
        setError('');
        setLoading('Загрузка ресурса…');
        canvas.current?.getContext('2d')?.clearRect(0, 0, 512, 512);
        void (async () => {
            try {
                id = await invoke<number>('native_gfx_create', {name: file, embedded});
                if (disposed) {
                    await invoke('native_gfx_close', {id});
                    return;
                }
                session.current = id;
                if (hasAnimations) {
                    const actions = await invoke<{ name: string; track: string }[]>('native_gfx_animations', {id});
                    if (disposed) return;
                    setAnimations(actions);
                }
                setLoading('Подготовка первого кадра…');
                let previous = performance.now();
                const frame = async () => {
                    if (disposed) return;
                    if (!activeRef.current) {
                        previous = performance.now();
                        timer = setTimeout(() => void frame(), 150);
                        return;
                    }
                    try {
                        const now = performance.now();
                        const delta = restart.current ? 0xffffffff : playing.current ? Math.min(100, Math.round(now - previous)) : 0;
                        restart.current = false;
                        previous = now;
                        const [width, height] = embedded ? [512, 512] : renderSize.current;
                        const action = pendingAnimation.current;
                        pendingAnimation.current = undefined;
                        const buffer = await invoke<ArrayBuffer>('native_gfx_frame', {
                            id,
                            delta,
                            camera: isModel ? orbit.current : null,
                            size: embedded ? null : [width, height],
                            animation: action ?? null
                        });
                        const bytes = new Uint8ClampedArray(buffer);
                        if (bytes.length !== width * height * 4) throw Error(`Invalid native GFX frame: ${bytes.length} bytes`);
                        if (disposed) return;
                        const ctx = canvas.current?.getContext('2d');
                        if (ctx) {
                            if (ctx.canvas.width !== width || ctx.canvas.height !== height) {
                                ctx.canvas.width = width;
                                ctx.canvas.height = height;
                            }
                            const image = ctx.createImageData(width, height);
                            for (let i = 0; i < bytes.length; i += 4) {
                                const blue = bytes[i];
                                bytes[i] = bytes[i + 2];
                                bytes[i + 2] = blue;
                                bytes[i + 3] = 255;
                            }
                            image.data.set(bytes);
                            ctx.putImageData(image, 0, 0);
                            setLoading('');
                        }
                        timer = setTimeout(() => void frame(), 50);
                    } catch (e) {
                        if (!disposed) setError(String(e));
                    }
                };
                await frame();
            } catch (e) {
                if (!disposed) setError(String(e));
            }
        })();
        return () => {
            disposed = true;
            session.current = undefined;
            clearTimeout(timer);
            if (id !== undefined) void invoke('native_gfx_close', {id});
        };
    }, [file, embedded]);
    return <div style={{
        position: embedded ? 'absolute' : 'relative',
        inset: embedded ? 0 : undefined,
        flex: 1,
        minHeight: embedded ? 0 : 300,
        display: 'flex',
        flexDirection: 'column',
        pointerEvents: embedded ? 'none' : undefined
    }}>
        {!embedded && <div className="native-preview-toolbar">
            <div className="native-preview-actions" role="group" aria-label="Управление предпросмотром">
                <button disabled={!!loading || !!error} aria-pressed={paused} onClick={() => {
                    playing.current = !playing.current;
                    setPaused(!playing.current);
                }}><span aria-hidden="true">{paused ? '▶' : 'Ⅱ'}</span>{paused ? 'Продолжить' : 'Пауза'}</button>
                <button disabled={!!loading || !!error} onClick={() => {
                    restart.current = true;
                }}>
                    <span aria-hidden="true">↺</span>Сначала
                </button>
                {isModel && <button disabled={!!loading || !!error} onClick={() => {
                    orbit.current = [Math.PI / 4, Math.atan(0.6 / Math.sqrt(2)), 1];
                }}><span aria-hidden="true">⌖</span>Сброс камеры</button>}
            </div>
            {hasAnimations && <label className="native-animation-picker">Анимация
                <select aria-label="Анимация STCK" disabled={!!loading || !!error || !animations.length}
                        value={animation} onChange={e => {
                    setAnimation(e.target.value);
                    pendingAnimation.current = e.target.value === '' ? 0xffffffff : Number(e.target.value);
                }}>
                    <option value="">{animations.length ? 'Без анимации' : 'Нет связанных анимаций'}</option>
                    {animations.map((action, index) => <option key={index} value={index}>{action.name}</option>)}
                </select>
                {animation !== '' &&
                    <span title={animations[Number(animation)]?.track}>{animations[Number(animation)]?.track}</span>}
            </label>}
            {isModel && !/\.bon$/i.test(file) && <div className="native-preview-actions">
                <button disabled={!!loading || !!error || exporting}
                        title="Геометрия, текстуры, скелет и все связанные анимации" onClick={async () => {
                    const id = session.current;
                    if (id === undefined) return;
                    setExporting(true);
                    setExportStatus('');
                    try {
                        const path = await save({
                            defaultPath: (file.split(/[\\/]/).pop() ?? 'model').replace(/\.[^.]+$/, '.glb'),
                            filters: [{name: 'glTF Binary', extensions: ['glb']}]
                        });
                        if (!path) return;
                        await invoke('native_gfx_export_glb', {id, path});
                        setExportStatus('GLB сохранён');
                    } catch (e) {
                        setExportStatus(String(e));
                    } finally {
                        setExporting(false);
                    }
                }}>{exporting ? 'Экспорт…' : 'Экспорт GLB'}</button>
            </div>}
            {exportStatus && <span role="status" className="native-preview-hint">{exportStatus}</span>}
            <div className="native-preview-status"
                 data-state={error ? 'error' : loading ? 'loading' : paused ? 'paused' : 'ready'} role="status"
                 aria-live="polite">
                <span className="native-preview-status-dot" aria-hidden="true"/>
                <span className="native-preview-engine">gfx-native</span>
                <span>{error ? 'Ошибка' : loading || (paused ? 'Пауза' : 'Работает')}</span>
            </div>
            {isModel && <span className="native-preview-hint">Перетаскивание — вращение · Колесо — масштаб</span>}
        </div>}
        <div ref={viewport} className={isModel ? 'native-model-viewport' : undefined} onPointerDown={e => {
            if (!isModel || e.button !== 0) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = {x: e.clientX, y: e.clientY};
        }}
             onPointerMove={e => {
                 if (!drag.current) return;
                 const [yaw, pitch, zoom] = orbit.current;
                 orbit.current = [yaw - (e.clientX - drag.current.x) * 0.01, Math.max(-1.5, Math.min(1.5, pitch + (e.clientY - drag.current.y) * 0.01)), zoom];
                 drag.current = {x: e.clientX, y: e.clientY};
             }}
             onPointerUp={() => {
                 drag.current = undefined;
             }} onLostPointerCapture={() => {
            drag.current = undefined;
        }}
             onWheel={e => {
                 if (!isModel) return;
                 e.stopPropagation();
                 orbit.current = [orbit.current[0], orbit.current[1], Math.max(0.1, Math.min(10, orbit.current[2] * Math.exp(e.deltaY * 0.001)))];
             }}
             style={{
                 position: 'relative',
                 flex: 1,
                 minHeight: 0,
                 overflow: embedded ? 'visible' : 'hidden',
                 background: embedded ? undefined : '#000',
                 touchAction: isModel ? 'none' : undefined
             }}>
            {loading && !error && <div className="gfx-loading"><ResourceLoading label={loading} detail={file}/></div>}
            {error &&
                <p role="alert" style={{
                    position: 'relative',
                    zIndex: 1,
                    color: '#ffb4a4',
                    fontSize: 12,
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                    padding: 12
                }}>{error}</p>}
            <canvas
                ref={canvas} width={512} height={512} style={{
                position: 'absolute',
                visibility: error ? 'hidden' : 'visible',
                width: embedded ? 512 : '100%',
                height: embedded ? 512 : '100%',
                maxWidth: embedded ? undefined : '100%',
                maxHeight: embedded ? undefined : '100%',
                objectFit: 'contain',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                mixBlendMode: embedded ? 'screen' : undefined,
                pointerEvents: 'none'
            }}/>
        </div>
    </div>;
}
