export type SearchSource = { id: number; path: string; project: boolean; modules: string[] };
export type IdeHit = {
    source: string | null;
    path: string;
    structured?: boolean;
    hit: {
        index: number; line: number; column: number; start: number; end: number;
        before: string; matched: string; after: string; encoding: string;
    };
};
export type SearchOutcome = { matches: IdeHit[]; cancelled: boolean; truncated: boolean; unreadable: number };
export type SearchOptions = {
    query: string; mask: string; regexp: boolean; caseSensitive: boolean; wholeWord: boolean;
    mode: 'project' | 'module' | 'directory'; source: string; module: string; directory: string;
};
export const defaultSearchOptions: SearchOptions = {
    query: '', mask: '', regexp: false, caseSensitive: false, wholeWord: false,
    mode: 'project', source: '', module: '', directory: '',
};
export const searchStorageKey = 'pwforge:find-in-files';
export const basename = (path: string) => path.split(/[\\/]/).at(-1) || path;
