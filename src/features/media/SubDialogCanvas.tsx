import {flexLayout} from './flex-layout';
import {uiTextStyle} from './ui-text-style';
import {useGameFontFamily} from "./GameFonts";
import {ResourceLoading} from "./ResourceLoading";
import {GfxPreview} from "./GfxPreview";
import {useEffect, useState} from 'react';
import {useResourceInvoke} from '../editor/resource-context';
import {attr, TextureFrame, useInterfaceTextures} from './InterfaceTextures';

const normalize = (name: string) => name.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
const num = (e: Element, key: string, fallback: number) => {
    const raw = attr(e, key), value = Number(raw);
    return raw && Number.isFinite(value) ? Math.max(-10000, Math.min(10000, value)) : fallback;
};

function decode(bytes: Uint8Array) {
    let encoding = 'utf-8';
    if (bytes[0] === 255 && bytes[1] === 254) encoding = 'utf-16le';
    else if (bytes[0] === 254 && bytes[1] === 255) encoding = 'utf-16be';
    else {
        try {
            new TextDecoder('utf-8', {fatal: true}).decode(bytes);
        } catch {
            encoding = 'gbk';
        }
    }
    return new TextDecoder(encoding).decode(bytes).replace(/^[\s\uFEFF]+/, '').replace(/\u0000+$/, '');
}

export function SubDialogCanvas({file, parentFile = '', entries, ancestors = []}: {
    file: string; parentFile?: string; entries: { name: string }[]; ancestors?: string[];
}) {
    const invoke = useResourceInvoke();
    const fontFamily = useGameFontFamily();
    const [model, setModel] = useState<Element | null>(null);
    const [error, setError] = useState('');
    const current = normalize(parentFile);
    const requested = normalize(file);
    const candidates = [current.slice(0, current.lastIndexOf('/') + 1) + requested, requested, `interfaces/${requested}`];
    const index = candidates.map(path => entries.findIndex(e => normalize(e.name) === path)).find(i => i >= 0) ?? -1;
    const resolved = index >= 0 ? entries[index].name : file;
    const cycle = ancestors.includes(normalize(resolved)) || ancestors.length >= 12;
    useEffect(() => {
        let cancelled = false;
        setModel(null);
        setError('');
        if (cycle || index < 0) {
            setError(cycle ? 'Циклический SUBDIALOG' : `Не найден: ${file}`);
            return;
        }
        void invoke<number[]>('read_entry', {index}).then(data => {
            if (cancelled) return;
            const doc = new DOMParser().parseFromString(decode(new Uint8Array(data)), 'application/xml');
            const root = Array.from(doc.getElementsByTagName('*')).find(e => e.tagName.toUpperCase() === 'DIALOG');
            if (doc.querySelector('parsererror') || !root) throw Error('Некорректный XML SUBDIALOG');
            setModel(root);
        }).catch(reason => {
            if (!cancelled) setError(String(reason));
        });
        return () => {
            cancelled = true;
        };
    }, [index, cycle, file, entries]);
    const {textures, progress, loading} = useInterfaceTextures(model, entries);
    if (error) return <span style={{fontSize: 10, color: '#ffb4a4'}}>{error}</span>;
    if (!model) return <ResourceLoading label="Загрузка сабдиалога…" detail={file}/>;
    return <span style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: Math.max(0, num(model, 'Width', 0)),
        height: Math.max(0, num(model, 'Height', 0)),
        pointerEvents: 'none'
    }}>
        {loading && <ResourceLoading label="Загрузка текстур" completed={progress.completed} total={progress.total}/>}
        <TextureFrame element={model} textures={textures}/>
        {[...flexLayout(model).values()].map((box, i) => {
            const e = box.element;
            const text = Array.from(e.children).find(c => c.tagName.toUpperCase() === 'TEXT');
            const nested = e.tagName.toUpperCase() === 'SUBDIALOG';
            return <span key={i} style={{
                position: 'absolute',
                left: box.x,
                top: box.y,
                width: box.width,
                height: box.height,
                overflow: nested ? 'hidden' : 'visible',
                fontSize: text ? num(text, 'FontSize', 12) : 12,
                fontFamily: text ? fontFamily(attr(text, 'FontName')) : undefined,
                whiteSpace: 'nowrap',
                lineHeight: 1,
                textAlign: /BUTTON/.test(e.tagName) ? 'center' : 'left',
                ...uiTextStyle(text)
            }}>
                <TextureFrame element={e}
                              textures={textures}/>{(e.tagName.toUpperCase() === 'DIV' ? [] : Array.from(e.getElementsByTagName("*"))).filter(r => r.tagName.toUpperCase() === "GFX").map((r, n) =>
                <GfxPreview key={n} file={r.getAttribute("FileName") ?? ""} entries={entries} embedded/>)}
                {nested && attr(e, 'DialogFile') &&
                    <SubDialogCanvas file={attr(e, 'DialogFile')} parentFile={resolved} entries={entries}
                                     ancestors={[...ancestors, normalize(resolved)]}/>}
                <span style={{position: 'relative'}}>{text && attr(text, 'String')}</span>
            </span>;
        })}
    </span>;
}
