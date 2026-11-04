import {type SetStateAction, useSyncExternalStore} from 'react';

const widths = new Map<string, number>();
const changeEvent = 'pwforge:column-width';

function subscribe(onChange: () => void) {
    window.addEventListener(changeEvent, onChange);
    window.addEventListener('storage', onChange);
    return () => {
        window.removeEventListener(changeEvent, onChange);
        window.removeEventListener('storage', onChange);
    };
}

export function useColumnWidth(column: string, defaultWidth: number) {
    const key = `pwforge:width:${column}`;

    function read() {
        const temporary = widths.get(key);
        if (temporary !== undefined) return temporary;
        try {
            const value = Number(localStorage.getItem(key));
            if (Number.isFinite(value) && value > 0) return value;
        } catch { /* Use the in-memory width if storage is unavailable. */
        }
        return defaultWidth;
    }

    const width = useSyncExternalStore(subscribe, read);

    function setWidth(update: SetStateAction<number>) {
        const current = read();
        const next = typeof update === 'function' ? update(current) : update;
        if (next === current) return;
        try {
            localStorage.setItem(key, String(next));
            widths.delete(key);
        } catch {
            widths.set(key, next);
        }
        window.dispatchEvent(new Event(changeEvent));
    }

    return [width, setWidth] as const;
}
