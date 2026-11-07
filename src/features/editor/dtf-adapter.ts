import {legacyRows} from './legacy-interface';
import {dtfLayout, type DtfLayout} from './dtf-layout';

const quote = (value: string) => {
    if (value.includes('"')) throw Error('Quotes are not allowed in this format');
    return '"' + value + '"';
};

export function stfValues(stf: string) {
    return Object.fromEntries(legacyRows(stf, 'stf').map(row => [row[0].value, row[1].value]));
}

const versionOf = (strings: Record<string, string>) => Number(strings['-1'] ?? 0);
const colorStart = (tag: string) => tag === 'LABEL' ? 11 : tag === 'STILLIMAGEBUTTON' ? 14 : ['TEXT', 'LIST', 'TREE', 'COMBO'].includes(tag) ? 10 : tag === 'EDIT' ? 11 : tag === 'DIALOG' ? 19 : -1;

function textNode(element: Element) {
    return Array.from(element.children).find(e => e.tagName === 'Text');
}

export function dtfToXml(source: string, strings: Record<string, string> = {}) {
    const rows = legacyRows(source, 'dtf'), version = versionOf(strings);
    const first = rows.findIndex(row => row[0].value.toUpperCase() === 'DIALOG');
    if (first < 0) throw Error('DTF dialog not found');
    const doc = document.implementation.createDocument(null, 'DIALOG');
    rows.forEach((row, index) => {
        if (row.length < 8 && index !== first) return;
        const tag = row[0].value.toUpperCase(),
            element = index === first ? doc.documentElement : doc.createElement(tag);
        if (index !== first) doc.documentElement.appendChild(element);
        element.setAttribute('DtfRow', String(index));
        let layout: DtfLayout;
        try {
            layout = dtfLayout(tag, version, row.length);
        } catch {
            layout = {
                attributes: {Name: 1, Command: 2, SoundEffect: 3, x: 4, y: 5, Width: 6, Height: 7},
                resources: {},
                defaults: []
            };
        }
        for (const [key, pos] of Object.entries(layout.attributes)) if (row[pos]) element.setAttribute(key, tag === 'EDIT' && key === 'Password' ? (row[pos].value === 'PASSWORD' ? 'true' : 'false') : row[pos].value);
        if (Object.keys(layout.resources).length) {
            const resource = doc.createElement('Resource');
            element.appendChild(resource);
            for (const [key, pos] of Object.entries(layout.resources)) {
                if (!row[pos]) continue;
                const image = doc.createElement(key);
                image.setAttribute('FileName', row[pos]?.value ?? '');
                resource.appendChild(image);
            }
        }
        if (layout.font !== undefined || layout.text !== undefined) {
            const text = doc.createElement('Text');
            element.appendChild(text);
            text.setAttribute('String', strings[row[layout.text ?? -1]?.value] ?? '');
            const font = (strings[row[layout.font ?? -1]?.value] ?? 'text').split('###');
            ['FontName', 'Shadow', 'Outline', 'Bold', 'Italic'].forEach((key, i) => text.setAttribute(key, font[i] ?? (i ? '0' : 'text')));
            text.setAttribute('FontSize', row[layout.size ?? -1]?.value ?? '12');
            const c = colorStart(tag);
            if (c >= 0) text.setAttribute('Color', row.slice(c, c + (tag === 'DIALOG' || tag === 'EDIT' ? 3 : 4)).map(t => t.value).join(','));
        }
    });
    return {xml: new XMLSerializer().serializeToString(doc), rows};
}

export function xmlToDtf(source: string, xml: string, baseline: string, stf = '') {
    const rows = legacyRows(source, 'dtf'), strings = stfValues(stf), version = versionOf(strings);
    let outputStf = stf;
    const allocate = (value: string) => {
        const match = Object.entries(strings).find(([id, text]) => Number(id) >= 0 && text === value);
        if (match) return match[0];
        let id = 1;
        while (String(id) in strings) id++;
        strings[id] = value;
        outputStf += (outputStf && !/[\r\n]$/.test(outputStf) ? '\r\n' : '') + id + '\t' + quote(value) + '\r\n';
        return String(id);
    };
    const doc = new DOMParser().parseFromString(xml, 'application/xml'),
        before = new DOMParser().parseFromString(baseline, 'application/xml');
    if (doc.querySelector('parsererror')) throw Error('Invalid interface XML');
    const originals = new Map(Array.from(before.querySelectorAll('[DtfRow]')).map(e => [e.getAttribute('DtfRow'), e]));
    const controls = [doc.documentElement, ...Array.from(doc.documentElement.children).filter(e => e.tagName !== 'Resource' && e.tagName !== 'Text')];
    const rendered: { id: number; line: string }[] = [];
    for (const element of controls) {
        const tag = element.tagName.toUpperCase(), id = element.getAttribute('DtfRow'),
            index = id === null ? -1 : Number(id), old = originals.get(id);
        let layout: DtfLayout;
        try {
            layout = dtfLayout(tag, version);
        } catch (error) {
            if (old && new XMLSerializer().serializeToString(element) === new XMLSerializer().serializeToString(old)) {
                rendered.push({id: index, line: source.slice(rows[index][0].start, rows[index].at(-1)!.end)});
                continue;
            }
            throw error;
        }
        const supported = new Set([...Object.keys(layout.attributes), 'DtfRow']);
        for (const attribute of Array.from(element.attributes)) if (!supported.has(attribute.name) && attribute.value !== old?.getAttribute(attribute.name)) throw Error('This property cannot be stored in the DTF format: ' + attribute.name);
        const existing = index >= 0 ? rows[index] : undefined;
        let tokens = existing ? existing.map(t => source.slice(t.start, t.end)) : [...layout.defaults];
        const set = (pos: number, value: string, quoted = false) => {
            while (tokens.length <= pos) tokens.push('0');
            tokens[pos] = quoted ? quote(value) : value;
        };
        for (const [key, pos] of Object.entries(layout.attributes)) {
            const value = element.getAttribute(key);
            if (value === null) continue;
            if (old && value === old.getAttribute(key)) continue;
            set(pos, tag === 'EDIT' && key === 'Password' ? (value === 'true' ? 'PASSWORD' : 'TEXT') : value === 'true' ? '1' : value === 'false' ? '0' : value, pos === 1 || key === 'Command' || key === 'SoundEffect' || key === 'Columns');
        }
        const resource = Array.from(element.children).find(e => e.tagName === 'Resource');
        for (const [key, pos] of Object.entries(layout.resources)) {
            const image = resource && Array.from(resource.children).find(e => e.tagName === key);
            if (image) set(pos, image.getAttribute('FileName') ?? '', true);
        }
        const text = textNode(element), oldText = old && textNode(old);
        if (text) {
            if (layout.text === undefined && text.getAttribute('String') && (text.getAttribute('String') !== oldText?.getAttribute('String'))) throw Error('This DTF control stores text only at runtime');
            if (layout.text !== undefined && (!oldText || text.getAttribute('String') !== oldText.getAttribute('String'))) set(layout.text, allocate(text.getAttribute('String') ?? ''));
            const fontKeys = ['FontName', 'Shadow', 'Outline', 'Bold', 'Italic'];
            if (layout.font !== undefined && (!oldText || fontKeys.some(k => text.getAttribute(k) !== oldText.getAttribute(k)))) set(layout.font, allocate(fontKeys.map((k, i) => {
                const v = text.getAttribute(k) ?? (i ? '0' : 'text');
                return v === 'true' ? '1' : v === 'false' ? '0' : v;
            }).join('###')));
            if (layout.size !== undefined && text.hasAttribute('FontSize')) set(layout.size, text.getAttribute('FontSize')!);
            const c = colorStart(tag);
            if (c >= 0 && text.hasAttribute('Color')) {
                let colors = (text.getAttribute('Color') ?? '').split(',');
                if (colors.length === 1 && /^#?[0-9a-f]{6,8}$/i.test(colors[0])) colors = (colors[0].replace('#', '').match(/../g) ?? []).map(v => String(parseInt(v, 16)));
                for (let i = 0; i < (tag === 'EDIT' || tag === 'DIALOG' ? 3 : 4); i++) set(c + i, colors[i] ?? '255');
            }
        }
        if (existing) {
            let line = source.slice(existing[0].start, existing.at(-1)!.end);
            for (let i = existing.length - 1; i >= 0; i--) {
                const token = existing[i];
                line = line.slice(0, token.start - existing[0].start) + tokens[i] + line.slice(token.end - existing[0].start);
            }
            if (tokens.length > existing.length) line += ' ' + tokens.slice(existing.length).join(' ');
            rendered.push({id: index, line});
        } else rendered.push({id: -1, line: tokens.join(' ')});
    }
    // Keep non-control text and comments; replace each original control slot in visual order.
    const slots = [...originals.keys()].map(Number).sort((a, b) => a - b);
    const patches: { start: number; end: number; value: string }[] = [];
    slots.forEach((index, order) => patches.push({
        start: rows[index][0].start,
        end: rows[index].at(-1)!.end,
        value: rendered[order]?.line ?? ''
    }));
    let dtf = source;
    for (const patch of patches.sort((a, b) => b.start - a.start)) dtf = dtf.slice(0, patch.start) + patch.value + dtf.slice(patch.end);
    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    if (rendered.length > slots.length) dtf += (dtf && !/[\r\n]$/.test(dtf) ? newline : '') + rendered.slice(slots.length).map(r => r.line).join(newline) + newline;
    return {dtf, stf: outputStf};
}
