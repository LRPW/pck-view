const attr = (e: Element, name: string) => Array.from(e.attributes).find(a => a.name.toLowerCase() === name.toLowerCase())?.value ?? '';
export type LayoutBox = {
    element: Element;
    x: number;
    y: number;
    width: number;
    height: number;
    children: LayoutBox[]
};
const read = (e: Element, key: string, fallback = 0) => {
    const raw = attr(e, key);
    return raw && Number.isFinite(Number(raw)) ? Math.trunc(Number(raw)) : fallback;
};
const offset = (space: number, align: number) => align === 1 ? Math.trunc(space / 2) : align === 2 ? space : 0;

export function measureFlex(element: Element): LayoutBox {
    const box: LayoutBox = {
        element,
        x: read(element, 'x'),
        y: read(element, 'y'),
        width: read(element, 'Width', 40),
        height: read(element, 'Height', 40),
        children: []
    };
    if (element.tagName.toUpperCase() !== 'DIV') return box;
    const row = attr(element, 'Direction').toLowerCase() !== 'column';
    const padding = Math.max(0, read(element, 'Padding')), gap = Math.max(0, read(element, 'Gap'));
    box.children = Array.from(element.children).filter(e => e.tagName.toUpperCase() === 'DIV' || attr(e, 'Name')).map(measureFlex);
    const main = box.children.reduce((sum, item) => sum + (row ? item.width : item.height), 0) + Math.max(0, box.children.length - 1) * gap;
    const cross = Math.max(0, ...box.children.map(item => row ? item.height : item.width));
    const automatic = attr(element, 'AutoSize').toLowerCase() !== 'false';
    box.width = automatic || !attr(element, 'Width') ? (row ? main : cross) + padding * 2 : Math.max(0, read(element, 'Width'));
    box.height = automatic || !attr(element, 'Height') ? (row ? cross : main) + padding * 2 : Math.max(0, read(element, 'Height'));
    let cursor = padding + offset((row ? box.width : box.height) - padding * 2 - main, read(element, row ? 'HorizontalAlign' : 'VerticalAlign'));
    for (const child of box.children) {
        const across = padding + offset((row ? box.height - child.height : box.width - child.width) - padding * 2, read(element, row ? 'VerticalAlign' : 'HorizontalAlign'));
        child.x = row ? cursor : across;
        child.y = row ? across : cursor;
        cursor += (row ? child.width : child.height) + gap;
    }
    return box;
}

export function flexLayout(root: Element): Map<Element, LayoutBox> {
    const result = new Map<Element, LayoutBox>();
    const visit = (box: LayoutBox, x: number, y: number) => {
        box.x += x;
        box.y += y;
        result.set(box.element, box);
        box.children.forEach(child => visit(child, box.x, box.y));
    };
    Array.from(root.children).filter(e => e.tagName.toUpperCase() === 'DIV' || attr(e, 'Name')).forEach(e => visit(measureFlex(e), 0, 0));
    return result;
}
