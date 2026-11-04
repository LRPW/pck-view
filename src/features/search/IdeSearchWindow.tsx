import {useColumnWidth} from '../editor/useColumnWidth';
import {type CSSProperties, type FormEvent, useEffect, useRef, useState} from 'react';
import {ColumnDivider, resizeWidth} from '../editor/ColumnDivider';
import {Button, Input, Progress} from '@chakra-ui/react';
import {invoke} from '@tauri-apps/api/core';
import {emitTo, listen} from '@tauri-apps/api/event';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {open} from '@tauri-apps/plugin-dialog';
import './ide-search.css';

type Source = { id: number; path: string; project: boolean; modules: string[] };
export type IdeHit = {
    source: string | null; path: string; hit: {
        index: number; line: number; column: number; start: number; end: number;
        before: string; matched: string; after: string; encoding: string;
    }
};
type Outcome = { matches: IdeHit[]; cancelled: boolean; truncated: boolean; unreadable: number };
type Options = {
    query: string; mask: string; regexp: boolean; caseSensitive: boolean; wholeWord: boolean;
    mode: 'project' | 'module' | 'directory'; source: string; module: string; directory: string; disk: boolean;
};
const defaults: Options = {
    query: '', mask: '', regexp: false, caseSensitive: false, wholeWord: false,
    mode: 'project', source: '', module: '', directory: '', disk: true,
};
const storageKey = 'pwforge:find-in-files';

function restore(): { options?: Options; result?: Outcome } {
    try {
        return JSON.parse(localStorage.getItem(storageKey) ?? '{}') ?? {};
    } catch {
        return {};
    }
}

const basename = (path: string) => path.split(/[\\/]/).at(-1) || path;

function historyDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('pwforge-search', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('results');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function readHistory(): Promise<Outcome | undefined> {
    const db = await historyDatabase();
    try {
        return await new Promise((resolve, reject) => {
            const request = db.transaction('results').objectStore('results').get('last');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } finally {
        db.close();
    }
}

async function writeHistory(result: Outcome): Promise<void> {
    const db = await historyDatabase();
    try {
        await new Promise<void>((resolve, reject) => {
            const transaction = db.transaction('results', 'readwrite');
            transaction.oncomplete = () => resolve();
            transaction.onabort = () => reject(transaction.error);
            transaction.objectStore('results').put(result, 'last');
        });
    } finally {
        db.close();
    }
}

export function IdeSearchWindow() {
    const [restored] = useState(restore);
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
    const [shown, setShown] = useState(250);
    const [fileWidth, setFileWidth] = useColumnWidth('search.file', 300);
    const eligible = options.mode === 'project' ? sources.filter(source => source.project) : sources;
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
            listen<{
                operation: string;
                stage: string;
                completed: number;
                total: number
            }>('pck-progress', ({payload}) => {
                if (active.current !== undefined && payload.operation === 'Поиск по содержимому') setProgress(payload);
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

    async function search(event: FormEvent) {
        event.preventDefault();
        if (active.current !== undefined) return;
        const id = Date.now();
        started.current = true;
        active.current = id;
        setRunning(true);
        setError('');
        setLive([]);
        setShown(250);
        setProgress(undefined);
        try {
            const outcome = await invoke<Outcome>('ide_search', {
                request: {
                    searchId: id,
                    scopeId: source?.id,
                    module: options.mode === 'module' ? module : '',
                    directory: options.mode === 'directory' ? options.directory : '',
                    disk: options.mode === 'directory' && options.disk,
                    query: options.query, mask: options.mask, regexp: options.regexp,
                    caseSensitive: options.caseSensitive, wholeWord: options.wholeWord,
                }
            });
            setResult(outcome);
            try {
                await writeHistory(outcome);
            } catch (reason) {
                setError('Не удалось сохранить результаты: ' + String(reason));
            }
        } catch (reason) {
            setError(String(reason));
        } finally {
            active.current = undefined;
            setRunning(false);
            setStopping(false);
        }
    }

    async function cancel() {
        if (active.current === undefined) return;
        setStopping(true);
        try {
            await invoke('cancel_search', {searchId: active.current});
        } catch (reason) {
            setError(String(reason));
            setStopping(false);
        }
    }

    async function chooseDirectory() {
        const directory = await open({directory: true, multiple: false});
        if (typeof directory === 'string') setOptions(previous => ({...previous, directory, disk: true}));
    }

    return <section className="forge-ide ide-find" onKeyDown={event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            if (running) void cancel();
            else void getCurrentWindow().hide();
        }
    }}>
        <form onSubmit={search}>
            <div className="ide-find-row ide-find-heading">
                <strong>Поиск в файлах</strong>
                <label>Маска <Input size="sm" value={options.mask} placeholder="*.xml, *.lua"
                                    onChange={e => change('mask', e.target.value)}/></label>
            </div>
            <div className="ide-find-row">
                <Input ref={input} size="sm" aria-label="Текст поиска" value={options.query}
                       onChange={e => change('query', e.target.value)}/>
                {([['caseSensitive', 'Cc', 'Учитывать регистр'], ['wholeWord', 'W', 'Целое слово'], ['regexp', '.*', 'Регулярное выражение']] as const).map(([key, label, title]) =>
                    <Button key={key} size="sm" type="button" title={title} aria-label={title}
                            aria-pressed={options[key]}
                            variant={options[key] ? 'solid' : 'outline'}
                            onClick={() => change(key, !options[key])}>{label}</Button>)}
            </div>
            <div className="ide-find-row ide-find-scope">
                {([['project', 'Проект'], ['module', 'Модуль'], ['directory', 'Папка']] as const).map(([mode, label]) =>
                    <Button key={mode} size="sm" type="button" aria-pressed={options.mode === mode}
                            variant={options.mode === mode ? 'solid' : 'ghost'}
                            onClick={() => change('mode', mode)}>{label}</Button>)}
                {!(options.mode === 'directory' && options.disk) &&
                    <select aria-label="Источник" value={source?.path ?? ''}
                            onChange={e => change('source', e.target.value)}>
                        {!source && <option value="">Нет открытых источников</option>}
                        {eligible.map(item => <option key={item.id} value={item.path}
                                                      title={item.path}>{basename(item.path)}</option>)}
                    </select>}
                {options.mode === 'module' &&
                    <select aria-label="Модуль" value={module} onChange={e => change('module', e.target.value)}>
                        {source?.modules.map(name => <option key={name}
                                                             value={name}>{name ? basename(name) : basename(source.path)}</option>)}
                    </select>}
                {options.mode === 'directory' && <>
                    <select aria-label="Тип папки" value={options.disk ? 'disk' : 'source'}
                            onChange={e => change('disk', e.target.value === 'disk')}>
                        <option value="disk">На диске</option>
                        <option value="source">В источнике</option>
                    </select>
                    <Input size="sm" aria-label="Папка" value={options.directory}
                           placeholder={options.disk ? 'Путь к папке' : 'Путь в источнике'}
                           onChange={e => change('directory', e.target.value)}/>
                    {options.disk && <Button size="sm" type="button" aria-label="Выбрать папку"
                                             onClick={() => void chooseDirectory()}>…</Button>}
                </>}
            </div>
            <div className="ide-find-row">
                <Button size="sm" type="submit"
                        disabled={running || !options.query || (!(options.mode === 'directory' && options.disk) && !source)}>Найти</Button>
                <Button size="sm" type="button" disabled={!running || stopping}
                        onClick={() => void cancel()}>{stopping ? 'Отмена…' : 'Отменить'}</Button>
                <span
                    role="status">{running ? progress?.stage || 'Подготовка…' : result ? `${matches.length} совпадений${result.cancelled ? ' · отменено' : ''}${result.truncated ? ' · лимит 5000' : ''}${result.unreadable ? ' · ошибок: ' + result.unreadable : ''}` : ''}</span>
            </div>
        </form>
        {running &&
            <Progress.Root size="xs" value={progress?.total ? progress.completed : null} max={progress?.total || 100}
                           aria-label="Прогресс поиска">
                <Progress.Track><Progress.Range/></Progress.Track>
            </Progress.Root>}
        {error && <div className="ide-error" role="alert">{error}</div>}
        <div className="ide-find-results" style={{'--find-file-width': `${fileWidth}px`} as CSSProperties}>
            <div className="ide-find-columns">
                <span>Файл</span>
                <ColumnDivider label="Ширина колонки файла"
                               onDelta={delta => setFileWidth(width => resizeWidth(width, delta, 100, 700))}/>
                <span>Совпадение</span>
            </div>
            {matches.slice(0, shown).map((item, i) => <button key={i} type="button"
                                                              onClick={() => void emitTo('main', 'ide-search-open', item)}>
                <span title={item.path}>{item.path}:{item.hit.line}</span>
                <code>{item.hit.before}
                    <mark>{item.hit.matched}</mark>
                    {item.hit.after}</code>
            </button>)}
            {shown < matches.length &&
                <Button size="sm" onClick={() => setShown(value => value + 250)}>Показать ещё</Button>}
        </div>
    </section>;
}
