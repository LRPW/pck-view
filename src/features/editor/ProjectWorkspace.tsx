import {ClientVersionField} from '../../app/ClientVersionField';
import {matchesShortcut} from '../../app/shortcuts';
import {message, sourceText, t} from "../../i18n";
import {Alert, Box, Button, Field, Input, Switch} from "@chakra-ui/react";
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {confirm, open} from '@tauri-apps/plugin-dialog';
import {useEffect, useRef, useState} from 'react';
import {TextEditor} from './TextEditor';
import './elements.css';
import './project.css';
import {hasUnsavedEdits, useUnsavedGuard} from './unsaved';

type Item = { name: string; path: string; directory: boolean; size: number; changed?: boolean };
type Project = {
    manifest: string;
    project: { name: string; source: string; archives: string[]; status: string; errors: string[] }
};

function Folder({manifest, item, onFile, onError}: {
    manifest: string;
    item: Item;
    onFile: (item: Item) => void;
    onError: (e: string) => void
}) {
    const [expanded, setExpanded] = useState(false);
    const [children, setChildren] = useState<Item[]>();
    useEffect(() => {
        if (!expanded) return;
        const refresh = () => {
            void invoke<Item[]>('project_children', {
                manifest,
                path: item.path
            }).then(setChildren).catch(e => onError(String(e)));
        };
        window.addEventListener('pwforge-saved', refresh);
        return () => window.removeEventListener('pwforge-saved', refresh);
    }, [expanded, manifest, item.path]);

    async function toggle() {
        if (!item.directory) {
            onFile(item);
            return;
        }
        if (!children) {
            try {
                setChildren(await invoke<Item[]>('project_children', {manifest, path: item.path}));
            } catch (e) {
                onError(String(e));
                return;
            }
        }
        setExpanded(v => !v);
    }

    return <Box>
        <Button className="project-node" title={item.path}
                onClick={() => void toggle()}>{item.directory ? (expanded ? '▾ ' : '▸ ') : '· '}{item.name}{item.changed ? ' ●' : ''}</Button>
        {expanded &&
            <Box className="project-branch">{children?.map(c => <Folder key={c.path} manifest={manifest} item={c}
                                                                        onFile={onFile} onError={onError}/>)}</Box>}
    </Box>;
}

export function ProjectWorkspace({visible, onOpen, onElements, onBack}: {
    visible: boolean;
    onOpen: () => void;
    onElements: (path?: string, context?: { manifest: string; path: string }) => void;
    onBack: () => void
}) {
    const [project, setProject] = useState<Project>();
    const [source, setSource] = useState('');
    const [parent, setParent] = useState('');
    const [clientVersion, setClientVersion] = useState('1.5.5-lrpw');
    const [name, setName] = useState('My PW Project');
    const [archives, setArchives] = useState<Item[]>([]);
    const [selected, setSelected] = useState<string[]>([]);
    const [wizard, setWizard] = useState(false);
    const [roots, setRoots] = useState<Item[]>([]);
    const [file, setFile] = useState<Item>();
    const [original, setOriginal] = useState<number[]>([]);
    const [text, setText] = useState('');
    const [saved, setSaved] = useState('');
    const [encoding, setEncoding] = useState('utf-8');
    const [editable, setEditable] = useState(false);
    const [hex, setHex] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [status, setStatus] = useState(t("Done"));
    const dirty = text !== saved;
    const unsaved = useRef(false);
    unsaved.current = dirty;
    const initial = useRef(false);
    const [buildResult, setBuildResult] = useState<{ directory: string; archives: string[]; loose_files: number }>();
    useUnsavedGuard(t("project"), dirty || busy);

    async function run(fn: () => Promise<void>) {
        setBusy(true);
        setError('');
        try {
            await fn();
        } catch (e) {
            setError(String(e));
        } finally {
            setBusy(false);
        }
    }

    async function discard() {
        return !dirty || confirm(t("Discard unsaved changes to the project file?"), {
            title: 'PW Forge',
            kind: 'warning'
        });
    }

    useEffect(() => {
        if (!visible) return;
        const handler = (e: KeyboardEvent) => {
            if (matchesShortcut(e, 'save')) {
                e.preventDefault();
                if (!busy && editable && dirty) void saveFile();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    });

    async function show(p: Project) {
        setRoots(await invoke<Item[]>('project_children', {manifest: p.manifest, path: ''}));
        setProject(p);
        setWizard(false);
        setFile(undefined);
        setText('');
        setSaved('');
        localStorage.setItem('pwforge:last-project', p.manifest);
        setStatus(p.project.status === 'ready' ? t("Project opened") : "Import incomplete: " + p.project.errors.join('; '));
    }

    useEffect(() => {
        if (initial.current) return;
        initial.current = true;
        void run(async () => {
            const path = await invoke<string | null>('project_startup') ?? localStorage.getItem('pwforge:last-project');
            if (path) await show(await invoke<Project>('project_open', {path}));
        });
    }, []);
    useEffect(() => {
        const p = listen<{ operation: string; stage: string; completed: number; total: number }>('pck-progress', e => {
            if (["Import project", "Find archives", "Build project", "Extract file"].includes(sourceText(e.payload.operation))) setStatus(`${e.payload.stage} · ${e.payload.completed.toLocaleString()} / ${e.payload.total.toLocaleString()}`);
        });
        return () => {
            void p.then(f => f());
        };
    }, []);

    async function chooseSource() {
        const path = await open({directory: true, multiple: false, title: t("Perfect World client folder")});
        if (typeof path !== 'string') return;
        await run(async () => {
            const files = await invoke<Item[]>('project_scan', {source: path});
            setSource(path);
            setArchives(files);
            setSelected([]);
            setStatus(t("Found {value0} PCK.", {value0: files.length}));
        });
    }

    async function create() {
        if (!(await discard())) return;
        await run(async () => {
            const p = await invoke<Project>('project_create', {
                source,
                parent,
                name,
                archives: selected,
                clientVersion
            });
            await show(p);
        });
    }

    useEffect(() => {
        const handler = (event: Event) => {
            const path = (event as CustomEvent<string>).detail;
            void (async () => {
                if (await discard()) await run(async () => {
                    await show(await invoke<Project>('project_open', {path}));
                    setBuildResult(undefined);
                });
            })();
        };
        window.addEventListener('pwforge-open-project', handler);
        return () => window.removeEventListener('pwforge-open-project', handler);
    });

    async function read(item: Item) {
        if (!(await discard()) || !project) return;
        await run(async () => {
            if (item.name.toLowerCase() === 'elements.data') {
                onElements(undefined, {manifest: project.manifest, path: item.path});
                return;
            }
            const bytes = await invoke<number[]>('project_read', {manifest: project.manifest, path: item.path});
            const array = new Uint8Array(bytes);
            let enc = 'utf-8';
            if (bytes[0] === 255 && bytes[1] === 254) enc = 'utf-16le'; else if (bytes[0] === 254 && bytes[1] === 255) enc = 'utf-16be'; else {
                try {
                    new TextDecoder('utf-8', {fatal: true}).decode(array);
                } catch {
                    enc = 'gbk';
                }
            }
            const canEdit = /\.(txt|xml|ini|cfg|lua|json|csv|log|fx|hlsl|vsh|psh|html|css|js|md|properties|strings)$/i.test(item.name);
            setFile(item);
            setOriginal(bytes);
            setEncoding(enc);
            setEditable(canEdit);
            const value = canEdit ? new TextDecoder(enc, {ignoreBOM: true}).decode(array) : '';
            setText(value);
            setSaved(value);
            setHex(Array.from({length: Math.ceil(Math.min(4096, bytes.length) / 16)}, (_, i) => `${(i * 16).toString(16).padStart(8, '0')}  ${bytes.slice(i * 16, i * 16 + 16).map(b => b.toString(16).padStart(2, '0')).join(' ')}`).join('\n'));
            setStatus(item.path);
        });
    }

    async function saveFile() {
        if (!project || !file) return;
        await run(async () => {
            await invoke('project_write', {manifest: project.manifest, path: file.path, text, encoding, original});
            setOriginal(await invoke<number[]>('project_read', {manifest: project.manifest, path: file.path}));
            setSaved(text);
            setStatus("Edit saved separately: " + file.path);
            window.dispatchEvent(new Event('pwforge-saved'));
        });
    }

    async function build() {
        if (!project) return;
        if (hasUnsavedEdits()) {
            setError(t("Save changes in the open editors before building."));
            return;
        }
        await run(async () => {
            const result = await invoke<{
                directory: string;
                archives: string[];
                loose_files: number
            }>('project_build', {manifest: project.manifest});
            setBuildResult(result);
            setStatus(t("Build complete: {value0} PCK, {value1} loose files. {value2}", {
                value0: result.archives.length,
                value1: result.loose_files,
                value2: result.directory
            }));
        });
    }

    return <section className="elements-editor project-shell" style={{display: visible ? 'flex' : 'none'}}>
        <header><strong>PW Forge{project && <span> / {project.project.name}</span>}</strong>
            <Button disabled={busy} onClick={() => setWizard(true)}>{t("New project")}</Button>
            <Button disabled={busy} onClick={onOpen}>{t("Open")}</Button>
            <Button disabled={busy || !project} onClick={() => void build()}>{t("Build changes")}</Button>
            <Button onClick={onBack}>{t("Archives →")}</Button>
        </header>
        {error && <Alert.Root status="error" size="sm"
                              role="alert"><Alert.Indicator/><Alert.Content>{message(error)}</Alert.Content></Alert.Root>}
        {buildResult && <Box className="elements-path">{t("Build result: ")}<Field.Root width="auto"><Input readOnly
                                                                                                            aria-label={t("Build directory")}
                                                                                                            value={buildResult.directory}
                                                                                                            onFocus={e => e.target.select()}/></Field.Root>
        </Box>}
        {wizard ?
            <Box className="project-wizard"><h2>{t("Import client into a new project")}</h2><Field.Root
                width="auto"><Field.Label>{t("Name")}</Field.Label><Input value={name}
                                                                          disabled={busy}
                                                                          onChange={e => setName(e.target.value)}/></Field.Root>
                <ClientVersionField value={clientVersion} onChange={setClientVersion} disabled={busy}/>
                <Button disabled={busy} onClick={() => void chooseSource()}>{t("Choose client folder")}</Button>
                <p>{source || "No folder selected"}</p>
                <Button disabled={busy} onClick={() => void (async () => {
                    const path = await open({
                        directory: true,
                        multiple: false,
                        title: t("Where should the project folder be created?")
                    });
                    if (typeof path === 'string') setParent(path);
                })()}>{t("Choose project location")}</Button>
                <p>{parent ? `${parent} / ${name}` : t("No location selected")}</p>
                <Box className="project-archive-actions">
                    <Button disabled={busy}
                            onClick={() => setSelected(archives.map(a => a.path))}>{t("Select all")}</Button>
                    <Button disabled={busy} onClick={() => setSelected([])}>{t("Clear selection")}</Button>
                    <span>{selected.length} / {archives.length}</span></Box>
                <Box className="project-archive-selection">{archives.map(a => <Switch.Root size="sm" colorPalette="teal"
                                                                                           key={a.path} disabled={busy}
                                                                                           checked={selected.includes(a.path)}
                                                                                           onCheckedChange={({checked}) => setSelected(s => checked ? [...s, a.path] : s.filter(p => p !== a.path))}><Switch.HiddenInput/><Switch.Control><Switch.Thumb/></Switch.Control><Switch.Label>{a.path}<small>{(a.size / 1024 / 1024).toFixed(0)} MiB</small></Switch.Label></Switch.Root>)}</Box>
                <Box>
                    <Button disabled={busy || !source || !parent || !name.trim()}
                            onClick={() => void create()}>{t("Create project and import")}</Button>
                    <Button disabled={busy} onClick={() => setWizard(false)}>{t("Cancel")}</Button>
                </Box>
            </Box> : project ? <>
                <Box className="elements-path">{project.manifest}</Box>
                <main>
                    <aside className="project-tree" aria-label={t("Project files")}>{roots.map(item => <Folder
                        key={project.manifest + item.path} manifest={project.manifest} item={item} onFile={item => {
                        if (!busy) void read(item);
                    }} onError={setError}/>)}</aside>
                    <article>{file ? <>
                        <Box className="elements-field-toolbar">
                            <strong>{file.path}{dirty ? ' *' : ''}</strong><span>{encoding} · {file.size.toLocaleString()} bytes</span>
                            <Button disabled={busy || !dirty || !editable}
                                    onClick={() => void saveFile()}>{t("Save")}</Button>
                        </Box>
                        <Box className="project-editor">{editable ?
                            <TextEditor value={text} fileName={file.name} readOnly={busy} onChange={setText}/> : <>
                                <p>{t("HEX · first 4096 bytes")}</p>
                                <pre>{hex}</pre>
                            </>}</Box>
                    </> : <Box className="elements-empty">{project.project.errors.length > 0 &&
                        <pre className="elements-error">{project.project.errors.join('\n')}</pre>}</Box>}</article>
                </main>
            </> : <Box className="elements-empty"></Box>}
        <footer className="elements-status"><span>{busy ? t("Working: ") : ''}{message(status)}</span>
            <Button disabled={busy} onClick={() => void run(async () => {
                await invoke('project_register_association');
                setStatus(t("The .pwforge association is registered for this executable."));
            })}>{t(".pwforge association")}</Button>
        </footer>
    </section>;
}
