import {t, useLanguage} from '../../i18n/index';
import {useEffect, useState} from 'react';
import {ImageViewer} from './ImageViewer';

const formats: Record<string, string> = {
    dds: 'image/x-dds', tga: 'image/x-tga', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif',
    ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', mp3: 'audio/mpeg',
    wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac',
    mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg',
};

export function mediaType(name: string) {
    return formats[name.split('.').pop()?.toLowerCase() ?? ''];
}

export function MediaPreview({name, bytes}: { name: string; bytes: number[] }) {
    useLanguage();
    const mime = mediaType(name);
    const [url, setUrl] = useState('');
    const [error, setError] = useState(false);


    useEffect(() => {
        setError(false);
        setUrl('');
        let disposed = false, src: string | undefined, worker: Worker | undefined;
        const publish = (blob: Blob) => {
            if (disposed) return;
            src = URL.createObjectURL(blob);
            setUrl(src);
        };
        if (mime === 'image/x-dds' || mime === 'image/x-tga') {
            worker = new Worker(new URL('./texture.worker.ts', import.meta.url), {type: 'module'});
            worker.onmessage = (event: MessageEvent<{
                width: number;
                height: number;
                pixels: Uint8ClampedArray;
                error?: string
            }>) => {
                if (disposed) return;
                if (event.data.error) {
                    setError(true);
                    worker?.terminate();
                    return;
                }
                try {
                    const {width, height, pixels} = event.data, canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const context = canvas.getContext('2d');
                    if (!context) throw Error(t('Canvas недоступен'));
                    const image = context.createImageData(width, height);
                    image.data.set(pixels);
                    context.putImageData(image, 0, 0);
                    canvas.toBlob(blob => {
                        if (blob) publish(blob); else if (!disposed) setError(true);
                    }, 'image/png');
                } catch {
                    setError(true);
                } finally {
                    worker?.terminate();
                }
            };
            worker.onerror = () => {
                if (!disposed) setError(true);
                worker?.terminate();
            };
            const data = new Uint8Array(bytes);
            worker.postMessage({extension: mime === 'image/x-dds' ? 'dds' : 'tga', bytes: data}, [data.buffer]);
        } else publish(new Blob([new Uint8Array(bytes)], {type: mime}));
        return () => {
            disposed = true;
            worker?.terminate();
            if (src) URL.revokeObjectURL(src);
        };
    }, [bytes, mime]);
    if (!url && !error) return <div className="media-preview"><p>{t("Загрузка текстуры…")}</p></div>;
    return <div className="media-preview">
        {error ? <p>{t("Не удалось открыть файл. Формат или кодек не поддерживается, либо файл повреждён.")}</p>
            : mime?.startsWith('image/') ? <ImageViewer key={url} src={url} name={name}
                                                        onError={() => setError(true)}/> : mime?.startsWith('audio/') ?
                <div className="audio-stage">
                    <span aria-hidden className="audio-icon">♫</span>
                    <audio key={url} src={url} controls preload="metadata" onError={() => setError(true)}/>
                </div> : <video key={url} src={url} controls preload="metadata" onError={() => setError(true)}/>}
    </div>;
}
