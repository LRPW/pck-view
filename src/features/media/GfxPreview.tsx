import {t} from "../../i18n";
import {Box, Button} from "@chakra-ui/react";
import {useEffect, useMemo, useState} from 'react';
import {useResourceInvoke} from '../editor/resource-context';
import {useInterfaceTextures} from './InterfaceTextures';
import {NativeGfxPreview} from "./NativeGfxPreview";
import {ResourceLoading} from "./ResourceLoading";
import {keys, random, sampleKey} from "./gfx-animation";

function LegacyGfxPreview({bytes, file, entries = [], embedded = false}: {
    bytes?: number[];
    file?: string;
    entries?: { name: string }[];
    embedded?: boolean
}) {
    const invoke = useResourceInvoke();
    const [loaded, setLoaded] = useState<number[]>(), [error, setError] = useState('');
    const [playing, setPlaying] = useState(true), [time, setTime] = useState(0);
    useEffect(() => {
        let disposed = false;
        setLoaded(undefined);
        setError('');
        if (!bytes && file) void invoke<number[]>('read_surface_texture', {name: file}).then(b => {
            if (!disposed) setLoaded(b);
        }).catch(e => {
            if (!disposed) setError(String(e));
        });
        return () => {
            disposed = true;
        };
    }, [bytes, file]);
    const model = useMemo(() => {
        const data = bytes ?? loaded;
        if (!data) return null;
        let source: string;
        try {
            source = new TextDecoder('utf-8', {fatal: true}).decode(new Uint8Array(data));
        } catch {
            source = new TextDecoder('gbk').decode(new Uint8Array(data));
        }
        const blocks = source.split(/GFXELEMENTID:\s*/).slice(1);
        const doc = document.implementation.createDocument(null, 'Resources');
        const elements = blocks.map(block => {
            const field = (key: string, fallback = '') => new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(block)?.[1].trim() ?? fallback;
            const n = (key: string, fallback: number) => {
                const v = Number(field(key));
                return field(key) && Number.isFinite(v) ? v : fallback;
            };
            const texture = field('TexFile');
            const path = texture ? (/^gfx[\\/]/i.test(texture) ? texture : `gfx/textures/${texture}`) : '';
            if (path) {
                const node = doc.createElement('Image');
                node.setAttribute('FileName', path);
                doc.documentElement.appendChild(node);
            }
            const position = field('Position', '0,0,0').split(',').map(Number);
            return {
                frames: keys(block),
                repeat: n("RepeatCount", 1),
                delay: n("RepeatDelay", 0),
                rate: Math.max(0, n("EmissionRate", 0)),
                ttl: Math.max(0.001, n("TTL", 1)),
                speed: n("Speed", 0),
                angle: n("Angle", 0),
                quota: Math.min(750, Math.max(0, n("Quota", 100))),
                pw: n("ParticleWidth", 1),
                ph: n("ParticleHeight", 1),
                scaleMin: n("ScaleMin", 1),
                scaleMax: n("ScaleMax", 1),
                id: Number(block.split(/\s/)[0]),
                path,
                width: n('Width', 0),
                height: n('Height', 0),
                x: position[0] || 0,
                y: position[1] || 0,
                rows: Math.max(1, n('TexRow', 1)),
                cols: Math.max(1, n('TexCol', 1)),
                interval: Math.max(1, n('TexInterval', 100)),
                scale: n('Scale', 1),
                rotation: n('Rad_2D', 0),
                start: n('StartTime', 0),
                span: n('TimeSpan', 1000),
                additive: n('DestBlend', 0) === 2,
                supported: [101, 120].includes(Number(block.split(/\s/)[0])) && !/CtrlType:/.test(block) && n("AffectorCount", 0) === 0 && n("Acc", 0) === 0 && n("ParAcc", 0) === 0 && n("IsDrag", 0) === 0 && !/BindEle:[ \t]*[^\s\r\n]+/m.test(block)
            };
        });
        return {elements, resources: doc.documentElement};
    }, [bytes, loaded]);
    const {textures, missing, progress, loading} = useInterfaceTextures(model?.resources ?? null, entries);
    useEffect(() => {
        if (!playing) return;
        let frame = 0, previous = performance.now();
        const tick = (now: number) => {
            setTime(t => t + Math.min(now - previous, 100));
            previous = now;
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [playing]);
    const unsupported = model?.elements.filter(e => !e.supported).length ?? 0;
    return <Box style={{
        position: embedded ? 'absolute' : 'relative',
        inset: embedded ? 0 : undefined,
        flex: 1,
        minHeight: embedded ? 0 : 300,
        overflow: 'hidden',
        pointerEvents: embedded ? 'none' : undefined
    }}>
        {!embedded && <Box style={{position: 'relative', zIndex: 2}}>
            <Button onClick={() => setPlaying(p => !p)}>{playing ? t("Pause") : t("Play")}</Button>
            <Button onClick={() => setTime(0)}>{t("Restart")}</Button>
            {t("· Partial GFX support: 2D decals, position/scale/angle/alpha keys, point particles without affectors.")}
        </Box>}
        {(error || (model && !model.elements.length)) &&
            <span>{error || "Unsupported GFX format (no text GFXELEMENTID)"}</span>}
        {unsupported > 0 &&
            <span style={{
                fontSize: 10,
                color: 'var(--chakra-colors-fg-warning)'
            }}>{t("Unsupported GFX layers: ")}{unsupported}</span>}
        {loading &&
            <ResourceLoading label={t("Loading effect textures")} completed={progress.completed} total={progress.total}
                             detail={progress.current}/>}
        {!embedded && missing.length > 0 && <Box>{t("Missing GFX textures: ")}{missing.join(', ')}</Box>}
        {model?.elements.filter(e => e.supported).map((e, i) => {
            const texture = textures[e.path];
            if (!texture || time < e.start) return null;
            const duration = e.frames.reduce((sum, key) => sum + key.duration, 0) || e.span;
            const elapsed = time - e.start;
            const cycle = Math.max(1, duration + e.delay);
            if (e.repeat > 0 && elapsed >= cycle * e.repeat) return null;
            const local = elapsed % cycle;
            if (local >= duration) return null;
            const state = sampleKey(e.frames, local);
            const frame = Math.floor(local / e.interval) % (e.rows * e.cols);
            const width = (e.width || texture.width / e.cols) * state.scale,
                height = (e.height || texture.height / e.rows) * state.scale;
            const sprites = e.id === 120 ? Array.from({length: Math.min(e.quota, Math.ceil(e.rate * e.ttl))}, (_, p) => {
                const birth = Math.floor(local / 1000 * e.rate) - p;
                const age = local / 1000 - birth / Math.max(0.001, e.rate);
                if (birth < 0 || age >= e.ttl) return null;
                const a = random(birth + 1) * Math.PI * 2;
                const radial = e.speed * Math.sin(random(birth + 982) * e.angle) * age;
                const scale = (e.scaleMin + random(birth + 83) * (e.scaleMax - e.scaleMin)) * state.scale;
                return {
                    x: state.x + Math.cos(a) * radial,
                    y: state.y + Math.sin(a) * radial,
                    width: e.pw * scale,
                    height: e.ph * scale
                };
            }).filter((p): p is NonNullable<typeof p> => p !== null) : [{x: state.x, y: state.y, width, height}];
            return sprites.map((sprite, p) => <span key={`${i}:${p}`} style={{
                position: 'absolute',
                left: `calc(50% + ${sprite.x}px)`,
                top: `calc(50% + ${-sprite.y}px)`,
                width: sprite.width,
                height: sprite.height,
                opacity: state.alpha,
                transform: `translate(-50%, -50%) rotate(${state.rotation}rad)`,
                backgroundImage: `url("${texture.url}")`,
                backgroundSize: `${e.cols * 100}% ${e.rows * 100}%`,
                backgroundPosition: `${e.cols > 1 ? frame % e.cols * 100 / (e.cols - 1) : 0}% ${e.rows > 1 ? Math.floor(frame / e.cols) * 100 / (e.rows - 1) : 0}%`,
                mixBlendMode: e.additive ? 'screen' : 'normal'
            }}/>);
        })}
    </Box>;
}

export function GfxPreview(props: {
    bytes?: number[];
    file?: string;
    entries?: { name: string }[];
    embedded?: boolean
}) {
    return props.file ? <NativeGfxPreview file={props.file} embedded={props.embedded}/> :
        <LegacyGfxPreview {...props} />;
}
