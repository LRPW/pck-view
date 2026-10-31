import {useEffect, useState, type CSSProperties} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {decodeDds, decodeTga} from '../../lib/textures/texture-decode';

export const attr = (e: Element, name: string) => Array.from(e.attributes).find(a => a.name.toLowerCase() === name.toLowerCase())?.value ?? '';
const normalize = (s: string) => s.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
export type UiTexture = { url: string; width: number; height: number };

export function useInterfaceTextures(model: Element | null, entries: { name: string }[]) {
    const [textures, setTextures] = useState<Record<string, UiTexture>>({});
    const [missing, setMissing] = useState<string[]>([]);
    const [progress, setProgress] = useState({completed: 0, total: 0, current: ''});
    useEffect(() => {
        let disposed = false;
        const urls: string[] = [];
        setTextures({});
        setMissing([]);
        const index = new Map(entries.map((e, i) => [normalize(e.name), i]));
        const paths = model ? [...new Set(Array.from(model.getElementsByTagName('*')).map(e => attr(e, 'FileName')).filter(path => !!path && !/\.gfx$/i.test(path)))] : [];
        setProgress({completed: 0, total: paths.length, current: paths[0] ?? ''});
        void (async () => {
            for (const path of paths) {
                if (disposed) break;
                setProgress(old => ({...old, current: path}));
                try {
                    const p = normalize(path);
                    const i = [p, `surfaces/${p}`, `interfaces/${p}`].map(k => index.get(k)).find(v => v !== undefined);
                    const bytes = new Uint8Array(i === undefined
                        ? await invoke<number[]>('read_surface_texture', {name: path})
                        : await invoke<number[]>('read_entry', {index: i}));
                    if (disposed) break;
                    const ext = p.split('.').pop();
                    let blob: Blob, width: number, height: number;
                    if (ext === 'dds' || ext === 'tga') {
                        const image = (ext === 'dds' ? decodeDds : decodeTga)(bytes);
                        width = image.width;
                        height = image.height;
                        const canvas = document.createElement('canvas');
                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        if (!ctx) throw Error('canvas');
                        const data = ctx.createImageData(width, height);
                        data.data.set(image.pixels);
                        ctx.putImageData(data, 0, 0);
                        blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(Error('PNG')), 'image/png'));
                    } else {
                        const mime: Record<string, string> = {
                            png: 'image/png',
                            jpg: 'image/jpeg',
                            jpeg: 'image/jpeg',
                            bmp: 'image/bmp'
                        };
                        if (!mime[ext ?? '']) throw Error('format');
                        blob = new Blob([bytes], {type: mime[ext!]});
                        const bitmap = await createImageBitmap(blob);
                        width = bitmap.width;
                        height = bitmap.height;
                        bitmap.close();
                    }
                    if (disposed) break;
                    const url = URL.createObjectURL(blob);
                    urls.push(url);
                    setTextures(old => ({...old, [path]: {url, width, height}}));
                } catch {
                    if (!disposed) setMissing(old => [...old, path]);
                } finally {
                    if (!disposed) setProgress(old => ({...old, completed: old.completed + 1}));
                }
            }
        })();
        return () => {
            disposed = true;
            urls.forEach(URL.revokeObjectURL);
        };
    }, [model, entries]);
    return {textures, missing, progress, loading: progress.completed < progress.total};
}

export function TextureFrame({element, textures}: { element: Element; textures: Record<string, UiTexture> }) {
    const [hover, setHover] = useState(false), [down, setDown] = useState(false);
    const resources = Array.from(element.children).find(e => e.tagName.toUpperCase() === 'RESOURCE');
    const find = (name: string) => resources && Array.from(resources.children).find(e => e.tagName.toLowerCase() === name.toLowerCase());
    const node = (down && find('FrameDownImage')) || (hover && find('FrameOnHoverImage')) || find('FrameUpImage') || find('FrameImage') || find('Image');
    const texture = node && textures[attr(node, 'FileName')];
    let style: CSSProperties = {position: 'absolute', inset: 0, pointerEvents: 'none'};
    if (texture) {
        const {width: w, height: h, url} = texture;
        let mode = Number(attr(node!, 'FrameMode') || attr(element, 'FrameMode') || 0);
        if (!mode) mode = w % 3 === 0 && h % 3 === 0 ? 2 : w % 4 === 0 && h % 4 === 0 ? 3 : w % 3 === 0 ? 4 : h % 3 === 0 ? 5 : 1;
        const x = mode === 2 || mode === 4 ? w / 3 : mode === 3 ? w / 4 : 0;
        const y = mode === 2 || mode === 5 ? h / 3 : mode === 3 ? h / 4 : 0;
        // Borders must not contribute to the element's layout: small controls
        // can be narrower than the combined corners of the source texture.
        style = {
            ...style, boxSizing: 'border-box', minWidth: 0, minHeight: 0,
            borderStyle: 'solid', borderColor: 'transparent', borderWidth: 0,
            borderImage: `url("${url}") ${y} ${x} fill / ${y}px ${x}px / 0 stretch`
        };
        if (mode === 1 || node!.tagName.toLowerCase() === 'image') style = {
            position: 'absolute',
            inset: 0,
            backgroundImage: `url("${url}")`,
            backgroundSize: '100% 100%',
            pointerEvents: 'none'
        };
    }
    return <span onMouseEnter={() => setHover(true)} onMouseLeave={() => {
        setHover(false);
        setDown(false);
    }} onMouseDown={() => setDown(true)} onMouseUp={() => setDown(false)} style={{position: 'absolute', inset: 0}}><span
        style={style}/></span>;
}
