import {useSyncExternalStore} from 'react';
import english from './locales/en.json';
import russian from './locales/ru.json';

export type Language = 'en' | 'ru';
const storageKey = 'lrpw.language';
const listeners = new Set<() => void>();
const dictionaries: Record<Language, Record<string, string
>>= {en: english, ru: russian};

export function getLanguage(): Language {
    return localStorage.getItem(storageKey) === 'ru' ? 'ru' : 'en';
}

function notify() {
    document.documentElement.lang = getLanguage();
    listeners.forEach(listener => listener());
}

window.addEventListener('storage', event => {
    if (event.key === storageKey || event.key === null) notify();
});
document.documentElement.lang = getLanguage();

export function setLanguage(language: Language) {
    localStorage.setItem(storageKey, language);
    notify();
}

export function useLanguage() {
    return useSyncExternalStore(listener => {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    }, getLanguage);
}

/** English text is the stable key. Missing translations fall back to English. */
export function t(text: string | null | undefined, values?: Record<string, string | number>): string {
    if (text == null) return '';
    const key = sourceText(text.trim());
    let result = dictionaries[getLanguage()][key] ?? english[key as keyof typeof english] ?? key;
    if (values) result = result.replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match));
    return (text.match(/^\s+/)?.[0] ?? '') + result + (text.match(/\s+$/)?.[0] ?? '');
}

const sourceAliases = new Map(Object.entries(russian).map(([key, value]) => [value, key]));

/** Normalize labels emitted by older server commands without touching game data. */
export function sourceText(text: string): string {
    return sourceAliases.get(text) ?? text;
}

function escapePattern(text: string) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const templates = Object.keys(english).filter(key => /\{\w+\}/.test(key)).flatMap(key => {
    return [key, russian[key as keyof typeof russian]].filter(Boolean).map(pattern => {
        const names: string[] = [];
        let position = 0;
        let expression = '^';
        for (const match of pattern.matchAll(/\{(\w+)\}/g)) {
            expression += escapePattern(pattern.slice(position, match.index)) + '(.*?)';
            names.push(match[1]);
            position = match.index! + match[0].length;
        }
        expression += escapePattern(pattern.slice(position)) + '$';
        return {key, names, pattern: new RegExp(expression)};
    });
});

/** Translate command output and stored status messages when the language changes. */
export function message(text: string): string {
    if (text.startsWith('Error: ')) return t('Error') + ': ' + message(text.slice(7));
    const source = sourceText(text.trim());
    if (Object.hasOwn(english, source)) return t(source);
    for (const template of templates) {
        const match = template.pattern.exec(source);
        if (match) {
            const values = Object.fromEntries(template.names.map((name, index) => [name, match[index + 1]]));
            return t(template.key, values);
        }
    }
    return text;
}