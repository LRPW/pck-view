import {useSyncExternalStore} from 'react';

export const defaults = {
    build: 'Ctrl+B',
    buildFull: 'Ctrl+Shift+B',
    open: 'Ctrl+O',
    save: 'Ctrl+S',
    search: 'Ctrl+Shift+F',
    close: 'Ctrl+W',
    find: 'Ctrl+F',
    replace: 'Ctrl+H',
    next: 'F3',
    previous: 'Shift+F3',
    replaceNext: 'Ctrl+Shift+H',
    replaceAll: 'Ctrl+Alt+Enter',
    gotoLine: 'Ctrl+G',
    selectMatches: 'Ctrl+Shift+L',
    selectNext: 'Ctrl+D',
    undo: 'Ctrl+Z',
    redo: 'Ctrl+Y',
    fold: 'Ctrl+Shift+BracketLeft',
    unfold: 'Ctrl+Shift+BracketRight',
    openResult: 'Ctrl+Enter',
    duplicate: 'Ctrl+Alt+D',
    saveAs: 'Ctrl+Shift+S'
};
export type ShortcutAction = keyof typeof defaults;
const key = 'pw-forge-shortcuts';
let snapshot = localStorage.getItem(key) ?? '';
const listeners = new Set<() => void>();

function notify() {
    snapshot = localStorage.getItem(key) ?? '';
    listeners.forEach(fn => fn());
}

window.addEventListener('storage', event => {
    if (event.key === key) notify();
});

export function getShortcuts(): typeof defaults {
    try {
        return {...defaults, ...JSON.parse(localStorage.getItem(key) ?? '{}')};
    } catch {
        return {...defaults};
    }
}

export function useShortcuts() {
    useSyncExternalStore(fn => {
        listeners.add(fn);
        return () => {
            listeners.delete(fn);
        };
    }, () => snapshot);
    return getShortcuts();
}

export function setShortcuts(value: typeof defaults) {
    localStorage.setItem(key, JSON.stringify(value));
    notify();
}

export function shortcutFromEvent(event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>) {
    if (/^(Control|Meta|Alt|Shift)/.test(event.code)) return '';
    const code = event.code.replace(/^Key/, '').replace(/^Digit/, '');
    return [event.ctrlKey || event.metaKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', code].filter(Boolean).join('+');
}

export function matchesShortcut(event: KeyboardEvent, action: ShortcutAction) {
    return shortcutFromEvent(event) === getShortcuts()[action];
}
