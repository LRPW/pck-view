// SFNT name records carry both localized Windows family names and Latin aliases.
export function fontNames(buffer: ArrayBuffer): string[] {
    const view = new DataView(buffer), names = new Set<string>();
    const valid = (offset: number, size: number) => offset >= 0 && offset + size <= view.byteLength;
    const tag = (offset: number) => String.fromCharCode(...new Uint8Array(buffer, offset, 4));
    if (!valid(0, 12)) throw Error('Truncated font');
    const base = tag(0) === 'ttcf' ? view.getUint32(12) : 0;
    if (!valid(base, 12)) throw Error('Invalid font header');
    const count = view.getUint16(base + 4);
    if (!valid(base + 12, count * 16)) throw Error('Truncated font directory');
    for (let i = 0; i < count; i++) {
        const table = base + 12 + i * 16;
        if (tag(table) !== 'name') continue;
        const offset = view.getUint32(table + 8), length = view.getUint32(table + 12);
        if (!valid(offset, length) || length < 6) throw Error('Invalid font name table');
        const records = view.getUint16(offset + 2), strings = offset + view.getUint16(offset + 4);
        if (6 + records * 12 > length) throw Error('Truncated font names');
        for (let n = 0; n < records; n++) {
            const record = offset + 6 + n * 12;
            const platform = view.getUint16(record), id = view.getUint16(record + 6);
            if (![1, 4, 6, 16].includes(id) || ![0, 3].includes(platform)) continue;
            const size = view.getUint16(record + 8), start = strings + view.getUint16(record + 10);
            if (!valid(start, size) || start + size > offset + length || size % 2) continue;
            const name = new TextDecoder('utf-16be').decode(new Uint8Array(buffer, start, size)).replace(/\0/g, '').trim();
            if (name) names.add(name);
        }
    }
    return Array.from(names);
}
