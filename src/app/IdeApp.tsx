import {ElementsProfileField} from './ElementsProfileField';
import {ClientVersionField} from './ClientVersionField';
import {matchesShortcut} from './shortcuts';
import {FaGithub} from 'react-icons/fa';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {bindActionCreators} from '@reduxjs/toolkit';
import {useAppDispatch, useAppSelector, useAppStore} from '../store';
import {workspaceActions} from '../store/workspace-slice';
import {message, sourceText, t} from "../i18n";
import {
    Alert,
    Box,
    Button,
    Dialog,
    Field,
    Input,
    Link,
    NativeSelect,
    Portal,
    Progress,
    Stack,
    Text
} from "@chakra-ui/react";
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {confirm, open, save} from '@tauri-apps/plugin-dialog';
import type {ComponentProps, ReactNode} from "react";
import {lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ArchiveTree} from '../features/archive/ArchiveTree';
import {ColumnDivider, resizeWidth} from '../features/editor/ColumnDivider';
import {isImageResource} from '../features/editor/ResourceFieldPreview';
import {ResourcePicker} from '../features/editor/ResourcePicker';
import {type ElementsProfile, type ResourceScope} from '../features/editor/resource-context';
import {structuredFormat} from '../features/editor/server-records';
import {useUnsavedGuard} from '../features/editor/unsaved';
import {useColumnWidth} from '../features/editor/useColumnWidth';
import type {IdeHit} from '../features/search/IdeSearchWindow';
import {IdeMenu, type IdeMenuActions} from "./IdeMenu";
import {NewProject} from "./NewProject";
import type {ResourcePick, Tab} from "./ide-types";
import {notifications} from './notifications';

import '../styles/ide.css';


const AiPolicyEditor = lazy(() => import('../features/editor/AiPolicyEditor').then(module => ({default: module.AiPolicyEditor})));
const DomainEditor = lazy(() => import('../features/editor/DomainEditor').then(module => ({default: module.DomainEditor})));
const LocaleEditor = lazy(() => import('../features/editor/LocaleEditor').then(module => ({default: module.LocaleEditor})));
const ServerRecordsEditor = lazy(() => import('../features/editor/ServerRecordsEditor').then(module => ({default: module.ServerRecordsEditor})));
const TaskNpcEditor = lazy(() => import('../features/editor/TaskNpcEditor').then(module => ({default: module.TaskNpcEditor})));
const TasksEditor = lazy(() => import('../features/editor/TasksEditor').then(module => ({default: module.TasksEditor})));
const ElementsTab = lazy(() => import('./ElementsTab').then(module => ({default: module.ElementsTab})));
const ResourceDocument = lazy(() => import('./ResourceDocument').then(module => ({default: module.ResourceDocument})));

type SavedTab = { source: string; entry?: string; resource?: string; locale?: boolean };

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


function buildStage(stage: string) {
    if (stage.startsWith('Archive workers: ')) return t('Archive workers') + ': ' + stage.slice(17);
    if (stage.startsWith('Building client/')) return t('Building client files') + ': ' + stage.slice('Building '.length);
    if (stage.startsWith('Publishing ')) return t('Publishing file') + ': ' + stage.slice(11);
    if (stage.startsWith('Copying ')) return t('Copying file') + ': ' + stage.slice(8);
    const separator = stage.indexOf(': ');
    if (separator >= 0) return stage.slice(0, separator) + ': ' + message(stage.slice(separator + 2));
    return message(stage);
}

function EditorTabContent({active, children}: { active: boolean; children: ReactNode }) {
    const [visited, setVisited] = useState(active);
    useEffect(() => {
        if (active) setVisited(true);
    }, [active]);

    if (!active && !visited) return null;
    return <Suspense fallback={<Box className="ide-loading" role="status">{t('Loading…')}</Box>}>
        {children}
    </Suspense>;
}

export function IdeApp() {
    const [sidebarWidth, setSidebarWidth] = useColumnWidth('ide.tree', 320);
    const [resourcePick, setResourcePick] = useState<ResourcePick>();
    const [restored, setRestored] = useState(false);
    const [projectSettings, setProjectSettings] = useState<{
        id: number;
        path: string;
        version: string;
        gshopVersion: number | null;
        elementsProfile: ElementsProfile | null;
        issues?: { path: string; div: boolean; mono: boolean; error: string | null }[]
    } | null>(null);
    const xmlDrafts = useRef(new Map<number, Map<number, string>>());
    const trackXmlDraft = useCallback((scope: number, index: number, text?: string) => {
        const drafts = xmlDrafts.current.get(scope) ?? new Map<number, string>();
        if (text === undefined) drafts.delete(index); else drafts.set(index, text);
        if (drafts.size) xmlDrafts.current.set(scope, drafts); else xmlDrafts.current.delete(scope);
    }, []);
    const [scopes, setScopes] = useState<ResourceScope[]>([]);
    const dispatch = useAppDispatch();
    const store = useAppStore();
    const {
        tabs, active, busy, status, error, opening, openProgress, textExport,
        exportRevision, fileRevisions, savedArchives,
    } = useAppSelector(state => state.workspace);
    const {
        tabOpened, setActive, tabClosed, tabDirtyChanged, tabSearchJumpChanged, tabItemJumpChanged,
        archiveDirtyChanged, filesChanged, exportRevisionChanged, textExportProgressChanged,
        setBusy, setStatus, setError, setOpening, setOpenProgress, setTextExport,
    } = useMemo(() => bindActionCreators(workspaceActions, dispatch), [dispatch]);
    const picker = resourcePick?.tab === active ? resourcePick : undefined;
    const cancelResourcePick = useCallback((tab: string) => setResourcePick(current => current?.tab === tab ? undefined : current), []);
    useEffect(() => {
        if (resourcePick && resourcePick.tab !== active) setResourcePick(undefined);
    }, [active, resourcePick]);
    const [query, setQuery] = useState('');
    const scopesRef = useRef(scopes);
    scopesRef.current = scopes;
    const [help, setHelp] = useState(false);
    const [installingUpdate, setInstallingUpdate] = useState(false);
    const activeTab = tabs.find(tabItem => tabItem.key === active);
    const activeScope = scopes.find(s => s.id === activeTab?.scope);
    useUnsavedGuard('IDE', tabs.some(tabItem => tabItem.dirty) || busy || Object.values(savedArchives).some(Boolean));
    const setDirty = useCallback((key: string, dirty: boolean) => {
        tabDirtyChanged({key, dirty});
    }, [tabDirtyChanged]);

    function addTab(tab: Tab) {
        tabOpened(tab);
    }

    function openLocale(scope: ResourceScope) {
        const key = `locale:${scope.id}`;
        addTab({
            key,
            scope: scope.id,
            kind: 'locale',
            title: t("Translator · {value0}", {value0: base(scope.path)}),
            dirty: false
        });
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
            kind: structuredFormat(e.name) ? 'server-records' : /^aipolicy\.data$/i.test(base(e.name)) ? 'aipolicy' : /^elements.*\.data$/i.test(base(e.name)) ? 'elements' : /^gshop[12]?(?:\.edited)*\.data$/i.test(base(e.name)) ? 'gshop' : /^domain(?:2(?:_cross)?)?\.data$/i.test(base(e.name)) ? 'domain' : /^task_npc\.data$/i.test(base(e.name)) ? 'task-npc' : /^(?:tasks|dyn_tasks)\.data$/i.test(base(e.name)) ? 'tasks' : 'file',
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

    async function importServer(scope: ResourceScope) {
        const source = await open({directory: true, multiple: false, title: t("Server files folder")});
        if (typeof source !== 'string') return;
        setBusy(true);
        setError('');
        try {
            const updated = {
                ...await invoke<ResourceScope>('ide_import_server', {id: scope.id, source}),
                clientVersion: scope.clientVersion,
                gshopVersion: scope.gshopVersion,
                elementsProfile: scope.elementsProfile
            };
            setScopes(current => current.map(item => item.id === scope.id ? updated : item));
            scopesRef.current = scopesRef.current.map(item => item.id === scope.id ? updated : item);
        } catch (error) {
            setError(String(error));
        } finally {
            setBusy(false);
        }
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
                if (scope.kind === 'project') {
                    const previous = scopesRef.current.find(item => item.kind === 'project' && item.id !== scope!.id);
                    if (previous && store.getState().workspace.tabs.some(tab => tab.scope === previous.id && tab.dirty)) {
                        await invoke('ide_close', {id: scope.id});
                        throw new Error(t("Save the open project changes first."));
                    }
                    const view = await invoke<{
                        project: {
                            client_version: string;
                            gshop_version?: number | null;
                            elements_profile?: ElementsProfile | null
                        }
                    }>('project_open', {path: scope.path});
                    scope = {
                        ...scope,
                        clientVersion: view.project.client_version,
                        gshopVersion: view.project.gshop_version ?? null,
                        elementsProfile: view.project.elements_profile ?? null
                    };
                    if (previous) {
                        await invoke('ide_close', {id: previous.id});
                        for (const tab of store.getState().workspace.tabs) {
                            if (tab.scope === previous.id) tabClosed(tab.key);
                        }
                        scopesRef.current = scopesRef.current.filter(item => item.id !== previous.id);
                    }
                }
                scopesRef.current = [...scopesRef.current, scope];
                setScopes(scopesRef.current);
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
        if (busy || store.getState().workspace.tabs.some(tab => tab.scope === scope.id && tab.dirty)) return;
        setBusy(true);
        setTextExport({operation: t("Export texts"), stage: '', completed: 0, total: 0});
        try {
            const result = await invoke<{
                count: number;
                skipped: number;
                path: string
            }>('ide_export_texts', {id: scope.id});
            exportRevisionChanged();
            notifications.create({
                type: result.skipped ? 'warning' : 'success',
                title: t("Texts exported · {value0}", {value0: result.count.toLocaleString()}),
                description: result.skipped ? t("{value0} · Files with errors: {value1}", {
                    value0: result.path,
                    value1: result.skipped
                }) : result.path
            });
        } catch (reason) {
            notifications.create({
                type: 'error',
                title: t("Failed to export texts"),
                description: String(reason)
            });
        } finally {
            setBusy(false);
            setTextExport(undefined);
        }
    }

    async function applyLocale(scope: ResourceScope, language: string): Promise<string[]> {
        if (busy || store.getState().workspace.tabs.some(tab => tab.scope === scope.id && tab.dirty)) return [t("Save the open project changes first.")];
        setBusy(true);
        setTextExport({operation: t("Applying translation"), stage: '', completed: 0, total: 0});
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
            filesChanged({scope: scope.id, indices: [...updated]});
            notifications.create({
                type: result.errors.length ? 'warning' : 'success',
                title: t("Files updated · {value0}", {value0: updated.size}),
                description: result.errors.length ? t("Skipped · {value0}", {value0: result.errors.length}) : undefined
            });
            return result.errors;
        } catch (reason) {
            notifications.create({type: 'error', title: t("Failed to apply translation"), description: String(reason)});
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
                    setError(t("File from search results was not found"));
                    return;
                }
                openEntry(scope, index);
                if (!payload.structured) tabSearchJumpChanged({key: scope.id + ':' + index, hit: payload.hit});
                await getCurrentWindow().setFocus().catch(reason => setError(String(reason)));
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
                        if (!scope || !scopesRef.current.some(item => item.id === scope.id)) continue;
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
            if (e.payload.operation === 'Build project' && e.payload.stage.startsWith('__worker:')) {
                const match = e.payload.stage.match(/^__worker:(\d+):(.*)$/);
                if (match) {
                    const data = JSON.parse(match[2]) as { archive: string; stage: string };
                    setBuildInfo(current => current ? {
                        ...current,
                        workers: {
                            ...current.workers,
                            [match[1]]: {...data, completed: e.payload.completed, total: e.payload.total}
                        }
                    } : current);
                }
                return;
            }
            if (e.payload.operation === 'Build project' && e.payload.stage === '__overall') {
                setBuildInfo(current => current ? {
                    ...current,
                    overallDone: Math.max(current.overallDone ?? 0, e.payload.completed),
                    overallTotal: e.payload.total
                } : current);
                return;
            }
            if (e.payload.operation === 'Build project') setBuildInfo(current => current?.running ? {
                ...current,
                stage: buildStage(e.payload.stage),
                completed: e.payload.completed,
                total: e.payload.total,
                log: [...current.log, `${buildStage(e.payload.stage)} · ${e.payload.completed}/${e.payload.total}`].slice(-500)
            } : current);
            if (sourceText(e.payload.operation) === "Opening") {
                setOpenProgress(e.payload);
                return;
            }
            if (sourceText(e.payload.operation) === "Export texts" || sourceText(e.payload.operation) === "Applying translation") {
                textExportProgressChanged(e.payload);
                return;
            }
            setStatus(`${sourceText(e.payload.operation)} · ${e.payload.stage}${e.payload.total ? ' · ' + e.payload.completed + ' / ' + e.payload.total : ''}`);
        });
        return () => {
            void p.then(f => f());
        };
    }, []);
    useEffect(() => {
        const f = (e: KeyboardEvent) => {
            if (matchesShortcut(e, 'build') || matchesShortcut(e, 'buildFull')) {
                e.preventDefault();
                e.stopPropagation();
                if (!busy && !e.repeat && activeScope?.kind === 'project') void build(activeScope, matchesShortcut(e, 'buildFull'));
                return;
            }
            if (matchesShortcut(e, 'search')) {
                e.stopPropagation();
                e.preventDefault();
                void openSearch();
                return;
            }
            if (matchesShortcut(e, 'open')) {
                e.stopPropagation();
                e.preventDefault();
                if (!busy) void openFile();
            }
            if (matchesShortcut(e, 'close')) {
                e.stopPropagation();
                e.preventDefault();
                if (active) void closeTab(active);
            }
        };
        window.addEventListener('keydown', f, true);
        return () => window.removeEventListener('keydown', f, true);
    });

    async function closeTab(key: string) {
        const tab = store.getState().workspace.tabs.find(tabItem => tabItem.key === key);
        if (!tab) return;
        if (tab.dirty && !(await confirm(t("Close “{value0}” without saving?", {value0: tab.title}), {
            title: 'PW Forge',
            kind: 'warning'
        }))) return;
        tabClosed(key);
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
            setError(t("The project has no elements.data"));
            return;
        }
        const key = openEntry(target, index);
        if (key) tabItemJumpChanged({key, id, npc});
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
            archiveDirtyChanged({id: scope.id, dirty: false});
            setStatus(path);
        } catch (e) {
            setError(String(e));
        } finally {
            setBusy(false);
        }
    }

    const [buildInfo, setBuildInfo] = useState<{
        running: boolean;
        startedAt: number;
        finishedAt?: number;
        project: string;
        stage: string;
        completed: number;
        total: number;
        directory?: string;
        archives?: string[];
        loose_files?: number;
        server_files?: string[];
        client_files?: string[];
        error?: string;
        log: string[];
        workers?: Record<string, { archive: string; stage: string; completed: number; total: number }>;
        overallDone?: number;
        overallTotal?: number;
        cancelling?: boolean
    } | null>(null);
    const [buildClock, setBuildClock] = useState(Date.now());
    useEffect(() => {
        if (!buildInfo?.running) return;
        setBuildClock(Date.now());
        const timer = setInterval(() => setBuildClock(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [buildInfo?.running]);
    const buildElapsed = buildInfo ? Math.max(0, ((buildInfo.finishedAt ?? buildClock) - buildInfo.startedAt) / 1000) : 0;
    const buildFraction = buildInfo?.overallTotal ? (buildInfo.overallDone ?? 0) / buildInfo.overallTotal : 0;
    const buildEta = buildFraction > 0 && buildElapsed >= 3 ? buildElapsed * (1 - buildFraction) / buildFraction : null;
    const formatBuildTime = (seconds: number) => {
        const total = Math.max(0, Math.round(seconds));
        return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
    };
    const buildLogRef = useRef<HTMLPreElement>(null);
    const followBuildLog = useRef(true);
    useEffect(() => {
        const frame = requestAnimationFrame(() => {
            const log = buildLogRef.current;
            if (log && followBuildLog.current) log.scrollTop = log.scrollHeight;
        });
        return () => cancelAnimationFrame(frame);
    }, [buildInfo?.log]);

    async function build(scope: ResourceScope, full = false) {
        if (store.getState().workspace.tabs.some(tabItem => tabItem.scope === scope.id && tabItem.dirty)) {
            setError(t("Save changes in the editors."));
            return;
        }
        setBusy(true);
        try {
            followBuildLog.current = true;
            setBuildInfo({
                running: true,
                startedAt: Date.now(),
                project: scope.path,
                stage: '',
                completed: 0,
                total: 0,
                log: []
            });
            const r = await invoke<{
                directory: string;
                archives: string[];
                loose_files: number;
                server_files: string[];
                client_files: string[]
            }>('project_build', {
                manifest: scope.path,
                full,
                threads: (localStorage.getItem('pwforge:build-threads') ?? 'auto') === 'auto' ? 0 : Math.max(1, Math.min(32, Number(localStorage.getItem('pwforge:build-threads')) || 4))
            });
            setBuildInfo(current => current ? {...current, ...r, running: false, finishedAt: Date.now()} : current);
            setStatus(r.directory);
        } catch (e) {
            setBuildInfo(current => current ? {
                ...current,
                running: false,
                finishedAt: Date.now(),
                error: String(e)
            } : current);
        } finally {
            setBusy(false);
        }
    }

    function saved(scope: ResourceScope, index: number) {
        notifications.create({
            type: 'success',
            title: t("Saved"),
            description: base(scope.entries[index]?.name ?? scope.path)
        });
        if (scope.kind === 'archive') archiveDirtyChanged({id: scope.id, dirty: true});
        setScopes(old => old.map(s => s.id === scope.id ? {
            ...s,
            entries: s.entries.map((e, i) => i === index ? {...e, changed: true} : e)
        } : s));
    }

    const handleResourcePick: ComponentProps<typeof ResourcePicker>["choose"] = i => {
        if (!picker) return;
        const entry = pickerEntries[i];
        if (!entry) return;
        picker.choose(entry.name.replaceAll('/', '\\'));
        cancelResourcePick(picker.tab);
    };

    const menuActions: IdeMenuActions = {
        create: () => addTab({key: 'new-project', scope: 0, kind: 'new', title: t("New project"), dirty: false}),
        open: () => {
            void openFile();
        },
        save: () => {
            window.dispatchEvent(new Event('pw-forge-save'));
        },
        close: () => {
            void closeTab(active);
        },
        saveArchive: () => {
            if (activeScope) void saveArchive(activeScope);
        },
        saveArchiveAs: () => {
            if (activeScope) void saveArchive(activeScope, true);
        },
        search: () => {
            void openSearch();
        },
        projectSettings: () => {
            if (activeScope?.kind === 'project') setProjectSettings({
                id: activeScope.id,
                path: activeScope.path,
                version: activeScope.clientVersion ?? '1.5.5-lrpw',
                gshopVersion: activeScope.gshopVersion ?? null,
                elementsProfile: activeScope.elementsProfile ?? null
            });
        },
        settings: () => {
            void invoke('open_settings_window').catch(error => setError(String(error)));
        },
        importServer: () => {
            if (activeScope) void importServer(activeScope);
        },
        cleanBuilds: () => {
            if (!activeScope) return;
            const scope = activeScope;
            void (async () => {
                if (!await confirm(t('Delete old builds? The latest build will be kept.'), {
                    title: t('Clean old builds'),
                    kind: 'warning'
                })) return;
                setBusy(true);
                try {
                    const count = await invoke<number>('project_clean_builds', {manifest: scope.path, keep: 1});
                    setStatus(t('Deleted builds: {value0}', {value0: count}));
                } catch (error) {
                    setError(String(error));
                } finally {
                    setBusy(false);
                }
            })();
        },
        buildFull: () => {
            if (activeScope) void build(activeScope, true);
        },
        build: () => {
            if (activeScope) void build(activeScope);
        },
        exportTexts: () => {
            if (activeScope) void exportTexts(activeScope);
        },
        translate: () => {
            if (activeScope) openLocale(activeScope);
        },
        checkUpdates: () => {
            void (async () => {
                setBusy(true);
                try {
                    const update = await invoke<{ version: string; portable: boolean } | null>('check_app_update');
                    if (!update) {
                        notifications.create({type: 'info', title: t('PW Forge is up to date')});
                        return;
                    }
                    const title = t('Update {value0} available', {value0: update.version});
                    if (update.portable) {
                        if (await confirm(t('Open GitHub Releases to download the portable ZIP?'), {title})) await invoke('open_project_releases');
                        return;
                    }
                    const hasUnsavedChanges = () => {
                        const {tabs, savedArchives} = store.getState().workspace;
                        return tabs.some(tab => tab.dirty) || Object.values(savedArchives).some(Boolean);
                    };
                    if (hasUnsavedChanges()) {
                        setError(t('Save your changes before installing an update.'));
                        return;
                    }
                    if (await confirm(t('Install the update now? PW Forge will close.'), {title})) {
                        if (hasUnsavedChanges()) {
                            setError(t('Save your changes before installing an update.'));
                            return;
                        }
                        setInstallingUpdate(true);
                        await invoke('install_app_update', {version: update.version});
                    }
                } catch (error) {
                    setError(String(error));
                } finally {
                    setInstallingUpdate(false);
                    setBusy(false);
                }
            })();
        },
        help: () => setHelp(true),
    };
    return <Box className="forge-ide">
        <IdeMenu actions={menuActions} busy={busy} dirty={!!activeTab?.dirty} hasTab={!!activeTab}
                 kind={activeScope?.kind} scopeDirty={tabs.some(tab => tab.scope === activeScope?.id && tab.dirty)}
                 archiveChanged={!!savedArchives[activeScope?.id ?? -1]}/>
        <Dialog.Root open={installingUpdate} closeOnEscape={false} closeOnInteractOutside={false}>
            <Portal><Dialog.Backdrop/><Dialog.Positioner><Dialog.Content>
                <Dialog.Header><Dialog.Title>{t('Downloading update…')}</Dialog.Title></Dialog.Header>
                <Dialog.Body><Progress.Root value={null} size="sm" colorPalette="teal"
                                            aria-label={t('Downloading update…')}><Progress.Track><Progress.Range/></Progress.Track></Progress.Root></Dialog.Body>
            </Dialog.Content></Dialog.Positioner></Portal>
        </Dialog.Root>
        <Dialog.Root open={!!projectSettings} onOpenChange={event => {
            if (!event.open && !busy) setProjectSettings(null);
        }}>
            <Portal><Dialog.Backdrop/><Dialog.Positioner><Dialog.Content>
                <Dialog.Header><Dialog.Title>{t('Project settings')}</Dialog.Title></Dialog.Header>
                <Dialog.Body maxH="60vh" overflowY="auto">{projectSettings &&
                    <Stack gap="4"><ClientVersionField value={projectSettings.version} disabled={busy}
                                                       onChange={version => setProjectSettings({
                                                           ...projectSettings,
                                                           version,
                                                           issues: undefined
                                                       })}/>
                        <Field.Root disabled={busy}>
                            <Field.Label>{t('GShop format version')}</Field.Label>
                            <NativeSelect.Root size="sm">
                                <NativeSelect.Field value={projectSettings.gshopVersion ?? 'auto'} onChange={event => {
                                    const value = event.target.value;
                                    setProjectSettings({
                                        ...projectSettings,
                                        gshopVersion: value === 'auto' ? null : Number(value)
                                    });
                                }}>
                                    <option value="auto">{t('Auto')}</option>
                                    {Array.from({length: 8}, (_, version) => <option key={version}
                                                                                     value={version}>{version}</option>)}
                                </NativeSelect.Field>
                                <NativeSelect.Indicator/>
                            </NativeSelect.Root>
                        </Field.Root>
                        <ElementsProfileField value={projectSettings.elementsProfile} disabled={busy}
                                              onChange={elementsProfile => setProjectSettings({
                                                  ...projectSettings,
                                                  elementsProfile
                                              })}/>
                    </Stack>}
                    {!!projectSettings?.issues?.length && <Stack mt="4" gap="2">
                        <Text fontWeight="semibold">{t('Interface compatibility check')}</Text>
                        {projectSettings.issues.map(issue => <Box key={issue.path} borderWidth="1px" rounded="md" p="2">
                            <Text overflowWrap="anywhere">{issue.path}</Text>
                            <Text fontSize="sm"
                                  color="fg.warning">{issue.error ? t('Could not check XML') + ' · ' + message(issue.error) : [issue.div ? 'DIV' : '', issue.mono ? 'mono' : ''].filter(Boolean).join(', ')}</Text>
                        </Box>)}
                    </Stack>}
                </Dialog.Body>
                <Dialog.Footer>
                    <Button variant="outline" disabled={busy}
                            onClick={() => setProjectSettings(null)}>{t('Close')}</Button>
                    <Button colorPalette="teal" loading={busy} onClick={async () => {
                        if (!projectSettings || busy) return;
                        const {id, path, version, gshopVersion, elementsProfile} = projectSettings;
                        const previousProfile = scopesRef.current.find(scope => scope.id === id)?.elementsProfile;
                        const elementsChanged = previousProfile?.version !== elementsProfile?.version
                            || previousProfile?.variant !== elementsProfile?.variant;
                        if (elementsChanged && store.getState().workspace.tabs.some(tab => tab.scope === id && tab.kind === 'elements' && tab.dirty)) {
                            setError(t('Save Elements changes before changing the schema.'));
                            setProjectSettings(null);
                            return;
                        }
                        if ((scopesRef.current.find(scope => scope.id === id)?.gshopVersion ?? null) !== gshopVersion
                            && store.getState().workspace.tabs.some(tab => tab.scope === id && tab.kind === 'gshop' && tab.dirty)) {
                            setError(t('Save GShop changes before changing the format version.'));
                            setProjectSettings(null);
                            return;
                        }
                        setBusy(true);
                        try {
                            const previous = scopesRef.current.find(scope => scope.id === id)?.clientVersion;
                            if (version === '1.5.5' && previous !== '1.5.5' && !projectSettings.issues) {
                                const issues = await invoke<{
                                    path: string;
                                    div: boolean;
                                    mono: boolean;
                                    error: string | null
                                }[]>('ide_check_interface_compatibility', {
                                    id, drafts: Object.fromEntries(xmlDrafts.current.get(id) ?? [])
                                });
                                if (issues.length) {
                                    setProjectSettings({...projectSettings, issues});
                                    return;
                                }
                            }
                            await invoke('project_set_client_version', {
                                manifest: path,
                                clientVersion: version,
                                gshopVersion,
                                elementsProfile
                            });
                            const update = (scope: ResourceScope) => scope.id === id ? {
                                ...scope,
                                clientVersion: version,
                                gshopVersion,
                                elementsProfile
                            } : scope;
                            setScopes(scopes => scopes.map(update));
                            scopesRef.current = scopesRef.current.map(update);
                            setProjectSettings(null);
                        } catch (error) {
                            setError(String(error));
                            setProjectSettings(null);
                        } finally {
                            setBusy(false);
                        }
                    }}>{t(projectSettings?.issues?.length ? 'Switch anyway' : 'Save')}</Button>
                </Dialog.Footer>
            </Dialog.Content></Dialog.Positioner></Portal>
        </Dialog.Root>
        <Dialog.Root open={!!buildInfo} closeOnInteractOutside={false} closeOnEscape={!buildInfo?.running}
                     onOpenChange={event => {
                         if (!event.open && !buildInfo?.running) setBuildInfo(null);
                     }}>
            <Portal><Dialog.Backdrop/><Dialog.Positioner><Dialog.Content>
                <Dialog.Header><Dialog.Title>{t(buildInfo?.running ? 'Building changes…' : buildInfo?.error === 'Build cancelled' ? 'Build cancelled' : buildInfo?.error ? 'Build failed' : 'Build complete')}</Dialog.Title></Dialog.Header>
                <Dialog.Body maxH="65vh" overflowY="auto"><Stack gap="3" role="status">
                    <Text fontSize="sm" color="fg.muted" overflowWrap="anywhere">{buildInfo?.project}</Text>
                    {buildInfo && <Text fontSize="sm"
                                        color="fg.muted">{t('Elapsed time')}: {formatBuildTime(buildElapsed)}{buildInfo.running && <> · {t('Estimated time remaining')}: {buildEta === null ? t('Estimating…') : '≈ ' + formatBuildTime(buildEta)}</>}</Text>}
                    {buildInfo?.running && <>
                        <Text fontSize="sm">{t('Overall progress')}: {Math.floor(buildFraction * 100)}%</Text>
                        <Progress.Root value={buildInfo.overallTotal ? buildInfo.overallDone ?? 0 : null}
                                       max={buildInfo.overallTotal || 100} colorPalette="blue" size="sm"
                                       aria-label={t('Overall progress')}><Progress.Track><Progress.Range/></Progress.Track></Progress.Root>
                        {Object.entries(buildInfo.workers ?? {}).filter(([, worker]) => worker.completed < worker.total).sort(([a], [b]) => Number(a) - Number(b)).map(([id, worker]) =>
                            <Stack key={id} gap="1" p="2" borderWidth="1px" rounded="md">
                                <Text
                                    fontSize="sm">{worker.archive} · {Math.floor(worker.completed / worker.total * 100)}%</Text>
                                <Text fontSize="xs" color="fg.muted">{buildStage(worker.stage)}</Text>
                                <Progress.Root value={worker.completed} max={worker.total} colorPalette="teal" size="sm"
                                               aria-label={worker.archive}><Progress.Track><Progress.Range/></Progress.Track></Progress.Root>
                            </Stack>)}
                        {!Object.keys(buildInfo.workers ?? {}).length && <Text fontSize="sm">{t('Current file')}</Text>}
                        {(!Object.keys(buildInfo.workers ?? {}).length || Object.values(buildInfo.workers ?? {}).every(worker => worker.completed >= worker.total)) &&
                            <Text>{message(buildInfo.stage || 'Working…')}</Text>}
                        <Progress.Root display={Object.keys(buildInfo.workers ?? {}).length ? 'none' : undefined}
                                       value={buildInfo.total ? buildInfo.completed : null} max={buildInfo.total || 100}
                                       colorPalette="teal" size="sm"
                                       aria-label={t('Build changes')}><Progress.Track><Progress.Range/></Progress.Track></Progress.Root>
                        {!Object.keys(buildInfo.workers ?? {}).length && !!buildInfo.total &&
                            <Text fontSize="sm">{buildInfo.completed} / {buildInfo.total}</Text>}
                    </>}
                    {!!buildInfo?.log.length && <Box ref={buildLogRef} as="pre" onScroll={event => {
                        const log = event.currentTarget;
                        followBuildLog.current = log.scrollHeight - log.scrollTop - log.clientHeight <= 24;
                    }} maxH="240px" overflow="auto" bg="bg.subtle" p="3" rounded="md" fontSize="xs"
                                                     whiteSpace="pre-wrap"
                                                     overflowWrap="anywhere">{buildInfo.log.join('\n')}</Box>}
                    {buildInfo?.error && <Text color="fg.error">{message(buildInfo.error)}</Text>}
                    {buildInfo?.directory && <>
                        <Text overflowWrap="anywhere">{buildInfo.directory}</Text>
                        <Text>{t('Archives')}: {buildInfo.archives?.length ?? 0} · {t('Files')}: {buildInfo.loose_files ?? 0}</Text>
                        {buildInfo.archives?.map(archive => <Text key={archive} fontSize="sm">{archive}</Text>)}
                        <Text fontWeight="medium">{t('Server files')}: {buildInfo.server_files?.length ?? 0}</Text>
                        {buildInfo.server_files?.map(file => <Text key={file} fontSize="sm"
                                                                   overflowWrap="anywhere">{file}</Text>)}
                        {!buildInfo.server_files?.length &&
                            <Text fontSize="sm" color="fg.muted">{t('No saved server changes in this build.')}</Text>}
                        {buildInfo.client_files?.map(file => <Text key={file} fontSize="sm"
                                                                   overflowWrap="anywhere">{file}</Text>)}
                    </>}
                </Stack></Dialog.Body>
                <Dialog.Footer>
                    {buildInfo?.running && <Button variant="outline" disabled={buildInfo.cancelling} onClick={() => {
                        setBuildInfo(current => current ? {...current, cancelling: true} : current);
                        void invoke('project_cancel_build').catch(error => setError(String(error)));
                    }}>{t(buildInfo.cancelling ? 'Cancelling…' : 'Cancel build')}</Button>}
                    {buildInfo?.directory && <Button colorPalette="teal" onClick={() => {
                        void invoke('open_build_directory', {directory: buildInfo.directory}).catch(error => setBuildInfo(current => current ? {
                            ...current,
                            error: String(error)
                        } : current));
                    }}>{t('Open in Explorer')}</Button>}
                    <Button variant="outline" disabled={buildInfo?.running}
                            onClick={() => setBuildInfo(null)}>{t('Close')}</Button>
                </Dialog.Footer>
            </Dialog.Content></Dialog.Positioner></Portal>
        </Dialog.Root>
        <Dialog.Root open={help} onOpenChange={event => setHelp(event.open)}>
            <Portal><Dialog.Backdrop/><Dialog.Positioner><Dialog.Content>
                <Dialog.Header><Dialog.Title>PW Forge</Dialog.Title></Dialog.Header>
                <Dialog.Body><Stack gap="3">
                    <Text>{t("Perfect World client and server resource editor.")}</Text>
                    <Text>{t("Work with PCK archives, edit resources, import server files, build changes and translate game texts in one workspace.")}</Text>
                </Stack></Dialog.Body>
                <Dialog.Footer position="relative" justifyContent="center">
                    <Link href="https://github.com/LRPW/pw-forge" target="_blank" rel="noopener noreferrer"
                          title="GitHub · LRPW/pw-forge" aria-label="GitHub · LRPW/pw-forge"
                          onClick={event => {
                              event.preventDefault();
                              void invoke('open_project_github').catch(error => {
                                  setHelp(false);
                                  setError(String(error));
                              });
                          }}>
                        <FaGithub size="24px"/>
                    </Link>
                    <Button position="absolute" right="6" size="sm" onClick={() => setHelp(false)}>{t("Close")}</Button>
                </Dialog.Footer>
            </Dialog.Content></Dialog.Positioner></Portal>
        </Dialog.Root>
        {error &&
            <Alert.Root status="error" size="sm" role="alert"><Alert.Indicator/><Alert.Content>{message(error)}<Button
                onClick={() => setError('')}>×</Button></Alert.Content></Alert.Root>}
        <main className="ide-main">
            <aside className="ide-sidebar" style={{width: sidebarWidth}}>
                <Field.Root width="auto"><Input aria-label={t("Find files")} placeholder={t("Searching…")} value={query}
                                                onChange={e => setQuery(e.target.value)}/></Field.Root>
                <ArchiveTree entries={treeEntries} query={query}
                             selected={selected !== undefined && selected >= 0 ? selected : undefined} busy={busy}
                             choose={i => {
                                 const entry = treeEntries[i];
                                 if (entry) openEntry(entry.scope, entry.index);
                             }}/></aside>
            {picker && <ResourcePicker field={picker.field} entries={pickerEntries} busy={busy}
                                       cancel={() => cancelResourcePick(picker.tab)} choose={handleResourcePick}/>}
            <ColumnDivider label={t("File tree width")}
                           onDelta={delta => setSidebarWidth(width => resizeWidth(width, delta, 220, Math.min(600, window.innerWidth - 420)))}/>
            <section className="ide-workbench">
                <Box className="ide-tabs" role="tablist" aria-label={t("Open files")}>{tabs.map(tabItem => <Box
                    key={tabItem.key}
                    className={`ide-tab${active === tabItem.key ? ' active' : ''}`}
                    onMouseDown={event => {
                        if (event.button === 1) event.preventDefault();
                    }}
                    onAuxClick={event => {
                        if (event.button !== 1) return;
                        event.preventDefault();
                        void closeTab(tabItem.key);
                    }}>
                    <Button role="tab" aria-selected={active === tabItem.key} onClick={() => setActive(tabItem.key)}
                            title={tabItem.title}>{tabItem.title}{tabItem.dirty ? ' ●' : ''}</Button>
                    <Button aria-label={t("Close {value0}", {value0: tabItem.title})}
                            onClick={() => void closeTab(tabItem.key)}>×</Button>
                </Box>)}</Box>
                <Box className="ide-editors">{tabs.map(tab => {
                    const scope = scopes.find(s => s.id === tab.scope);
                    return <Box className="ide-document" key={tab.key + "@" + (fileRevisions[tab.key] ?? 0)}
                                style={{display: tab.key === active ? 'flex' : 'none'}}>
                        <EditorTabContent active={restored && tab.key === active}>{tab.kind === 'new' ?
                            <NewProject onCreated={path => {
                                void loadPath(path);
                                tabClosed('new-project');
                            }}/> : scope && tab.kind === 'locale' ?
                                <LocaleEditor id={scope.id} active={tab.key === active} revision={exportRevision}
                                              exporting={!!textExport} onExport={() => void exportTexts(scope)}
                                              onApply={scope.kind === 'project' ? language => applyLocale(scope, language) : undefined}
                                              onDirty={dirty => setDirty(tab.key, dirty)}/> : scope && tab.kind === 'source' ?
                                    <Box className="ide-source">
                                        <Box>{scope.path}</Box>
                                        <Field.Root width="auto"><Input placeholder={t("File…")}
                                                                        aria-label={t("Content filter")}
                                                                        onChange={e => setQuery(e.target.value)}/></Field.Root>
                                        <Box className="ide-source-files">{scope.entries.slice(0, 300).map((e, i) =>
                                            <Button
                                                key={i} onClick={() => openEntry(scope, i)}>{e.name}</Button>)}</Box>
                                    </Box> : scope && tab.kind === 'task-npc' ?
                                        <TaskNpcEditor openNpc={npcId => void openElementsRecord(scope, npcId, true)}
                                                       id={scope.id} index={tab.index!} active={tab.key === active}
                                                       onDirty={dirty => setDirty(tab.key, dirty)}
                                                       onSaved={() => saved(scope, tab.index!)}/> : scope && tab.kind === 'tasks' ?
                                            <TasksEditor openItem={itemId => void openElementsRecord(scope, itemId)}
                                                         openNpc={npcId => void openElementsRecord(scope, npcId, true)}
                                                         id={scope.id} index={tab.index!} active={tab.key === active}
                                                         onDirty={dirty => setDirty(tab.key, dirty)}
                                                         onSaved={() => saved(scope, tab.index!)}/> : scope && tab.kind === 'server-records' ?
                                                <ServerRecordsEditor active={tab.key === active} id={scope.id}
                                                                     index={tab.index!}
                                                                     format={structuredFormat(tab.title)!}
                                                                     onDirty={dirty => setDirty(tab.key, dirty)}
                                                                     onSaved={() => saved(scope, tab.index!)}/> : scope && tab.kind === 'aipolicy' ?
                                                    <AiPolicyEditor active={tab.key === active} id={scope.id}
                                                                    index={tab.index!}
                                                                    onDirty={dirty => setDirty(tab.key, dirty)}
                                                                    onSaved={() => saved(scope, tab.index!)}/> : scope && tab.kind === 'domain' ?
                                                        <DomainEditor id={scope.id} index={tab.index!}
                                                                      filename={tab.title}
                                                                      active={tab.key === active}
                                                                      onDirty={dirty => setDirty(tab.key, dirty)}
                                                                      onSaved={() => saved(scope, tab.index!)}/> : scope && (tab.kind === 'elements' || tab.kind === 'gshop') ?
                                                            <ElementsTab scope={scope} tab={tab}
                                                                         active={tab.key === active}
                                                                         onDirty={setDirty}
                                                                         onSaved={() => saved(scope, tab.index!)}
                                                                         onOpen={() => void openFile()}
                                                                         readFieldImage={readFieldImage}
                                                                         openFieldResource={openFieldResource}
                                                                         openElementsRecord={openElementsRecord}
                                                                         onResourcePick={setResourcePick}
                                                                         onCancelResourcePick={cancelResourcePick}/> : scope ?
                                                                <ResourceDocument scope={scope} tab={tab}
                                                                                  onXmlDraft={trackXmlDraft}
                                                                                  active={tab.key === active}
                                                                                  onDirty={setDirty}
                                                                                  onSaved={() => saved(scope, tab.index!)}
                                                                                  onOpen={name => openResource(scope, name, scope.entries[tab.index ?? 0]?.name)}/> : null}
                        </EditorTabContent>
                    </Box>;
                })}</Box>
            </section>
        </main>
        <footer className="ide-status" role="status">{opening ? <Box className='ide-open-progress'>
            <span>{t("Opening ")}{opening}{openProgress?.stage ? ' · ' + message(openProgress.stage) : ''}</span><Progress.Root
            size="xs" colorPalette="teal" aria-label={t("Loading file")}
            value={openProgress?.total ? openProgress.completed : null}
            max={openProgress?.total || 100}><Progress.Track><Progress.Range/></Progress.Track></Progress.Root>
        </Box> : textExport ? <Box className='ide-open-progress'>
            <span>{textExport.operation}{textExport.stage ? ' · ' + message(textExport.stage) : ''}</span><Progress.Root
            size='xs' colorPalette='teal' aria-label={textExport.operation}
            value={textExport.total ? textExport.completed : null}
            max={textExport.total || 100}><Progress.Track><Progress.Range/></Progress.Track></Progress.Root>
        </Box> : busy ? t("Working…") : status}</footer>
    </Box>;
}
