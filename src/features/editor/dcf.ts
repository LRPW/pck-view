export type DcfRow = { line: number; file: string; x: number; y: number; visible: boolean; tokens: [number, number][] };

export function parseDcf(text: string) {
    const lines = text.split(/\r\n|\n|\r/);
    const rows: DcfRow[] = [];
    const invalid: number[] = [];
    lines.forEach((line, index) => {
        if (!line.replace(/^\uFEFF/, '').trim() || /^\s*(?:\uFEFF)?\s*(?:#|\/\/)/.test(line)) return;
        const tokens = Array.from(line.matchAll(/"[^"\r\n]*"|[^\s\uFEFF]+/g));
        if (tokens.length < 4 || !tokens[0][0].replace(/^"|"$/g, '').toLowerCase().endsWith('.xml') || !tokens.slice(1, 4).every(t => /^-?\d+$/.test(t[0]))) {
            invalid.push(index + 1);
            return;
        }
        rows.push({
            line: index,
            file: tokens[0][0].replace(/^"|"$/g, ''),
            x: Number(tokens[1][0]),
            y: Number(tokens[2][0]),
            visible: Number(tokens[3][0]) !== 0,
            tokens: tokens.slice(0, 4).map(t => [t.index!, t.index! + t[0].length])
        });
    });
    return {lines, rows, invalid};
}

export function updateDcf(text: string, row: DcfRow, column: number, value: string) {
    const parsed = parseDcf(text);
    const line = parsed.lines[row.line];
    const [start, end] = row.tokens[column];
    parsed.lines[row.line] = line.slice(0, start) + value + line.slice(end);
    return parsed.lines.join(text.includes('\r\n') ? '\r\n' : text.includes('\r') ? '\r' : '\n');
}

export function appendDcfRow(text: string, file: string) {
    const newline = text.includes('\r\n') ? '\r\n' : text.includes('\r') ? '\r' : '\n';
    return text + (text && !/[\r\n]$/.test(text) ? newline : '') + file + ' 0 0 0' + newline;
}

export function deleteDcfRow(text: string, row: DcfRow) {
    const chunks = text.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) ?? [];
    chunks.splice(row.line, 1);
    let result = chunks.join('');
    if (text.startsWith('\uFEFF') && !result.startsWith('\uFEFF')) result = '\uFEFF' + result;
    return result;
}

export function dcfFileKey(file: string) {
    const normalized = file.trim().replace(/\\/g, '/').toLowerCase();
    const marker = normalized.lastIndexOf('interfaces/');
    const relative = marker >= 0 ? normalized.slice(marker + 11) : normalized;
    const parts: string[] = [];
    for (const part of relative.split('/')) {
        if (!part || part === '.') continue;
        if (part === '..' && parts.length && parts.at(-1) !== '..') parts.pop(); else parts.push(part);
    }
    return parts.join('/');
}

export function validateDcf(rows: DcfRow[], files: string[]) {
    const available = new Set(files.map(dcfFileKey));
    const counts = new Map<string, number>();
    for (const row of rows) {
        const key = dcfFileKey(row.file);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Map(rows.map(row => [row.line, {
        missing: !available.has(dcfFileKey(row.file)),
        duplicate: (counts.get(dcfFileKey(row.file)) ?? 0) > 1
    }]));
}
