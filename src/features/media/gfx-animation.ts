export function numeric(source: string, key: string, fallback: number) {
    const value = new RegExp(`^${key}:\\s*([^\\r\\n]+)`, 'm').exec(source)?.[1];
    return value !== undefined && Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function keys(source: string) {
    return source.split(/InterpolateMode:\s*/).slice(1).map(block => {
        const pos = /^Position:\s*([^\r\n]+)/m.exec(block)?.[1].split(',').map(Number) ?? [0, 0, 0];
        return {
            mode: Number(block.split(/\s/)[0]),
            duration: Math.max(0, numeric(block, 'TimeSpan', 0)),
            x: pos[0] || 0,
            y: pos[1] || 0,
            scale: numeric(block, 'Scale', 1),
            rotation: numeric(block, 'Rad_2D', 0),
            color: numeric(block, 'Color', 4294967295) >>> 0
        };
    });
}

export function sampleKey(frames: ReturnType<typeof keys>, time: number) {
    if (!frames.length) return {x: 0, y: 0, scale: 1, rotation: 0, alpha: 1};
    let index = 0;
    while (index < frames.length - 1 && time >= frames[index].duration) time -= frames[index++].duration;
    const a = frames[index], b = frames[Math.min(index + 1, frames.length - 1)];
    const t = a.mode === 0 || !a.duration ? 0 : Math.max(0, Math.min(1, time / a.duration));
    const lerp = (x: number, y: number) => x + (y - x) * t;
    return {
        x: lerp(a.x, b.x),
        y: lerp(a.y, b.y),
        scale: lerp(a.scale, b.scale),
        rotation: lerp(a.rotation, b.rotation),
        alpha: lerp(a.color >>> 24, b.color >>> 24) / 255
    };
}

// Stable random values make pause, seeking and restart deterministic.
export function random(seed: number) {
    let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
    x ^= x >>> 13;
    return (x >>> 0) / 4294967296;
}
