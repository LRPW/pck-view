import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {useEffect, useRef, useState} from 'react';
import {readHistory, writeHistory} from './search-history';
import type {IdeHit, SearchOptions as Options, SearchOutcome as Outcome, SearchSource as Source} from './search-types';
import {defaultSearchOptions as defaults, searchStorageKey as storageKey} from './search-types';

function restore(): { options?: Options; result?: Outcome } {
    try {
        return JSON.parse(localStorage.getItem(storageKey) ?? '{}') ?? {};
    } catch {
        return {};
    }
}

export function useFileSearch() {
    const [restored] = useState(restore);
    const [selected, setSelected] = useState(0);
    const [options, setOptions] = useState({...defaults, ...restored.options});
    const [sources, setSources] = useState<Source[]>([]);
    const [result, setResult] = useState<Outcome | undefined>(restored.result);
    const [live, setLive] = useState<IdeHit[]>([]);
    const [error, setError] = useState('');
    const [running, setRunning] = useState(false);
    const [stopping, setStopping] = useState(false);
    const [progress, setProgress] = useState<{ completed: number; total: number; stage: string }>();
    const active = useRef<number | undefined>(undefined);
    const started = useRef(false);
    const input = useRef<HTMLInputElement>(null);
    const matches = running ? live : result?.matches ?? [];

    const projects = sources.filter(source => source.project);
    const eligible = options.mode === 'project' && projects.length ? projects : sources;
    const source = eligible.find(source => source.path === options.source) ?? eligible[0];
    const module = source?.modules.includes(options.module) ? options.module : source?.modules[0] ?? '';

    function change<K extends keyof Options>(key: K, value: Options[K]) {
        setOptions(previous => ({...previous, [key]: value}));
    }

    useEffect(() => {
        const window = getCurrentWindow();
        const refresh = () => void invoke<Source[]>('ide_search_sources').then(setSources).catch(reason => setError(String(reason)));
        refresh();
        void readHistory().then(saved => {
            if (saved && !started.current) setResult(saved);
        }).catch(reason => setError(String(reason)));
        input.current?.focus();
        const listeners = [
            window.onFocusChanged(({payload}) => {
                if (payload) refresh();
            }),
            window.onCloseRequested(event => {
                event.preventDefault();
                void window.hide();
            }),
            listen<[number, IdeHit[]]>('ide-search-batch', ({payload: [id, rows]}) => {
                if (active.current === id) setLive(previous => [...previous, ...rows]);
            }),
            listen<[number, number, number, string]>('ide-search-progress', ({payload: [id, completed, total, stage]}) => {
                if (active.current === id) setProgress({completed, total, stage});
            }),
        ];
        return () => {
            for (const listener of listeners) void listener.then(unlisten => unlisten());
        };
    }, []);

    useEffect(() => {
        try {
            localStorage.setItem(storageKey, JSON.stringify({options}));
        } catch { /* The search and its result storage remain available. */
        }
    }, [options]);

    async function search() {
        if (active.current !== undefined) return;
        const id = Date.now();
        started.current = true;
        active.current = id;
        setRunning(true);
        setError('');
        setLive([]);
        setSelected(0);
        setProgress(undefined);
        try {
            const outcome = await invoke<Outcome>('ide_search', {
                request: {
                    searchId: id,
                    scopeId: source?.id,
                    module: options.mode === 'module' ? module : '',
                    directory: options.mode === 'directory' ? options.directory : '',
                    query: options.query, mask: options.mask, regexp: options.regexp,
                    caseSensitive: options.caseSensitive, wholeWord: options.wholeWord,
                }
            });
            if (active.current !== id) return;
            setResult(outcome);
            try {
                await writeHistory(outcome);
            } catch (reason) {
                setError("Failed to save results: " + String(reason));
            }
        } catch (reason) {
            if (active.current === id) setError(String(reason));
        } finally {
            if (active.current === id) {
                active.current = undefined;
                setRunning(false);
                setStopping(false);
            }
        }
    }

    async function cancel() {
        if (active.current === undefined) return;
        const id = active.current;
        active.current = undefined;
        setResult({matches: live, cancelled: true, truncated: false, unreadable: 0});
        setRunning(false);
        setStopping(false);
        setProgress(undefined);
        try {
            await invoke('cancel_search', {searchId: id});
        } catch (reason) {
            setError(String(reason));
            setStopping(false);
        }
    }


    return {
        options,
        sources,
        source,
        eligible,
        module,
        result,
        matches,
        error,
        running,
        stopping,
        progress,
        input,
        selected,
        setSelected,
        change,
        search,
        cancel,
        reportError: setError
    };
}
