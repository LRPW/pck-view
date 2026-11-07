import {notifications} from '../../app/notifications';
import {message, t} from "../../i18n";
import {Alert, Box, Button, Field, Select} from "@chakra-ui/react";
import {save} from '@tauri-apps/plugin-dialog';
import type {ComponentProps} from "react";
import {useEffect, useRef, useState} from 'react';
import {SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValueText} from "../../components/ui/select";
import {useResourceActive, useResourceInvoke} from '../editor/resource-context';
import {selectCollection} from '../editor/select-collection';
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
    const [loading, setLoading] = useState(t("Loading resource…"));
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
        setLoading(t("Loading resource…"));
        canvas.current?.getContext('2d')?.clearRect(0, 0, 512, 512);
        const fail = (reason: unknown) => {
            if (disposed) return;
            const details = String(reason);
            setLoading('');
            setError(details);
            if (embedded) {
                notifications.create({
                    id: 'gfx-error:' + file,
                    type: 'error',
                    title: t('Error'),
                    description: message(details)
                });
            }
            if (id !== undefined) {
                const failedSession = id;
                id = undefined;
                session.current = undefined;
                void invoke('native_gfx_close', {id: failedSession}).catch(() => {
                });
            }
        };
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
                setLoading(t("Preparing the first frame…"));
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
                        if (bytes.length !== width * height * 4) throw Error(t("Invalid native GFX frame: {value0} bytes", {value0: bytes.length}));
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
                        fail(e);
                    }
                };
                await frame();
            } catch (e) {
                fail(e);
            }
        })();
        return () => {
            disposed = true;
            session.current = undefined;
            clearTimeout(timer);
            if (id !== undefined) void invoke('native_gfx_close', {id});
        };
    }, [file, embedded]);
    const handleButtonClick: ComponentProps<typeof Button>["onClick"] = async () => {
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
            setExportStatus(t("GLB saved"));
        } catch (e) {
            setExportStatus(String(e));
        } finally {
            setExporting(false);
        }
    };
    const handleDivPointerDown: ComponentProps<"div">["onPointerDown"] = e => {
        if (!isModel || e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = {x: e.clientX, y: e.clientY};
    };
    const handleDivPointerMove: ComponentProps<"div">["onPointerMove"] = e => {
        if (!drag.current) return;
        const [yaw, pitch, zoom] = orbit.current;
        orbit.current = [yaw - (e.clientX - drag.current.x) * 0.01, Math.max(-1.5, Math.min(1.5, pitch + (e.clientY - drag.current.y) * 0.01)), zoom];
        drag.current = {x: e.clientX, y: e.clientY};
    };
    const handleDivWheel: ComponentProps<"div">["onWheel"] = e => {
        if (!isModel) return;
        e.stopPropagation();
        orbit.current = [orbit.current[0], orbit.current[1], Math.max(0.1, Math.min(10, orbit.current[2] * Math.exp(e.deltaY * 0.001)))];
    };
    if (embedded && error) return null;
    return <Box style={{
        position: embedded ? 'absolute' : 'relative',
        inset: embedded ? 0 : undefined,
        flex: 1,
        minHeight: embedded ? 0 : 300,
        display: 'flex',
        flexDirection: 'column',
        pointerEvents: embedded ? 'none' : undefined
    }}>
        {!embedded && <Box className="native-preview-toolbar">
            <Box className="native-preview-actions" role="group" aria-label={t("Preview controls")}>
                <Button disabled={!!loading || !!error} aria-pressed={paused} onClick={() => {
                    playing.current = !playing.current;
                    setPaused(!playing.current);
                }}><span aria-hidden="true">{paused ? '▶' : 'Ⅱ'}</span>{paused ? t("Resume") : t("Pause")}</Button>
                <Button disabled={!!loading || !!error} onClick={() => {
                    restart.current = true;
                }}>
                    <span aria-hidden="true">↺</span>{t("Restart")}</Button>
                {isModel && <Button disabled={!!loading || !!error} onClick={() => {
                    orbit.current = [Math.PI / 4, Math.atan(0.6 / Math.sqrt(2)), 1];
                }}><span aria-hidden="true">⌖</span>{t("Reset camera")}</Button>}
            </Box>
            {hasAnimations && <Field.Root width="auto"
                                          className="native-animation-picker"><Field.Label>{t("Animation")}{animation !== '' &&
                <span
                    title={animations[Number(animation)]?.track}>{animations[Number(animation)]?.track}</span>}</Field.Label><SelectRoot
                size="sm" lazyMount unmountOnExit minW="140px" collection={selectCollection(<>
                <option value="">{animations.length ? t("No animation") : t("No linked animations")}</option>
                {animations.map((action, index) => <option key={index} value={index}>{action.name}</option>)}</>)}
                value={[String(animation)]} onValueChange={async ({value: [value]}) => {
                setAnimation(value);
                pendingAnimation.current = value === '' ? 0xffffffff : Number(value);
            }} aria-label={t("STCK animation")}
                disabled={!!loading || !!error || !animations.length}><SelectTrigger><SelectValueText/></SelectTrigger><SelectContent><Select.Context>{select => select.collection.items.map(item =>
                <SelectItem key={select.collection.getItemValue(item)}
                            item={item}>{t(select.collection.stringifyItem(item))}</SelectItem>)}</Select.Context></SelectContent></SelectRoot></Field.Root>}
            {isModel && !/\.bon$/i.test(file) && <Box className="native-preview-actions">
                <Button disabled={!!loading || !!error || exporting}
                        title={t("Geometry, textures, skeleton and all linked animations")}
                        onClick={handleButtonClick}>{exporting ? t("Export…") : t("Export GLB")}</Button>
            </Box>}
            {exportStatus && <span role="status" className="native-preview-hint">{exportStatus}</span>}
            <Box className="native-preview-status"
                 data-state={error ? 'error' : loading ? 'loading' : paused ? 'paused' : 'ready'} role="status"
                 aria-live="polite">
                <span className="native-preview-status-dot" aria-hidden="true"/>
                <span className="native-preview-engine">gfx-native</span>
                <span>{error ? t("Error") : loading || (paused ? t("Pause") : t("Running"))}</span>
            </Box>
            {isModel && <span className="native-preview-hint">{t("Drag to rotate · Scroll to zoom")}</span>}
        </Box>}
        <Box ref={viewport} className={isModel ? 'native-model-viewport' : undefined}
             onPointerDown={handleDivPointerDown}
             onPointerMove={handleDivPointerMove}
             onPointerUp={() => {
                 drag.current = undefined;
             }} onLostPointerCapture={() => {
            drag.current = undefined;
        }}
             onWheel={handleDivWheel}
             style={{
                 position: 'relative',
                 flex: 1,
                 minHeight: 0,
                 overflow: embedded ? 'visible' : 'hidden',
                 background: embedded ? undefined : 'var(--chakra-colors-black)',
                 touchAction: isModel ? 'none' : undefined
             }}>
            {loading && !error && <Box className="gfx-loading"><ResourceLoading label={loading} detail={file}/></Box>}
            {error &&
                <Alert.Root status="error" size="sm"
                            role="alert"><Alert.Indicator/><Alert.Content>{message(error)}</Alert.Content></Alert.Root>}
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
        </Box>
    </Box>;
}
