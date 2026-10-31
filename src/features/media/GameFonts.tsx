import {createContext, useContext, useEffect, useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {fontNames} from './font-names';

export const GameFonts = createContext<Record<string, string>>({});
const cache = new Map<string, Promise<{ names: Record<string, string>; failed: string[] }>>();
let nextFamily = 0;

export function useGameFontFamily() {
    const names = useContext(GameFonts);
    return (name: string) => {
        const family = names[name.toLowerCase()];
        return family ? `${JSON.stringify(family)}, ${JSON.stringify(name)}, sans-serif` : name ? `${JSON.stringify(name)}, sans-serif` : undefined;
    };
}

export function useGameFonts(entries: { name: string }[]) {
    const [names, setNames] = useState<Record<string, string>>({});
    const [status, setStatus] = useState({loading: true, completed: 0, total: 0, failed: [] as string[]});
    useEffect(() => {
        let disposed = false;
        setNames({});
        setStatus({loading: true, completed: 0, total: 0, failed: []});
        void invoke<{ scope: string; sources: string[] }>('list_ui_fonts').then(async list => {
            const key = JSON.stringify([list.scope, list.sources]);
            if (!cache.has(key)) cache.set(key, (async () => {
                const names: Record<string, string> = {}, failed: string[] = [];
                for (let i = 0; i < list.sources.length; i++) {
                    const source = list.sources[i];
                    try {
                        const bytes = await invoke<ArrayBuffer>('read_ui_font', {scope: list.scope, source});
                        const aliases = fontNames(bytes);
                        const family = `pck-game-font-${++nextFamily}`;
                        const font = await new FontFace(family, bytes).load();
                        document.fonts.add(font);
                        aliases.forEach(alias => {
                            names[alias.toLowerCase()] = family;
                        });
                    } catch {
                        failed.push(source);
                    }
                    if (!disposed) setStatus({
                        loading: true,
                        completed: i + 1,
                        total: list.sources.length,
                        failed: [...failed]
                    });
                }
                return {names, failed};
            })());
            const result = await cache.get(key)!;
            if (!disposed) {
                setNames(result.names);
                setStatus({
                    loading: false,
                    completed: list.sources.length,
                    total: list.sources.length,
                    failed: result.failed
                });
            }
        }).catch(e => {
            if (!disposed) setStatus({loading: false, completed: 0, total: 0, failed: [String(e)]});
        });
        return () => {
            disposed = true;
        };
    }, [entries]);
    return {names, status};
}
