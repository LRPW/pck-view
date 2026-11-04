import {LocaleEditor} from '../features/editor/LocaleEditor';
import {EditorSwitch} from '../features/editor/EditorSwitch';
import {notifications} from './notifications';
import {TaskNpcEditor} from '../features/editor/TaskNpcEditor';
import {TasksEditor} from '../features/editor/TasksEditor';
import {DomainEditor} from '../features/editor/DomainEditor';
import {ResourcePicker} from '../features/editor/ResourcePicker';
import {useColumnWidth} from '../features/editor/useColumnWidth';
import {ColumnDivider, resizeWidth} from '../features/editor/ColumnDivider';
import {Progress} from '@chakra-ui/react';
import type {IdeHit} from '../features/search/IdeSearchWindow';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {confirm, open, save} from '@tauri-apps/plugin-dialog';
import {listen} from '@tauri-apps/api/event';
import {ArchiveTree} from '../features/archive/ArchiveTree';
import {ElementsEditor} from '../features/editor/ElementsEditor';
import {TextEditor, type TextEditorHandle} from '../features/editor/TextEditor';
import {useUnsavedGuard} from '../features/editor/unsaved';
import {ResourceContext, resourceInvoke, type ResourceScope} from '../features/editor/resource-context';
import {InterfaceEditor} from '../features/media/InterfaceEditor';
import {NativeGfxPreview} from '../features/media/NativeGfxPreview';
import {MediaPreview, mediaType} from '../features/media/MediaPreview';
import {isImageResource} from '../features/editor/ResourceFieldPreview';

import '../styles/ide.css';

type Tab = {
    key: string;
    scope: number;
    index?: number;
    resource?: string;
    kind: 'file' | 'elements' | 'gshop' | 'domain' | 'tasks' | 'task-npc' | 'locale' | 'source' | 'new';
    title: string;
    dirty: boolean;
    jump?: IdeHit['hit'];
    itemJump?: { id: number; npc?: boolean }
};
type SavedTab = { source: string; entry?: string; resource?: string; locale?: boolean };
type ResourcePick = {
    tab: string;
    scope: ResourceScope;
    field: string;
    imageOnly: boolean;
    choose: (path: string) => void
};
const sessionKey = 'pwforge:ide:tabs';

function readSession(): { tabs: SavedTab[]; active: number } | undefined {
    try {
        const data = JSON.parse(localStorage.getItem(sessionKey) ?? 'null');
        if (Array.isArray(data?.tabs)) return data;
    } catch { /* A damaged session can be reopened manually. */
    }
}

const normalize = (s: string) => s.replace(/\\/g, '/').replace(/^\/\/\?\//, '').toLowerCase();
const base = (s: string) => s.replace(/\\/g, '/').split('/').pop() ?? s;

function decode(bytes: number[]) {
    const b = new Uint8Array(bytes);
    let encoding = 'utf-8';
    if (bytes[0] === 255 && bytes[1] === 254) encoding = 'utf-16le'; else if (bytes[0] === 254 && bytes[1] === 255) encoding = 'utf-16be'; else {
        try {
            new TextDecoder('utf-8', {fatal: true}).decode(b);
        } catch {
            encoding = 'gbk';
        }
    }
    return {encoding, text: new TextDecoder(encoding, {ignoreBOM: true}).decode(b)};
}

export function IdeApp() {
    const [sidebarWidth, setSidebarWidth] = useColumnWidth('ide.tree', 320);
    const [resourcePick, setResourcePick] = useState<ResourcePick>();
    const [restored, setRestored] = useState(false);
    const [scopes, setScopes] = useState<ResourceScope[]>([]), [tabs, setTabs] = useState<Tab[]>([]), [active, setActive] = useState('');
    const picker = resourcePick?.tab === active ? resourcePick : undefined;
    const cancelResourcePick = useCallback((tab: string) => setResourcePick(current => current?.tab === tab ? undefined : current), []);
    useEffect(() => {
        if (resourcePick && resourcePick.tab !== active) setResourcePick(undefined);
    }, [active, resourcePick]);
    const [query, setQuery] = useState(''), [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState('');
    const [opening, setOpening] = useState<string>();
    const [openProgress, setOpenProgress] = useState<{ stage: string; completed: number; total: number }>();
    const [textExport, setTextExport] = useState<{
        operation: string;
        stage: string;
        completed: number;
        total: number
    }>();
    const [exportRevision, setExportRevision] = useState(0);
    const [fileRevisions, setFileRevisions] = useState<Record<string, number>>({});
    const scopesRef = useRef(scopes);
    scopesRef.current = scopes;
    const tabsRef = useRef(tabs);
    tabsRef.current = tabs;
    const [savedArchives, setSavedArchives] = useState<Record<number, boolean>>({});
    const activeTab = tabs.find(t => t.key === active);
    const activeScope = scopes.find(s => s.id === activeTab?.scope);
    useUnsavedGuard('IDE', tabs.some(t => t.dirty) || busy || Object.values(savedArchives).some(Boolean));
    const setDirty = useCallback((key: string, dirty: boolean) => setTabs(old => old.some(t => t.key === key && t.dirty !== dirty) ? old.map(t => t.key === key ? {
        ...t,
        dirty
    } : t) : old), []);

    function addTab(tab: Tab) {
        setTabs(old => old.some(t => t.key === tab.key) ? old : [...old, tab]);
        setActive(tab.key);
    }

    function openLocale(scope: ResourceScope) {
        const key = `locale:${scope.id}`;
        addTab({key, scope: scope.id, kind: 'locale', title: `Переводчик · ${base(scope.path)}`, dirty: false});
        return key;
    }

    function openEntry(scope: ResourceScope, index: number) {
        const e = scope.entries[index];
        if (!e) return;
        const key = `${scope.id}:${index}`;
        addTab({
            key,
            scope: scope.id,
            index,
            kind: /^elements.*\.data$/i.test(base(e.name)) ? 'elements' : /^gshop[12]?(?:\.edited)*\.data$/i.test(base(e.name)) ? 'gshop' : /^domain(?:2(?:_cross)?)?\.data$/i.test(base(e.name)) ? 'domain' : /^task_npc\.data$/i.test(base(e.name)) ? 'task-npc' : /^(?:tasks|dyn_tasks)\.data$/i.test(base(e.name)) ? 'tasks' : 'file',
            title: base(e.name),
            dirty: false
        });
        return key;
    }

    function openResource(scope: ResourceScope, name: string, parent = '') {
        const path = normalize(name), current = normalize(parent);
        const candidates = [current.slice(0, current.lastIndexOf('/') + 1) + path, path, `interfaces/${path}`, `surfaces/${path}`, `gfx/${path}`];
        const index = scope.entries.findIndex(e => candidates.includes(normalize(e.name)));
        if (index >= 0) return openEntry(scope, index);
        const key = `${scope.id}:resource:${path}`;
        addTab({key, scope: scope.id, resource: name, kind: 'file', title: base(name), dirty: false});
        return key;
    }

    async function loadPath(path: string, showTab = true) {
        setBusy(true);
        setOpening(base(path));
        setOpenProgress(undefined);
        setError('');
        try {
            let scope = scopesRef.current.find(s => normalize(s.path) === normalize(path));
            if (!scope) {
                scope = await invoke<ResourceScope>('ide_open', {path});
                setScopes(old => [...old, scope!]);
                scopesRef.current = [...scopesRef.current, scope];
            }
            if (showTab) {
                if (scope.kind === 'file') openEntry(scope, 0); else addTab({
                    key: `source:${scope.id}`,
                    scope: scope.id,
                    kind: 'source',
                    title: base(scope.path),
                    dirty: false
                });
                localStorage.setItem('pwforge:ide:last', path);
            }
            return scope;
        } catch (e) {
            setError(String(e));
        } finally {
            setBusy(false);
            setOpening(undefined);
            setOpenProgress(undefined);
        }
    }

    async function openSearch() {
        try {
            await invoke('open_search_window');
        } catch (reason) {
            setError(String(reason));
        }
    }

    async function exportTexts(scope: ResourceScope) {
        if (busy || tabsRef.current.some(tab => tab.scope === scope.id && tab.dirty)) return;
        setBusy(true);
        setTextExport({operation: 'Экспорт текстов', stage: '', completed: 0, total: 0});
        try {
            const result = await invoke<{
                count: number;
                skipped: number;
                path: string
            }>('ide_export_texts', {id: scope.id});
            setExportRevision(value => value + 1);
            notifications.create({
                type: result.skipped ? 'warning' : 'success',
                title: `Текстов выгружено · ${result.count.toLocaleString()}`,
                description: result.skipped ? `${result.path} · Файлов с ошибками: ${result.skipped}` : result.path
            });
        } catch (reason) {
            notifications.create({
                type: 'error',
                title: 'Не удалось экспортировать тексты',
                description: String(reason)
            });
        } finally {
            setBusy(false);
            setTextExport(undefined);
        }
    }

    async function applyLocale(scope: ResourceScope, language: string): Promise<string[]> {
        if (busy || tabsRef.current.some(tab => tab.scope === scope.id && tab.dirty)) return ['Сначала сохраните открытые правки проекта.'];
        setBusy(true);
        setTextExport({operation: 'Применение перевода', stage: '', completed: 0, total: 0});
        try {
            const result = await invoke<{ updated: number[]; errors: string[] }>('ide_locale_apply', {
                id: scope.id,
                language
            });
            const updated = new Set(result.updated);
            setScopes(old => old.map(item => item.id === scope.id ? {
                ...item, entries: item.entries.map((entry, index) =>
                    updated.has(index) ? {...entry, changed: true} : entry)
            } : item));
            setFileRevisions(old => {
                const next = {...old};
                for (const index of updated) {
                    const key = `${scope.id}:${index}`;
                    next[key] = (next[key] ?? 0) + 1;
                }
                return next;
            });
            notifications.create({
                type: result.errors.length ? 'warning' : 'success',
                title: `Обновлено файлов · ${updated.size}`,
                description: result.errors.length ? `Пропущено · ${result.errors.length}` : undefined
            });
            return result.errors;
        } catch (reason) {
            notifications.create({type: 'error', title: 'Не удалось применить перевод', description: String(reason)});
            return [];
        } finally {
            setBusy(false);
            setTextExport(undefined);
        }
    }

    useEffect(() => {
        const listener = listen<IdeHit>('ide-search-open', ({payload}) => {
            void (async () => {
                const source = payload.source ?? payload.path;
                const scope = scopesRef.current.find(item => normalize(item.path) === normalize(source)) ?? await loadPath(source);
                if (!scope) return;
                const index = payload.source ? scope.entries.findIndex(entry => normalize(entry.path) === normalize(payload.path)) : 0;
                if (index < 0) {
                    setError('Файл из результатов поиска не найден');
                    return;
                }
                openEntry(scope, index);
                setTabs(previous => previous.map(tab => tab.key === scope.id + ':' + index ? {
                    ...tab,
                    jump: payload.hit
                } : tab));
            })();
        });
        return () => {
            void listener.then(unlisten => unlisten());
        };
    }, []);

    async function openFile() {
        const paths = await open({multiple: true});
        if (Array.isArray(paths)) {
            for (const p of paths) await loadPath(p);
        } else if (typeof paths === 'string') await loadPath(paths);
    }

    const startup = useRef(false);
    useEffect(() => {
        if (startup.current) return;
        startup.current = true;
        void (async () => {
            try {
                const project = await invoke<string | null>('project_startup');
                const target = await invoke<[string, string] | null>('startup_target');
                const session = readSession();
                let activeKey: string | undefined;
                if (session) {
                    const loaded = new Map<string, ResourceScope | undefined>();
                    for (const [position, tab] of session.tabs.entries()) {
                        if (typeof tab?.source !== 'string') continue;
                        if (!loaded.has(tab.source)) loaded.set(tab.source, await loadPath(tab.source, false));
                        const scope = loaded.get(tab.source);
                        if (!scope) continue;
                        let key: string | undefined;
                        if (tab.locale) {
                            key = openLocale(scope);
                        } else if (typeof tab.entry === 'string') {
                            const index = scope.entries.findIndex(entry => normalize(entry.path) === normalize(tab.entry!));
                            key = openEntry(scope, index);
                        } else if (typeof tab.resource === 'string') {
                            key = openResource(scope, tab.resource);
                        } else {
                            key = 'source:' + scope.id;
                            addTab({key, scope: scope.id, kind: 'source', title: base(scope.path), dirty: false});
                        }
                        if (position === session.active) activeKey = key;
                    }
                }
                const explicit = project ?? target?.[0];
                if (explicit) await loadPath(explicit);
                else if (!session) {
                    const path = localStorage.getItem('pwforge:ide:last') ?? localStorage.getItem('pwforge:last-project');
                    if (path) await loadPath(path);
                } else if (activeKey) setActive(activeKey);
            } catch (reason) {
                setError(String(reason));
            } finally {
                setRestored(true);
            }
        })();
    }, []);
    useEffect(() => {
        if (!restored) return;
        const saved: SavedTab[] = [];
        let selected = -1;
        for (const tab of tabs) {
            const scope = scopes.find(item => item.id === tab.scope);
            if (!scope) continue;
            if (tab.key === active) selected = saved.length;
            saved.push({
                source: scope.path,
                entry: tab.index === undefined ? undefined : scope.entries[tab.index]?.path,
                resource: tab.resource,
                locale: tab.kind === 'locale' || undefined
            });
        }
        try {
            localStorage.setItem(sessionKey, JSON.stringify({tabs: saved, active: selected}));
        } catch (reason) {
            setError(String(reason));
        }
    }, [active, restored, scopes, tabs]);
    useEffect(() => {
        const p = listen<{ operation: string; stage: string; completed: number; total: number }>('pck-progress', e => {
            if (e.payload.operation === 'Открытие') {
                setOpenProgress(e.payload);
                return;
            }
            if (e.payload.operation === 'Экспорт текстов' || e.payload.operation === 'Применение перевода') {
                setTextExport(current => current ? e.payload : current);
                return;
            }
            setStatus(`${e.payload.operation} · ${e.payload.stage}${e.payload.total ? ' · ' + e.payload.completed + ' / ' + e.payload.total : ''}`);
        });
        return () => {
            void p.then(f => f());
        };
    }, []);
    useEffect(() => {
        const f = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyF') {
                e.preventDefault();
                void openSearch();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.code === 'KeyO') {
                e.preventDefault();
                if (!busy) void openFile();
            }
            if ((e.ctrlKey || e.metaKey) && e.code === 'KeyW') {
                e.preventDefault();
                if (active) void closeTab(active);
            }
        };
        window.addEventListener('keydown', f);
        return () => window.removeEventListener('keydown', f);
    });

    async function closeTab(key: string) {
        const tab = tabsRef.current.find(t => t.key === key);
        if (!tab) return;
        if (tab.dirty && !(await confirm(`Закрыть «${tab.title}» без сохранения?`, {
            title: 'PW Forge',
            kind: 'warning'
        }))) return;
        setTabs(old => {
            const next = old.filter(t => t.key !== key);
            if (active === key) setActive(next[Math.max(0, old.findIndex(t => t.key === key) - 1)]?.key ?? '');
            return next;
        });
    }

    const treeEntries = useMemo(() => scopes.flatMap(scope => scope.entries.map((entry, index) => ({
        name: entry.name.replace(/\\/g, '/'),
        size: entry.size,
        changed: entry.changed,
        scope,
        index
    }))), [scopes]);
    const selected = activeTab?.index === undefined ? undefined : treeEntries.findIndex(e => e.scope.id === activeTab.scope && e.index === activeTab.index);
    const pickerEntries = useMemo(() => picker ? treeEntries.filter(entry =>
        (picker.scope.kind === 'project' ? entry.scope.id === picker.scope.id :
            entry.scope.kind !== 'file') &&
        (!picker.imageOnly || isImageResource(entry.name)) &&
        !(entry.scope.id === activeTab?.scope && entry.index === activeTab?.index)
    ) : treeEntries, [picker, treeEntries, activeTab?.scope, activeTab?.index]);
    const imageEntries = useMemo(() => {
        const index = new Map<string, typeof treeEntries>();
        for (const entry of treeEntries) {
            if (!isImageResource(entry.name)) continue;
            const name = normalize(entry.name);
            for (const key of new Set([name, base(name)])) {
                const matches = index.get(key);
                if (matches) matches.push(entry);
                else index.set(key, [entry]);
            }
        }
        return index;
    }, [treeEntries]);
    const readFieldImage = useCallback((scope: ResourceScope, path: string) => {
        const name = normalize(path).replace(/^\.\//, '');
        const candidates = (key: string) => (imageEntries.get(key) ?? []).filter(entry =>
            entry.scope.id === scope.id || (scope.kind !== 'project' && entry.scope.kind !== 'file'));
        const exact = candidates(name);
        const fallback = candidates(base(name));
        const entry = exact.find(item => item.scope.id === scope.id) ?? exact[0] ?? (fallback.length === 1 ? fallback[0] : undefined);
        return entry ? invoke<number[]>('ide_read', {id: entry.scope.id, index: entry.index}) :
            invoke<number[]>('ide_resource', {id: scope.id, name: path});
    }, [imageEntries]);

    function openFieldResource(scope: ResourceScope, path: string) {
        const name = normalize(path).replace(/^\.\//, '');
        const sources = treeEntries.filter(entry => entry.scope.id === scope.id ||
            (scope.kind !== 'project' && entry.scope.kind !== 'file'));
        const exact = sources.filter(entry => normalize(entry.name) === name);
        const matches = sources.filter(entry => base(normalize(entry.name)) === base(name));
        const entry = exact.find(item => item.scope.id === scope.id) ?? exact[0] ??
            (matches.length === 1 ? matches[0] : undefined);
        if (entry) openEntry(entry.scope, entry.index);
        else openResource(scope, path);
    }

    async function openElementsRecord(scope: ResourceScope, id: number, npc?: boolean) {
        let target = scope;
        let index = target.entries.findIndex(entry => normalize(entry.name) === 'data/elements.data');
        if (index < 0) index = target.entries.findIndex(entry => base(normalize(entry.name)) === 'elements.data');
        if (index < 0 && scope.kind === 'file') {
            const sibling = scope.path.replace(/[^/\\]+$/, 'elements.data');
            const loaded = await loadPath(sibling, false);
            if (!loaded) return;
            target = loaded;
            index = 0;
        }
        if (index < 0) {
            setError('В проекте нет elements.data');
            return;
        }
        const key = openEntry(target, index);
        setTabs(old => old.map(tab => tab.key === key ? {...tab, itemJump: {id, npc}} : tab));
    }

    async function saveArchive(scope: ResourceScope, as = false) {
        const path = as ? await save({
            defaultPath: scope.path,
            filters: [{name: 'PCK', extensions: ['pck']}]
        }) : scope.path;
        if (!path) return;
        setBusy(true);
        try {
            await invoke('ide_save_archive', {id: scope.id, path});
            setSavedArchives(old => ({...old, [scope.id]: false}));
            setStatus(path);
        } catch (e) {
            setError(String(e));
        } finally {
            setBusy(false);
        }
    }

    async function build(scope: ResourceScope) {
        if (tabsRef.current.some(t => t.scope === scope.id && t.dirty)) {
            setError('Сохраните изменения в редакторах.');
            return;
        }
        setBusy(true);
        try {
            const r = await invoke<{ directory: string }>('project_build', {manifest: scope.path});
            setStatus(r.directory);
        } catch (e) {
            setError(String(e));
        } finally {
            setBusy(false);
        }
    }

    function saved(scope: ResourceScope, index: number) {
        notifications.create({
            type: 'success',
            title: 'Сохранено',
            description: base(scope.entries[index]?.name ?? scope.path)
        });
        if (scope.kind === 'archive') setSavedArchives(v => ({...v, [scope.id]: true}));
        setScopes(old => old.map(s => s.id === scope.id ? {
            ...s,
            entries: s.entries.map((e, i) => i === index ? {...e, changed: true} : e)
        } : s));
    }

    return <div className="forge-ide">
        <header className="ide-header"><strong>PW Forge</strong>
            <button disabled={busy} onClick={() => addTab({
                key: 'new-project',
                scope: 0,
                kind: 'new',
                title: 'Новый проект',
                dirty: false
            })}>Новый проект
            </button>
            <button disabled={busy} onClick={() => void openFile()}>Открыть</button>
            <button title="Ctrl+Shift+F" onClick={() => void openSearch()}>Поиск в файлах</button>
            {activeScope && <button disabled={busy || tabs.some(tab => tab.scope === activeScope.id && tab.dirty)}
                                    onClick={() => void exportTexts(activeScope)}>Экспорт
                текстов</button>}{activeScope &&
                <button onClick={() => openLocale(activeScope)}>Переводчик</button>}{activeScope?.kind === 'project' &&
                <button disabled={busy} onClick={() => void build(activeScope)}>Собрать
                    изменения</button>}{activeScope?.kind === 'archive' && <>
                <button disabled={busy || tabs.some(t => t.scope === activeScope.id && t.dirty)}
                        onClick={() => void saveArchive(activeScope)}>Сохранить
                    PCK{savedArchives[activeScope.id] ? ' ●' : ''}</button>
                <button disabled={busy || tabs.some(t => t.scope === activeScope.id && t.dirty)}
                        onClick={() => void saveArchive(activeScope, true)}>Сохранить PCK как…
                </button>
            </>}</header>
        {error && <div className="ide-error" role="alert">{error}
            <button onClick={() => setError('')}>×</button>
        </div>}
        <main className="ide-main">
            <aside className="ide-sidebar" style={{width: sidebarWidth}}>
                <input aria-label="Поиск файлов" placeholder="Поиск…" value={query}
                       onChange={e => setQuery(e.target.value)}/>
                <ArchiveTree entries={treeEntries} query={query}
                             selected={selected !== undefined && selected >= 0 ? selected : undefined} busy={busy}
                             choose={i => {
                                 const entry = treeEntries[i];
                                 if (entry) openEntry(entry.scope, entry.index);
                             }}/></aside>
            {picker && <ResourcePicker field={picker.field} entries={pickerEntries} busy={busy}
                                       cancel={() => cancelResourcePick(picker.tab)} choose={i => {
                const entry = pickerEntries[i];
                if (!entry) return;
                picker.choose(entry.name.replaceAll('/', '\\'));
                cancelResourcePick(picker.tab);
            }}/>}
            <ColumnDivider label="Ширина дерева файлов"
                           onDelta={delta => setSidebarWidth(width => resizeWidth(width, delta, 220, Math.min(600, window.innerWidth - 420)))}/>
            <section className="ide-workbench">
                <div className="ide-tabs" role="tablist" aria-label="Открытые файлы">{tabs.map(t => <div key={t.key}
                                                                                                         className={`ide-tab${active === t.key ? ' active' : ''}`}
                                                                                                         onMouseDown={event => {
                                                                                                             if (event.button === 1) event.preventDefault();
                                                                                                         }}
                                                                                                         onAuxClick={event => {
                                                                                                             if (event.button !== 1) return;
                                                                                                             event.preventDefault();
                                                                                                             void closeTab(t.key);
                                                                                                         }}>
                    <button role="tab" aria-selected={active === t.key} onClick={() => setActive(t.key)}
                            title={t.title}>{t.title}{t.dirty ? ' ●' : ''}</button>
                    <button aria-label={`Закрыть ${t.title}`} onClick={() => void closeTab(t.key)}>×</button>
                </div>)}</div>
                <div className="ide-editors">{tabs.map(tab => {
                    const scope = scopes.find(s => s.id === tab.scope);
                    return <div className="ide-document" key={tab.key + "@" + (fileRevisions[tab.key] ?? 0)}
                                style={{display: tab.key === active ? 'flex' : 'none'}}>{tab.kind === 'new' ?
                        <NewProject onCreated={path => {
                            void loadPath(path);
                            setTabs(old => old.filter(t => t.key !== 'new-project'));
                        }}/> : scope && tab.kind === 'locale' ?
                            <LocaleEditor id={scope.id} active={tab.key === active} revision={exportRevision}
                                          exporting={!!textExport} onExport={() => void exportTexts(scope)}
                                          onApply={scope.kind === 'project' ? language => applyLocale(scope, language) : undefined}
                                          onDirty={dirty => setDirty(tab.key, dirty)}/> : scope && tab.kind === 'source' ?
                                <div className="ide-source">
                                    <div>{scope.path}</div>
                                    <input placeholder="Файл…" aria-label="Фильтр содержимого"
                                           onChange={e => setQuery(e.target.value)}/>
                                    <div className="ide-source-files">{scope.entries.slice(0, 300).map((e, i) => <button
                                        key={i} onClick={() => openEntry(scope, i)}>{e.name}</button>)}</div>
                                </div> : scope && tab.kind === 'task-npc' ?
                                    <TaskNpcEditor openNpc={npcId => void openElementsRecord(scope, npcId, true)}
                                                   id={scope.id} index={tab.index!} active={tab.key === active}
                                                   onDirty={dirty => setDirty(tab.key, dirty)}
                                                   onSaved={() => saved(scope, tab.index!)}/> : scope && tab.kind === 'tasks' ?
                                        <TasksEditor openItem={itemId => void openElementsRecord(scope, itemId)}
                                                     openNpc={npcId => void openElementsRecord(scope, npcId, true)}
                                                     id={scope.id} index={tab.index!} active={tab.key === active}
                                                     onDirty={dirty => setDirty(tab.key, dirty)}
                                                     onSaved={() => saved(scope, tab.index!)}/> : scope && tab.kind === 'domain' ?
                                            <DomainEditor id={scope.id} index={tab.index!}
                                                          nations={/^domain2/i.test(tab.title)}
                                                          active={tab.key === active}
                                                          onDirty={dirty => setDirty(tab.key, dirty)}
                                                          onSaved={() => saved(scope, tab.index!)}/> : scope && (tab.kind === 'elements' || tab.kind === 'gshop') ?
                                                <ElementsTab scope={scope} tab={tab} active={tab.key === active}
                                                             onDirty={setDirty} onSaved={() => saved(scope, tab.index!)}
                                                             onOpen={() => void openFile()}
                                                             readFieldImage={readFieldImage}
                                                             openFieldResource={openFieldResource}
                                                             openElementsRecord={openElementsRecord}
                                                             onResourcePick={setResourcePick}
                                                             onCancelResourcePick={cancelResourcePick}/> : scope ?
                                                    <ResourceDocument scope={scope} tab={tab}
                                                                      active={tab.key === active} onDirty={setDirty}
                                                                      onSaved={() => saved(scope, tab.index!)}
                                                                      onOpen={name => openResource(scope, name, scope.entries[tab.index ?? 0]?.name)}/> : null}</div>;
                })}</div>
            </section>
        </main>
        <footer className="ide-status" role="status">{opening ? <div className='ide-open-progress'>
            <span>Открытие {opening}{openProgress?.stage ? ' · ' + openProgress.stage : ''}</span><Progress.Root
            size="xs" colorPalette="teal" aria-label="Загрузка файла"
            value={openProgress?.total ? openProgress.completed : null}
            max={openProgress?.total || 100}><Progress.Track><Progress.Range/></Progress.Track></Progress.Root>
        </div> : textExport ? <div className='ide-open-progress'>
            <span>{textExport.operation}{textExport.stage ? ' · ' + textExport.stage : ''}</span><Progress.Root
            size='xs' colorPalette='teal' aria-label={textExport.operation}
            value={textExport.total ? textExport.completed : null}
            max={textExport.total || 100}><Progress.Track><Progress.Range/></Progress.Track></Progress.Root>
        </div> : busy ? 'Выполняется…' : status}</footer>
    </div>;
}

function ElementsTab({
                         scope,
                         tab,
                         active,
                         onDirty,
                         onSaved,
                         onOpen,
                         readFieldImage,
                         openFieldResource,
                         openElementsRecord,
                         onResourcePick,
                         onCancelResourcePick
                     }: {
    scope: ResourceScope;
    tab: Tab;
    active: boolean;
    onDirty: (key: string, dirty: boolean) => void;
    onSaved: () => void;
    onOpen: () => void;
    readFieldImage: (scope: ResourceScope, path: string) => Promise<number[]>;
    openFieldResource: (scope: ResourceScope, path: string) => void;
    openElementsRecord: (scope: ResourceScope, id: number, npc?: boolean) => Promise<void>;
    onResourcePick: (pick: ResourcePick) => void;
    onCancelResourcePick: (tab: string) => void
}) {
    const request = useMemo(() => ({id: scope.id, index: tab.index!}), [scope.id, tab.index]);
    const dirty = useCallback((value: boolean) => onDirty(tab.key, value), [onDirty, tab.key]);
    const readImage = useCallback((path: string) => readFieldImage(scope, path), [scope, readFieldImage]);
    const cancelPick = useCallback(() => onCancelResourcePick(tab.key), [onCancelResourcePick, tab.key]);
    return <ElementsEditor itemJump={tab.itemJump} openItem={(id, npc) => void openElementsRecord(scope, id, npc)}
                           openResource={path => openFieldResource(scope, path)} readImage={readImage}
                           cancelResourcePick={cancelPick} pickResource={(field, imageOnly, choose) => onResourcePick({
        tab: tab.key,
        scope,
        field,
        imageOnly,
        choose
    })} embedded shop={tab.kind === 'gshop'} visible={active} onOpen={onOpen} onBack={() => {
    }} requestedIde={request} onDirty={dirty} onSaved={onSaved}/>;
}

function ResourceDocument({scope, tab, active, onDirty, onSaved, onOpen}: {
    scope: ResourceScope;
    tab: Tab;
    active: boolean;
    onDirty: (key: string, dirty: boolean) => void;
    onSaved: () => void;
    onOpen: (name: string) => void
}) {
    const name = tab.resource ?? scope.entries[tab.index!]?.name ?? tab.title;
    const [bytes, setBytes] = useState<number[]>([]), [text, setText] = useState(''), [saved, setSaved] = useState(''), [encoding, setEncoding] = useState('utf-8'), [loading, setLoading] = useState(true), [error, setError] = useState('');
    const isNative = /\.(gfx|mox|ecm|smd|ski|bon)$/i.test(name), isXml = /\.xml$/i.test(name),
        isMedia = !!mediaType(name);
    const isText = /\.(txt|xml|ini|cfg|lua|json|csv|log|fx|vsh|psh|hlsl|html|css|js|md|properties)$/i.test(name);
    const [mode, setMode] = useState(isNative || isXml || isMedia ? 'preview' : isText ? 'text' : 'hex');
    const editor = useRef<TextEditorHandle>(null);
    const appliedJump = useRef<IdeHit['hit'] | undefined>(undefined);
    useEffect(() => {
        if (!tab.jump || !active || loading) return;
        if (text === saved && (encoding !== tab.jump.encoding || (!isText && !text))) {
            const value = new TextDecoder(tab.jump.encoding, {ignoreBOM: true}).decode(new Uint8Array(bytes));
            setEncoding(tab.jump.encoding);
            setText(value);
            setSaved(value);
        }
        setMode('text');
    }, [tab.jump, active, loading]);
    useEffect(() => {
        const jump = tab.jump;
        if (!jump || appliedJump.current === jump || !active || loading || mode !== 'text' || !editor.current) return;
        if (text === saved && (encoding !== jump.encoding || (!isText && !text && bytes.length > 0))) return;
        editor.current.reveal(jump.start, jump.end);
        appliedJump.current = jump;
    }, [tab.jump, active, loading, mode, text, saved, encoding, isText, bytes.length]);
    const dirty = text !== saved;
    const onOpenRef = useRef(onOpen);
    onOpenRef.current = onOpen;
    const boundInvoke = useMemo(() => resourceInvoke(scope, n => onOpenRef.current(n)), [scope.id]);
    const context = useMemo(() => ({invoke: boundInvoke, active}), [boundInvoke, active]);
    useEffect(() => {
        let alive = true;
        setLoading(true);
        const p = tab.resource ? invoke<number[]>('ide_resource', {
            id: scope.id,
            name: tab.resource
        }) : invoke<number[]>('ide_read', {id: scope.id, index: tab.index});
        void p.then(data => {
            if (!alive) return;
            const d = isText ? decode(data) : {encoding: "gbk", text: ""};
            setBytes(data);
            setEncoding(d.encoding);
            setSaved(d.text);
            setText(d.text);
            setLoading(false);
        }).catch(e => {
            if (alive) {
                setError(String(e));
                setLoading(false);
            }
        });
        return () => {
            alive = false;
        };
    }, [scope.id, tab.index, tab.resource]);
    useEffect(() => onDirty(tab.key, dirty), [dirty, onDirty, tab.key]);

    async function saveFile() {
        if (tab.index === undefined) return;
        setLoading(true);
        try {
            await invoke('ide_save', {id: scope.id, index: tab.index, text, encoding, original: bytes});
            const b = await invoke<number[]>('ide_read', {id: scope.id, index: tab.index});
            setBytes(b);
            setSaved(text);
            onSaved();
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (!active) return;
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
                e.preventDefault();
                if (dirty && !loading) void saveFile();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    });
    const hex = useMemo(() => Array.from({length: Math.ceil(Math.min(bytes.length, 65536) / 16)}, (_, i) => `${(i * 16).toString(16).padStart(8, '0')}  ${bytes.slice(i * 16, i * 16 + 16).map(b => b.toString(16).padStart(2, '0')).join(' ')}`).join('\n'), [bytes]);
    return <ResourceContext.Provider value={context}>
        <div className="ide-resource">
            <div className="ide-document-toolbar"><span title={name}>{name}</span>{(isNative || isXml || isMedia) &&
                <button onClick={() => setMode('preview')}>Предпросмотр</button>}
                <button onClick={() => {
                    if (!isText && !text) {
                        const d = decode(bytes);
                        setText(d.text);
                        setSaved(d.text);
                        setEncoding(d.encoding);
                    }
                    setMode('text');
                }}>Текст
                </button>
                <button onClick={() => setMode('hex')}>HEX</button>
                <select value={encoding} onChange={e => {
                    if (dirty) return;
                    setEncoding(e.target.value);
                    const s = new TextDecoder(e.target.value, {ignoreBOM: true}).decode(new Uint8Array(bytes));
                    setText(s);
                    setSaved(s);
                }}>
                    <option value="utf-8">UTF-8</option>
                    <option value="gbk">GBK</option>
                    <option value="utf-16le">UTF-16 LE</option>
                    <option value="utf-16be">UTF-16 BE</option>
                </select>
                <button disabled={loading || !dirty || tab.index === undefined}
                        onClick={() => void saveFile()}>Сохранить
                </button>
            </div>
            {error && <div className="ide-error">{error}</div>}{loading && <div className="ide-loading">…</div>}
            <div className="ide-document-body">{mode === 'preview' && isNative ?
                <NativeGfxPreview file={name}/> : mode === 'preview' && isXml ?
                    <InterfaceEditor text={text} fileName={name} entries={scope.entries} onChange={setText}
                                     disabled={loading || !active}
                                     onOpenDialog={onOpen}/> : mode === 'preview' && isMedia ?
                        <MediaPreview name={name} bytes={bytes}/> : mode === 'hex' ?
                            <pre className="ide-hex">{hex}</pre> :
                            <TextEditor ref={editor} value={text} fileName={name} readOnly={loading || !active}
                                        onChange={setText}/>}</div>
        </div>
    </ResourceContext.Provider>;
}

function NewProject({onCreated}: { onCreated: (path: string) => void }) {
    const [source, setSource] = useState(''), [parent, setParent] = useState(''), [name, setName] = useState('Project'), [archives, setArchives] = useState<{
        path: string;
        size: number
    }[]>([]), [selected, setSelected] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
    useUnsavedGuard('Импорт', busy);

    async function chooseSource() {
        const p = await open({directory: true, multiple: false});
        if (typeof p !== 'string') return;
        setBusy(true);
        try {
            setArchives(await invoke('project_scan', {source: p}));
            setSource(p);
            setSelected([]);
        } catch (e) {
            setError(String(e));
        } finally {
            setBusy(false);
        }
    }

    async function create() {
        setBusy(true);
        try {
            const p = await invoke<{ manifest: string }>('project_create', {source, parent, name, archives: selected});
            onCreated(p.manifest);
        } catch (e) {
            setError(String(e));
        } finally {
            setBusy(false);
        }
    }

    return <div className="ide-new-project"><label>Название<input disabled={busy} value={name}
                                                                  onChange={e => setName(e.target.value)}/></label>
        <button disabled={busy} onClick={() => void chooseSource()}>Клиент…</button>
        <div>{source}</div>
        <button disabled={busy} onClick={() => void (async () => {
            const p = await open({directory: true});
            if (typeof p === 'string') setParent(p);
        })()}>Каталог проекта…
        </button>
        <div>{parent}</div>
        <div>
            <button disabled={busy} onClick={() => setSelected(archives.map(a => a.path))}>Выбрать все</button>
            <button disabled={busy} onClick={() => setSelected([])}>Снять выбор</button>
        </div>
        <div className="ide-archive-selection">{archives.map(a => <div className="ide-archive-option" key={a.path}>
            <EditorSwitch label={a.path} showLabel disabled={busy} checked={selected.includes(a.path)}
                          change={checked => setSelected(v => checked ? [...v, a.path] : v.filter(p => p !== a.path))}/><small>{(a.size / 1024 / 1024).toFixed(0)} MiB</small>
        </div>)}</div>
        <button disabled={busy || !source || !parent || !name.trim()} onClick={() => void create()}>Создать</button>
        {error && <div className="ide-error">{error}</div>}</div>;
}
