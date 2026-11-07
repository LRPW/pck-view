export type LegacyToken = { start: number; end: number; value: string; quoted: boolean };

export function legacyTokens(text: string): LegacyToken[] {
    const tokens: LegacyToken[] = [];
    let i = 0;
    while (i < text.length) {
        if (/[\s\uFEFF]/.test(text[i])) {
            i++;
            continue;
        }
        if (text[i] === '#' || text.slice(i, i + 2) === '//') {
            while (i < text.length && !/[\r\n]/.test(text[i])) i++;
            continue;
        }
        const start = i;
        const quoted = text[i] === '"';
        if (quoted) {
            i++;
            while (i < text.length && text[i] !== '"') i++;
            if (i >= text.length) throw Error('Unclosed quoted string');
            i++;
        } else while (i < text.length && !/\s/.test(text[i])) i++;
        tokens.push({start, end: i, value: text.slice(start + (quoted ? 1 : 0), i - (quoted ? 1 : 0)), quoted});
    }
    return tokens;
}

export function replaceLegacyToken(text: string, token: LegacyToken, value: string) {
    if (value.includes('"')) throw Error('Quotes are not allowed in this format');
    const quoted = token.quoted || /\s/.test(value) || !value;
    return text.slice(0, token.start) + (quoted ? '"' + value + '"' : value) + text.slice(token.end);
}

export function legacyRows(text: string, format: string) {
    const tokens = legacyTokens(text);
    const rows: LegacyToken[][] = [];
    if (format !== 'dtf') {
        if (tokens.length % 2) throw Error('Incomplete string table entry');
        for (let i = 0; i < tokens.length; i += 2) rows.push(tokens.slice(i, i + 2));
    } else for (const token of tokens) {
        if (!rows.length || /[\r\n]/.test(text.slice(rows.at(-1)!.at(-1)!.end, token.start))) rows.push([token]); else rows.at(-1)!.push(token);
    }
    return rows;
}
