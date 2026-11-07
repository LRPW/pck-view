export const UI_FONTS = [
    {name: 'default', chinese: '方正隶二简体', file: 'fzl2jw.ttf'},
    {name: 'text', chinese: '方正细黑一简体', file: 'fzxh1jw.ttf'},
    {name: 'decorative', chinese: '方正隶变简体', file: 'fzlbjw.ttf'},
    {name: 'mono', chinese: '', file: 'mono.ttf'},
] as const;

export function canonicalFontName(name: string): string {
    const known = UI_FONTS.find(font => (font.chinese && font.chinese === name) || font.name === name.toLowerCase());
    return known?.name ?? (name.toLowerCase() === 'books' ? 'text' : name);
}

// Keep editor aliases in the UI; persist the original engine family names in XML.
export function xmlFontName(name: string): string {
    const alias = canonicalFontName(name);
    const known = UI_FONTS.find(font => font.name === alias);
    return known?.chinese || alias;
}

// Change only FontName attributes, preserving XML layout, comments and CDATA.
export function normalizeUiFontNames(xml: string): string {
    return xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[^>"']*(?:"[^"]*"|'[^']*'|[^>"']*)*>/g, tag => {
        if (tag.startsWith('<!--') || tag.startsWith('<![CDATA[')) return tag;
        return tag.replace(/(\s+)([\w:.-]+)(\s*=\s*)(["'])(.*?)\4/g, (attribute, space, key, equals, quote, value) =>
            key.toLowerCase() === 'fontname' ? `${space}${key}${equals}${quote}${xmlFontName(value)}${quote}` : attribute);
    });
}
