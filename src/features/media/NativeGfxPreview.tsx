import {useEffect, useRef, useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {ResourceLoading} from './ResourceLoading';

export function NativeGfxPreview({file, embedded = false}: { file: string; embedded?: boolean }) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const playing = useRef(true), restart = useRef(false);
    const [paused, setPaused] = useState(false), [error, setError] = useState('');
    const [loading, setLoading] = useState('Загрузка эффекта…');
    useEffect(() => {
        let disposed = false, id: number | undefined, timer: ReturnType<typeof setTimeout>;
        setError('');
        setLoading('Загрузка эффекта…');
        canvas.current?.getContext('2d')?.clearRect(0, 0, 512, 512);
        void (async () => {
            try {
                id = await invoke<number>('native_gfx_create', {name: file, embedded});
                if (disposed) {
                    await invoke('native_gfx_close', {id});
                    return;
                }
                setLoading('Подготовка первого кадра…');
                let previous = performance.now();
                const frame = async () => {
                    if (disposed) return;
                    try {
                        const now = performance.now();
                        const delta = restart.current ? 0xffffffff : playing.current ? Math.min(100, Math.round(now - previous)) : 0;
                        restart.current = false;
                        previous = now;
                        const buffer = await invoke<ArrayBuffer>('native_gfx_frame', {id, delta});
                        const bytes = new Uint8ClampedArray(buffer);
                        if (bytes.length !== 512 * 512 * 4) throw Error(`Invalid native GFX frame: ${bytes.length} bytes`);
                        if (disposed) return;
                        const ctx = canvas.current?.getContext('2d');
                        if (ctx) {
                            const image = ctx.createImageData(512, 512);
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
        {!embedded && <div>
            <button onClick={() => {
                playing.current = !playing.current;
                setPaused(!playing.current);
            }}>{paused ? 'Воспроизвести' : 'Пауза'}</button>
            <button onClick={() => {
                restart.current = true;
            }}>Сначала
            </button>
            · Native GfxCommon</div>}
        <div style={{position: 'relative', flex: 1, minHeight: 0, overflow: embedded ? 'visible' : 'hidden'}}>
            {loading && !error && <div className="gfx-loading"><ResourceLoading label={loading} detail={file}/></div>}
            {error &&
                <p role="alert" style={{position: 'relative', zIndex: 1, color: '#ffb4a4', fontSize: 11}}>{error}</p>}
            <canvas ref={canvas} width={512} height={512} style={{
                position: 'absolute',
                visibility: error ? 'hidden' : 'visible',
                width: 512,
                height: 512,
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
