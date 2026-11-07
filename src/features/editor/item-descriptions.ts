import {invoke} from '@tauri-apps/api/core';
import {useEffect, useState} from 'react';

export function parseItemDescriptions(bytes: ArrayBuffer) {
    const text = new TextDecoder('utf-16le').decode(bytes);
    const marker = /#_begin\b/i.exec(text);
    const descriptions = new Map<number, string>();
    if (!marker || !/#_index\b/i.test(text.slice(0, marker.index))) return descriptions;
    const tokens = /\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|"([^"]*)"|\(([^)]*)\)|([^\s;,]+)/g;
    let id: number | undefined;
    for (const token of text.slice(marker.index + marker[0].length).matchAll(tokens)) {
        const value = token[1] ?? token[2] ?? token[3];
        if (value === undefined) continue;
        if (id === undefined) {
            if (/^\d+$/.test(value)) id = Number(value);
        } else {
            descriptions.set(id, value.replace(/\\r\\n|\\r|\\n/g, '\n'));
            id = undefined;
        }
    }
    return descriptions;
}

export function useItemDescriptions(scope?: number) {
    const [result, setResult] = useState<{ scope: number; descriptions: Map<number, string> }>();
    useEffect(() => {
        if (scope === undefined) return;
        let active = true;
        void invoke<ArrayBuffer>('ide_item_descriptions', {id: scope}).then(bytes => {
            if (active) setResult({scope, descriptions: parseItemDescriptions(bytes)});
        }).catch(() => {
        });
        return () => {
            active = false;
        };
    }, [scope]);
    return result?.scope === scope ? result?.descriptions : undefined;
}
