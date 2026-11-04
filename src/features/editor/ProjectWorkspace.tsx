import {useEffect, useRef, useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {confirm, open} from '@tauri-apps/plugin-dialog';
import {hasUnsavedEdits, useUnsavedGuard} from './unsaved';
import {TextEditor} from './TextEditor';
import './elements.css';
import './project.css';

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

    return <div>
        <button className="project-node" title={item.path}
                onClick={() => void toggle()}>{item.directory ? (expanded ? '▾ ' : '▸ ') : '· '}{item.name}{item.changed ? ' ●' : ''}</button>
        {expanded &&
            <div className="project-branch">{children?.map(c => <Folder key={c.path} manifest={manifest} item={c}
                                                                        onFile={onFile} onError={onError}/>)}</div>}
    </div>;
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
    const [status, setStatus] = useState('Готово');
    const dirty = text !== saved;
    const unsaved = useRef(false);
    unsaved.current = dirty;
    const initial = useRef(false);
    const [buildResult, setBuildResult] = useState<{ directory: string; archives: string[]; loose_files: number }>();
    useUnsavedGuard('проект', dirty || busy);

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
        return !dirty || confirm('Отбросить несохранённые изменения файла проекта?', {
            title: 'PW Forge',
            kind: 'warning'
        });
    }

    useEffect(() => {
        if (!visible) return;
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
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
        setStatus(p.project.status === 'ready' ? 'Проект открыт' : 'Импорт завершён не полностью: ' + p.project.errors.join('; '));
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
            if (['Импорт проекта', 'Поиск архивов', 'Сборка проекта', 'Извлечение файла'].includes(e.payload.operation)) setStatus(`${e.payload.stage} · ${e.payload.completed.toLocaleString()} / ${e.payload.total.toLocaleString()}`);
        });
        return () => {
            void p.then(f => f());
        };
    }, []);

    async function chooseSource() {
        const path = await open({directory: true, multiple: false, title: 'Папка клиента Perfect World'});
        if (typeof path !== 'string') return;
        await run(async () => {
            const files = await invoke<Item[]>('project_scan', {source: path});
            setSource(path);
            setArchives(files);
            setSelected([]);
            setStatus(`Найдено ${files.length} PCK.`);
        });
    }

    async function create() {
        if (!(await discard())) return;
        await run(async () => {
            const p = await invoke<Project>('project_create', {source, parent, name, archives: selected});
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
            setStatus('Правка сохранена отдельно: ' + file.path);
            window.dispatchEvent(new Event('pwforge-saved'));
        });
    }

    async function build() {
        if (!project) return;
        if (hasUnsavedEdits()) {
            setError('Сначала сохраните изменения в открытых редакторах, затем запустите сборку.');
            return;
        }
        await run(async () => {
            const result = await invoke<{
                directory: string;
                archives: string[];
                loose_files: number
            }>('project_build', {manifest: project.manifest});
            setBuildResult(result);
            setStatus(`Сборка готова: ${result.archives.length} PCK, ${result.loose_files} отдельных файлов. ${result.directory}`);
        });
    }

    return <section className="elements-editor project-shell" style={{display: visible ? 'flex' : 'none'}}>
        <header><strong>PW Forge{project && <span> / {project.project.name}</span>}</strong>
            <button disabled={busy} onClick={() => setWizard(true)}>Новый проект</button>
            <button disabled={busy} onClick={onOpen}>Открыть</button>
            <button disabled={busy || !project} onClick={() => void build()}>Собрать изменения</button>
            <button onClick={onBack}>Архивы →</button>
        </header>
        {error && <div className="elements-error" role="alert">{error}</div>}
        {buildResult && <div className="elements-path">Результат сборки: <input readOnly aria-label="Папка сборки"
                                                                                value={buildResult.directory}
                                                                                onFocus={e => e.target.select()}/>
        </div>}
        {wizard ?
            <div className="project-wizard"><h2>Импорт клиента в новый проект</h2><label>Название<input value={name}
                                                                                                        disabled={busy}
                                                                                                        onChange={e => setName(e.target.value)}/></label>
                <button disabled={busy} onClick={() => void chooseSource()}>Выбрать папку клиента</button>
                <p>{source || 'Папка не выбрана'}</p>
                <button disabled={busy} onClick={() => void (async () => {
                    const path = await open({directory: true, multiple: false, title: 'Где создать папку проекта?'});
                    if (typeof path === 'string') setParent(path);
                })()}>Выбрать расположение проекта
                </button>
                <p>{parent ? `${parent} / ${name}` : 'Расположение не выбрано'}</p>
                <div className="project-archive-actions">
                    <button disabled={busy} onClick={() => setSelected(archives.map(a => a.path))}>Выбрать все</button>
                    <button disabled={busy} onClick={() => setSelected([])}>Снять выбор</button>
                    <span>{selected.length} / {archives.length}</span></div>
                <div className="project-archive-selection">{archives.map(a => <label key={a.path}><input type="checkbox"
                                                                                                         disabled={busy}
                                                                                                         checked={selected.includes(a.path)}
                                                                                                         onChange={e => setSelected(s => e.target.checked ? [...s, a.path] : s.filter(p => p !== a.path))}/>{a.path}<small>{(a.size / 1024 / 1024).toFixed(0)} MiB</small></label>)}</div>
                <div>
                    <button disabled={busy || !source || !parent || !name.trim()} onClick={() => void create()}>Создать
                        проект и импортировать
                    </button>
                    <button disabled={busy} onClick={() => setWizard(false)}>Отмена</button>
                </div>
            </div> : project ? <>
                <div className="elements-path">{project.manifest}</div>
                <main>
                    <aside className="project-tree" aria-label="Файлы проекта">{roots.map(item => <Folder
                        key={project.manifest + item.path} manifest={project.manifest} item={item} onFile={item => {
                        if (!busy) void read(item);
                    }} onError={setError}/>)}</aside>
                    <article>{file ? <>
                        <div className="elements-field-toolbar">
                            <strong>{file.path}{dirty ? ' *' : ''}</strong><span>{encoding} · {file.size.toLocaleString()} bytes</span>
                            <button disabled={busy || !dirty || !editable} onClick={() => void saveFile()}>Сохранить
                            </button>
                        </div>
                        <div className="project-editor">{editable ?
                            <TextEditor value={text} fileName={file.name} readOnly={busy} onChange={setText}/> : <>
                                <p>HEX · первые 4096 байт</p>
                                <pre>{hex}</pre>
                            </>}</div>
                    </> : <div className="elements-empty">{project.project.errors.length > 0 &&
                        <pre className="elements-error">{project.project.errors.join('\n')}</pre>}</div>}</article>
                </main>
            </> : <div className="elements-empty"></div>}
        <footer className="elements-status"><span>{busy ? 'Выполняется: ' : ''}{status}</span>
            <button disabled={busy} onClick={() => void run(async () => {
                await invoke('project_register_association');
                setStatus('Ассоциация .pwforge зарегистрирована для текущего exe.');
            })}>Ассоциация .pwforge
            </button>
        </footer>
    </section>;
}
