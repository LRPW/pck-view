import type {CSSProperties} from 'react';
import {attr} from './InterfaceTextures';

// FreeType's glyph texture is tinted by the control's vertex color.
export function uiTextStyle(text: Element | undefined): CSSProperties {
    if (!text) return {};
    const rgba = (raw: string, fallback: number[]) => /^(\d+,){3}\d+$/.test(raw) ? raw.split(',').map(Number) : fallback;
    const tint = rgba(attr(text, 'Color'), [255, 255, 255, 255]);
    const paint = (rgb: number[]) => `rgba(${rgb.slice(0, 3).map((v, i) => Math.round(v * tint[i] / 255)).join(',')},${tint[3] / 255})`;
    const outline = Math.max(0, Number(attr(text, 'Outline')) || 0);
    const edge = paint(rgba(attr(text, 'OutlineColor'), [0, 0, 0, 255]));
    return {
        fontSize: Math.max(1, Number(attr(text, 'FontSize')) || 12),
        fontWeight: /^(true|1)$/i.test(attr(text, 'Bold')) ? 'bold' : 'normal',
        fontStyle: /^(true|1)$/i.test(attr(text, 'Italic')) ? 'italic' : 'normal',
        color: paint(outline ? rgba(attr(text, 'InnerTextColor'), [255, 255, 255, 255]) : [255, 255, 255, 255]),
        WebkitTextStroke: outline ? `${outline * 2}px ${edge}` : undefined,
        paintOrder: 'stroke fill',
        fontKerning: 'none',
        fontVariantLigatures: 'none'
    };
}
