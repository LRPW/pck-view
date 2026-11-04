import {useEffect, useMemo, useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {Tabs} from '@chakra-ui/react';
import {ColumnDivider, resizeWidth} from './ColumnDivider';
import {useColumnWidth} from './useColumnWidth';
import {RecordLink} from './RecordLink';
import {EditorSwitch} from './EditorSwitch';
import {GameText, plainGameText} from './GameText';
import {TaskAwardGroups, TaskDialogue} from './TaskBlocks';
import {TaskNameColor} from './TaskNameColor';
import {TaskColoredTextInput} from './TaskColoredTextInput';
import {EditorProgress, EditorSkeleton} from './EditorLoading';
import {notifications} from '../../app/notifications';
import './tasks.css';

type TaskRow = { id: number; name: string; name_key: number };
type TaskPack = {
    revision: string;
    rows: TaskRow[];
    npc_names?: Record<number, string>;
    item_names?: Record<number, string>
};
type TaskField = {
    key: number;
    label: string;
    section: string;
    kind: 'uint' | 'int' | 'byte' | 'short' | 'u_short' | 'bool' | 'float' | 'text' | 'fixed_text' | 'dialogue' | 'name' | 'talk_label' | 'award_groups' | 'compact_award_groups' | 'talk' | 'compact_talk';
    value: string
};
type TaskNode = { id: number; name: string; fields: TaskField[]; children: TaskNode[] };
type FieldEdits = Record<number, string>;
const pageSize = 200;

function rowName(row: TaskRow, fields?: FieldEdits) {
    return fields?.[row.name_key] ?? row.name;
}

const taskChoices: Record<string, { start: number; names: string[] }> = {
    'Тип задания': {
        start: 100, names: ['Ежедневное', 'Самосовершенствование', 'Сюжетное', 'Побочное',
            'Событие', 'Список семи убийств', 'Гильдейское', 'Деятельность', 'Легенда', 'Викторина']
    },
    'Пол': {start: 0, names: ['Любой', 'Мужской', 'Женский']},
    'Способ сдачи': {start: 0, names: ['Автоматически', 'Через NPC', 'С подтверждением']},
    'Способ выполнения': {
        start: 0, names: ['Без условия', 'Убить монстров', 'Собрать предметы', 'Поговорить с NPC',
            'Достичь места', 'Подождать', 'Ответить на вопрос', 'Мини-игра', 'Защитить NPC', 'Доставить NPC',
            'Проверить глобальную переменную', 'Покинуть место', 'Найти зону сокровищ', 'Убить игроков',
            'Превратиться', 'Достичь уровня', 'Клиентская проверка', 'Принудительная навигация', 'Проверить состояние']
    },
};

function TaskBranch({node, edits, selected, choose}: {
    node: TaskNode; edits: FieldEdits; selected: TaskNode; choose: (node: TaskNode) => void;
}) {
    return <li>
        <button type="button" aria-pressed={selected === node} onClick={() => choose(node)}>
            <code>{node.id}</code> <GameText text={edits[node.fields[0].key] ?? node.name}/>
        </button>
        {!!node.children.length && <ul>{node.children.map(child =>
            <TaskBranch key={child.fields[0].key} node={child} edits={edits} selected={selected}
                        choose={choose}/>)}</ul>}
    </li>;
}

function TaskFieldInput({field, value, disabled, change}: {
    field: TaskField; value: string; disabled: boolean; change: (value: string) => void;
}) {
    const choices = taskChoices[field.label];
    if (choices) return <select aria-label={field.label} value={value} disabled={disabled}
                                onChange={event => change(event.target.value)}>
        {!choices.names.some((_, i) => String(i + choices.start) === value) && <option value={value}>{value}</option>}
        {choices.names.map((name, i) => <option key={i}
                                                value={i + choices.start}>{i + choices.start} · {name}</option>)}
    </select>;
    if (field.kind === 'bool') return <EditorSwitch label={field.label} checked={value === '1'}
                                                    disabled={disabled}
                                                    change={checked => change(checked ? '1' : '0')}/>;
    const multiline = field.kind === 'text' || field.kind === 'dialogue';
    if (multiline || field.section.startsWith('Диалог')) return <TaskColoredTextInput label={field.label}
                                                                                      text={value} change={change}
                                                                                      disabled={disabled}
                                                                                      multiline={multiline}/>;
    if (field.kind === 'fixed_text' || field.kind === 'name' || field.kind === 'talk_label') {
        return <div className="task-formatted-input">
            <div className="task-name-input">
                {field.label === 'Название' && <TaskNameColor text={value} disabled={disabled} change={change}/>}
                <input aria-label={field.label} value={value} disabled={disabled}
                       maxLength={29} onChange={event => change(event.target.value)}/>
            </div>
            {plainGameText(value) !== value &&
                <div className="task-text-preview" aria-label={`Превью · ${field.label}`}>
                    <GameText text={value}/>
                </div>}
        </div>;
    }
    return <input aria-label={field.label} value={value} disabled={disabled}
                  inputMode={field.kind === 'float' ? 'decimal' : 'numeric'}
                  onChange={event => {
                      const next = event.target.value;
                      const signed = field.kind === 'int' || field.kind === 'short';
                      if (field.kind === 'float' || (signed ? /^-?\d*$/.test(next) : /^\d*$/.test(next))) change(next);
                  }}/>;
}

export function TasksEditor({id, index, active, onDirty, onSaved, openNpc, openItem}: {
    id: number; index: number; active: boolean; onDirty: (dirty: boolean) => void; onSaved: () => void;
    openNpc: (id: number) => void;
    openItem: (id: number) => void;
}) {
    const [width, setWidth] = useColumnWidth('tasks.list', 300);
    const [pack, setPack] = useState<TaskPack>();
    const [edits, setEdits] = useState<Record<number, FieldEdits>>({});
    const [selected, setSelected] = useState(0);
    const [root, setRoot] = useState<TaskNode>();
    const [node, setNode] = useState<TaskNode>();
    const [reading, setReading] = useState(false);
    const [query, setQuery] = useState('');
    const [page, setPage] = useState(0);
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState('');
    const changed = Object.keys(edits).length > 0;
    const task = pack?.rows[selected];

    useEffect(() => onDirty(changed || busy), [changed, busy, onDirty]);
    useEffect(() => {
        let cancelled = false;
        void invoke<TaskPack>('tasks_open', {id, index}).then(data => {
            if (!cancelled) setPack(data);
        }).catch(reason => {
            if (!cancelled) setError(String(reason));
        }).finally(() => {
            if (!cancelled) setBusy(false);
        });
        return () => {
            cancelled = true;
        };
    }, [id, index]);
    const revision = pack?.revision;
    useEffect(() => {
        if (!revision) return;
        let cancelled = false;
        setRoot(undefined);
        setNode(undefined);
        setReading(true);
        void invoke<TaskNode>('tasks_detail', {id, index, row: selected, expected: revision}).then(data => {
            if (!cancelled) {
                setRoot(data);
                setNode(data);
            }
        }).catch(reason => {
            if (!cancelled) setError(String(reason));
        }).finally(() => {
            if (!cancelled) setReading(false);
        });
        return () => {
            cancelled = true;
        };
    }, [id, index, selected, revision]);

    const matches = useMemo(() => {
        const term = query.trim().toLowerCase();
        const found: number[] = [];
        pack?.rows.forEach((row, i) => {
            if (!term || String(row.id).includes(term) || plainGameText(rowName(row, edits[i])).toLowerCase().includes(term)) found.push(i);
        });
        return found;
    }, [pack, edits, query]);
    const pages = Math.max(1, Math.ceil(matches.length / pageSize));
    const currentPage = Math.min(page, pages - 1);

    function update(field: TaskField, value: string) {
        setEdits(old => {
            const next = {...old};
            const fields = {...next[selected]};
            if (value === field.value) delete fields[field.key];
            else fields[field.key] = value;
            if (Object.keys(fields).length) next[selected] = fields;
            else delete next[selected];
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
                ...pack,
                revision,
                rows: pack.rows.map((row, i) => edits[i] ? {...row, name: rowName(row, edits[i])} : row)
            });
            setEdits({});
            onSaved();
        } catch (reason) {
            notifications.create({type: 'error', title: 'Не удалось сохранить задания', description: String(reason)});
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

    const fields = edits[selected] ?? {};
    const sections = [...new Set(node?.fields.map(field => field.section))];
    return <section className="tasks-editor">
        <header>
            <button disabled={busy || !changed} onClick={() => void save()}>Сохранить{changed ? ' *' : ''}</button>
            {(busy || reading) && <EditorProgress label={reading ? 'Чтение задания' : 'Обработка пакета заданий'}/>}
        </header>
        {error && <div className="ide-error" role="alert">{error}</div>}
        <div className="tasks-workspace">
            <aside style={{width}}>
                <input aria-label="Поиск задания" placeholder="ID или название…" value={query}
                       onChange={event => {
                           setQuery(event.target.value);
                           setPage(0);
                       }}/>
                <nav aria-label="Задания">
                    {!pack && busy && <EditorSkeleton/>}
                    {matches.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(i => {
                        const row = pack!.rows[i];
                        return <button key={i} aria-pressed={selected === i} disabled={busy} onClick={() => {
                            if (i !== selected) {
                                setNode(undefined);
                                setRoot(undefined);
                                setError('');
                                setSelected(i);
                            }
                        }}>
                            <code>{row.id}</code><span><GameText text={rowName(row, edits[i])}/></span>
                        </button>;
                    })}
                </nav>
                <footer>
                    <button aria-label="Предыдущая страница" disabled={currentPage === 0}
                            onClick={() => setPage(currentPage - 1)}>←
                    </button>
                    <span>{currentPage + 1} / {pages} · {matches.length.toLocaleString()}</span>
                    <button aria-label="Следующая страница" disabled={currentPage + 1 >= pages}
                            onClick={() => setPage(currentPage + 1)}>→
                    </button>
                </footer>
            </aside>
            <ColumnDivider label="Ширина списка заданий"
                           onDelta={delta => setWidth(value => resizeWidth(value, delta, 140, 560))}/>
            {reading && <article><EditorSkeleton/></article>}
            {task && node && root && <article>
                <strong>#{node.id} · <GameText text={fields[node.fields[0].key] ?? node.name}/></strong>
                {!!root.children.length && <details className="task-tree" open>
                    <summary>Дерево задания</summary>
                    <ul><TaskBranch node={root} edits={fields} selected={node} choose={setNode}/></ul>
                </details>}
                <Tabs.Root key={node.fields[0].key} defaultValue={sections[0]} size="sm" colorPalette="teal">
                    <Tabs.List className="task-sections" aria-label="Параметры задания">
                        {sections.map(section => <Tabs.Trigger key={section} value={section}>{section}</Tabs.Trigger>)}
                    </Tabs.List>
                    {sections.map(section => <Tabs.Content key={section} value={section}>
                        {node.fields.filter(field => field.section === section).map(field => {
                            const value = fields[field.key] ?? field.value;
                            const compact = field.kind === 'compact_award_groups' || field.kind === 'compact_talk';
                            const structured = field.kind === 'award_groups' || field.kind === 'compact_award_groups'
                                ? <TaskAwardGroups value={value} change={next => update(field, next)} disabled={busy}
                                                   compact={compact} names={pack?.item_names} openItem={openItem}/>
                                : field.kind === 'talk' || field.kind === 'compact_talk'
                                    ? <TaskDialogue value={value} change={next => update(field, next)} disabled={busy}
                                                    compact={compact}/>
                                    : undefined;
                            if (structured) return <div key={field.key} className="task-structured-field">
                                {fields[field.key] !== undefined && <button type="button" disabled={busy}
                                                                            onClick={() => update(field, field.value)}>Отменить
                                    правки блока</button>}
                                {structured}
                            </div>;
                            const npc = field.label === 'ID NPC выдачи' || field.label === 'ID NPC награды';
                            const item = /ID (?:выпадающего )?предмета$/.test(field.label);
                            const name = npc ? pack?.npc_names?.[Number(value)] : item ? pack?.item_names?.[Number(value)] : undefined;
                            const input = <TaskFieldInput field={field} value={value} disabled={busy}
                                                          change={next => update(field, next)}/>;
                            return <div className="task-field" key={field.key}>
                                <span>{field.label}</span>
                                {npc || item ? <div className="task-npc-reference">
                                    <RecordLink value={value} label={field.label} busy={busy}
                                                open={npc ? openNpc : openItem} npc={npc}/>
                                    {input}
                                    {name && <span title={plainGameText(name)}><GameText text={name}/></span>}
                                </div> : input}
                                <div className="task-record-actions">
                                    {fields[field.key] !== undefined && <button type="button" disabled={busy}
                                                                                aria-label={`Отменить правку · ${field.label}`}
                                                                                onClick={() => update(field, field.value)}>↶</button>}
                                </div>
                            </div>;
                        })}
                    </Tabs.Content>)}
                </Tabs.Root>
            </article>}
        </div>
    </section>;
}
