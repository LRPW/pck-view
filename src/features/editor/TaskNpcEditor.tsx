import {useEffect, useMemo, useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {ColumnDivider, resizeWidth} from './ColumnDivider';
import {RecordLink} from './RecordLink';
import {useColumnWidth} from './useColumnWidth';
import './tasks.css';
import {EditorProgress, EditorSkeleton} from './EditorLoading';
import {notifications} from '../../app/notifications';

type NpcRow = { id: number; name: string; coordinates: [number, number, number] };
type NpcPack = { revision: string; rows: NpcRow[]; names_error?: string };
type Edits = Record<number, Record<number, string>>;
const axes = ['X', 'Y', 'Z'] as const;
const pageSize = 100;

export function TaskNpcEditor({id, index, active, onDirty, onSaved, openNpc}: {
    id: number; index: number; active: boolean;
    onDirty: (dirty: boolean) => void; onSaved: () => void; openNpc: (id: number) => void;
}) {
    const idColumn = useColumnWidth('task-npc.id', 110);
    const nameColumn = useColumnWidth('task-npc.name', 260);
    const xColumn = useColumnWidth('task-npc.x', 90);
    const yColumn = useColumnWidth('task-npc.y', 90);
    const zColumn = useColumnWidth('task-npc.z', 90);
    const columns = [idColumn, nameColumn, xColumn, yColumn, zColumn];
    const [pack, setPack] = useState<NpcPack>();
    const [edits, setEdits] = useState<Edits>({});
    const [query, setQuery] = useState('');
    const [page, setPage] = useState(0);
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState('');
    const changed = Object.keys(edits).length > 0;

    useEffect(() => onDirty(busy || changed), [onDirty, busy, changed]);
    useEffect(() => {
        let cancelled = false;
        void invoke<NpcPack>('tasks_open', {id, index}).then(value => {
            if (!cancelled) setPack(value);
        }).catch(reason => {
            if (!cancelled) setError(String(reason));
        }).finally(() => {
            if (!cancelled) setBusy(false);
        });
        return () => {
            cancelled = true;
        };
    }, [id, index]);

    const filtered = useMemo(() => {
        const term = query.trim().toLowerCase();
        return (pack?.rows ?? []).flatMap((npc, row) =>
            !term || String(npc.id).includes(term) || npc.name.toLowerCase().includes(term) ? [{npc, row}] : []);
    }, [pack, query]);
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));

    function edit(row: number, axis: number, value: string) {
        if (!pack || !/^-?\d*$/.test(value)) return;
        const number = Number(value);
        if (number < -32768 || number > 32767) return;
        const key = 4 + axis * 2;
        setEdits(previous => {
            const next = {...previous};
            const fields = {...next[row]};
            if (value === String(pack.rows[row].coordinates[axis])) delete fields[key];
            else fields[key] = value;
            if (Object.keys(fields).length) next[row] = fields;
            else delete next[row];
            return next;
        });
    }

    async function save() {
        if (!pack || !changed || busy) return;
        setBusy(true);
        setError('');
        try {
            const changes = Object.entries(edits).map(([row, fields]) => ({row: Number(row), fields}));
            const revision = await invoke<string>('tasks_save', {id, index, expected: pack.revision, changes});
            setPack({
                ...pack, revision, rows: pack.rows.map((npc, row) => {
                    const fields = edits[row];
                    if (!fields) return npc;
                    const [x, y, z] = npc.coordinates;
                    return {
                        ...npc,
                        coordinates: [Number(fields[4] ?? x), Number(fields[6] ?? y), Number(fields[8] ?? z)]
                    };
                })
            });
            setEdits({});
            onSaved();
        } catch (reason) {
            notifications.create({type: 'error', title: 'Не удалось сохранить NPC', description: String(reason)});
        } finally {
            setBusy(false);
        }
    }

    useEffect(() => {
        if (!active) return;
        const key = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') {
                event.preventDefault();
                void save();
            }
        };
        window.addEventListener('keydown', key);
        return () => window.removeEventListener('keydown', key);
    });

    return <section className="tasks-editor task-npc-editor">
        <header>
            <button disabled={busy || !changed} onClick={() => void save()}>Сохранить{changed ? ' *' : ''}</button>
            <input aria-label="Поиск NPC" placeholder="ID или имя NPC…" value={query}
                   onChange={event => {
                       setQuery(event.target.value);
                       setPage(0);
                   }}/>
            {busy && <EditorProgress label="Обработка task_npc.data"/>}
        </header>
        {error && <div className="ide-error" role="alert">{error}</div>}
        {pack?.names_error && <div className="task-npc-warning">Имена NPC недоступны · {pack.names_error}</div>}
        <div className="task-npc-table">
            {!pack && busy && <EditorSkeleton/>}
            <table style={{width: columns.reduce((width, [column]) => width + column, 0)}}>
                <colgroup>{columns.map(([width], i) => <col key={i} style={{width}}/>)}</colgroup>
                <thead>
                <tr>{['ID', 'Имя NPC', ...axes].map((label, i) => <th scope="col" key={label}>
                    {label}
                    <ColumnDivider label={`Ширина колонки ${label}`} onDelta={delta =>
                        columns[i][1](width => resizeWidth(width, delta, i === 0 ? 84 : 56, 640))}/>
                </th>)}</tr>
                </thead>
                <tbody>{filtered.slice(page * pageSize, (page + 1) * pageSize).map(({npc, row}) =>
                    <tr key={row} className={edits[row] ? 'modified' : undefined}>
                        <td>
                            <div className="task-record-actions">
                                <RecordLink value={String(npc.id)} label={`NPC ${npc.id}`} busy={busy} open={openNpc}
                                            npc/>
                                <code>{npc.id}</code>
                            </div>
                        </td>
                        <td className="task-npc-name" title={npc.name}>{npc.name || '—'}</td>
                        {axes.map((axis, i) => <td key={axis}>
                            <input inputMode="numeric" aria-label={`${axis} · NPC ${npc.id}`} disabled={busy}
                                   value={edits[row]?.[4 + i * 2] ?? npc.coordinates[i]}
                                   onChange={event => edit(row, i, event.target.value)}/>
                        </td>)}
                    </tr>)}</tbody>
            </table>
        </div>
        <footer className="task-npc-pages">
            <button aria-label="Предыдущая страница" disabled={page === 0} onClick={() => setPage(page - 1)}>←</button>
            <span>{page + 1} / {pages} · {filtered.length.toLocaleString()}</span>
            <button aria-label="Следующая страница" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>→
            </button>
        </footer>
    </section>;
}
