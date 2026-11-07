import {matchesShortcut} from '../../app/shortcuts';
import {message, sourceText, t} from "../../i18n";
import {Alert, Box, Button, Field, Input, Select, Tabs} from "@chakra-ui/react";
import {invoke} from '@tauri-apps/api/core';
import type {ComponentProps} from "react";
import {useEffect, useMemo, useState} from 'react';
import {notifications} from '../../app/notifications';
import {AccordionItem, AccordionItemContent, AccordionItemTrigger, AccordionRoot} from "../../components/ui/accordion";
import {SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValueText} from "../../components/ui/select";
import {ColumnDivider, resizeWidth} from './ColumnDivider';
import {EditorProgress, EditorSkeleton} from './EditorLoading';
import {EditorSwitch} from './EditorSwitch';
import {GameText, plainGameText} from './GameText';
import {RecordLink} from './RecordLink';
import {selectCollection} from './select-collection';
import {TaskAwardGroups, TaskDialogue} from './TaskBlocks';
import {TaskColoredTextInput} from './TaskColoredTextInput';
import {TaskNameColor} from './TaskNameColor';
import './tasks.css';
import {useColumnWidth} from './useColumnWidth';

type TaskRow = { id: number; name: string; name_key: number };
type TaskPack = {
    version: number;
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
    "Quest type": {
        start: 100, names: ["Daily", "Cultivation", "Story", "Side quest",
            "Event", "Seven Kill List", "Faction", "Activity", "Legend", "Quiz"]
    },
    "Gender": {start: 0, names: ["Any", "Male", "Female"]},
    "Turn-in method": {start: 0, names: ["Automatic", "Through an NPC", "With confirmation"]},
    "Completion method": {
        start: 0, names: ["No condition", "Kill monsters", "Collect items", "Talk to an NPC",
            "Reach a location", "Wait", "Answer a question", "Mini-game", "Protect an NPC", "Escort an NPC",
            "Check a global variable", "Leave a location", "Find a treasure area", "Kill players",
            "Transform", "Reach a level", "Client check", "Forced navigation", "Check a state"]
    },
};

function TaskBranch({node, edits, selected, choose}: {
    node: TaskNode; edits: FieldEdits; selected: TaskNode; choose: (node: TaskNode) => void;
}) {
    return <li>
        <Button type="button" aria-pressed={selected === node} onClick={() => choose(node)}>
            <code>{node.id}</code> <GameText text={edits[node.fields[0].key] ?? node.name}/>
        </Button>
        {!!node.children.length && <ul>{node.children.map(child =>
            <TaskBranch key={child.fields[0].key} node={child} edits={edits} selected={selected}
                        choose={choose}/>)}</ul>}
    </li>;
}

function TaskFieldInput({field, value, disabled, change}: {
    field: TaskField; value: string; disabled: boolean; change: (value: string) => void;
}) {
    const choices = taskChoices[sourceText(field.label)];
    if (choices) return <SelectRoot size="sm" lazyMount unmountOnExit minW="140px"
                                    collection={selectCollection(<>{!choices.names.some((_, i) => String(i + choices.start) === value) &&
                                        <option value={value}>{value}</option>}{choices.names.map((name, i) => <option
                                        key={i}
                                        value={i + choices.start}>{i + choices.start} · {name}</option>)}</>)}
                                    value={[String(value)]} onValueChange={async ({value: [value]}) => change(value)}
                                    aria-label={field.label}
                                    disabled={disabled}><SelectTrigger><SelectValueText/></SelectTrigger><SelectContent><Select.Context>{select => select.collection.items.map(item =>
        <SelectItem key={select.collection.getItemValue(item)}
                    item={item}>{t(select.collection.stringifyItem(item))}</SelectItem>)}</Select.Context></SelectContent></SelectRoot>;
    if (field.kind === 'bool') return <EditorSwitch label={field.label} checked={value === '1'}
                                                    disabled={disabled}
                                                    change={checked => change(checked ? '1' : '0')}/>;
    const multiline = field.kind === 'text' || field.kind === 'dialogue';
    if (multiline || sourceText(field.section).startsWith("Dialogue")) return <TaskColoredTextInput label={field.label}
                                                                                                    text={value}
                                                                                                    change={change}
                                                                                                    disabled={disabled}
                                                                                                    multiline={multiline}/>;
    if (field.kind === 'fixed_text' || field.kind === 'name' || field.kind === 'talk_label') {
        return <Box className="task-formatted-input">
            <Box className="task-name-input">
                {sourceText(field.label) === "Name" &&
                    <TaskNameColor text={value} disabled={disabled} change={change}/>}
                <Field.Root width="auto"><Input aria-label={field.label} value={value} disabled={disabled}
                                                maxLength={29}
                                                onChange={event => change(event.target.value)}/></Field.Root>
            </Box>
            {plainGameText(value) !== value &&
                <Box className="task-text-preview" aria-label={t("Preview · {value0}", {value0: field.label})}>
                    <GameText text={value}/>
                </Box>}
        </Box>;
    }
    const handleInputChange: ComponentProps<typeof Input>["onChange"] = event => {
        const next = event.target.value;
        const signed = field.kind === 'int' || field.kind === 'short';
        if (field.kind === 'float' || (signed ? /^-?\d*$/.test(next) : /^\d*$/.test(next))) change(next);
    };
    return <Field.Root width="auto"><Input aria-label={field.label} value={value} disabled={disabled}
                                           inputMode={field.kind === 'float' ? 'decimal' : 'numeric'}
                                           onChange={handleInputChange}/></Field.Root>;
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
            notifications.create({type: 'error', title: t("Failed to save quests"), description: String(reason)});
        } finally {
            setBusy(false);
        }
    }

    useEffect(() => {
        if (!active) return;
        const key = (event: KeyboardEvent) => {
            if (matchesShortcut(event, 'save')) {
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
            <Button disabled={busy || !changed} onClick={() => void save()}>{t("Save")}{changed ? ' *' : ''}</Button>
            {pack && <span>v{pack.version}</span>}
            {(busy || reading) && <EditorProgress label={reading ? t("Reading quest") : t("Processing quest pack")}/>}
        </header>
        {error && <Alert.Root status="error" size="sm"
                              role="alert"><Alert.Indicator/><Alert.Content>{message(error)}</Alert.Content></Alert.Root>}
        <Box className="tasks-workspace">
            <aside style={{width}}>
                <Field.Root width="auto"><Input aria-label={t("Find quest")} placeholder={t("ID or name…")}
                                                value={query}
                                                onChange={event => {
                                                    setQuery(event.target.value);
                                                    setPage(0);
                                                }}/></Field.Root>
                <nav aria-label={t("Quests")}>
                    {!pack && busy && <EditorSkeleton/>}
                    {matches.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(i => {
                        const row = pack!.rows[i];
                        const handleButtonClick: ComponentProps<typeof Button>["onClick"] = () => {
                            if (i !== selected) {
                                setNode(undefined);
                                setRoot(undefined);
                                setError('');
                                setSelected(i);
                            }
                        };
                        return <Button key={i} aria-pressed={selected === i} disabled={busy}
                                       onClick={handleButtonClick}>
                            <code>{row.id}</code><span><GameText text={rowName(row, edits[i])}/></span>
                        </Button>;
                    })}
                </nav>
                <footer>
                    <Button aria-label={t("Previous page")} disabled={currentPage === 0}
                            onClick={() => setPage(currentPage - 1)}>←
                    </Button>
                    <span>{currentPage + 1} / {pages} · {matches.length.toLocaleString()}</span>
                    <Button aria-label={t("Next page")} disabled={currentPage + 1 >= pages}
                            onClick={() => setPage(currentPage + 1)}>→
                    </Button>
                </footer>
            </aside>
            <ColumnDivider label={t("Quest list width")}
                           onDelta={delta => setWidth(value => resizeWidth(value, delta, 140, 560))}/>
            {reading && <article><EditorSkeleton/></article>}
            {task && node && root && <article>
                <strong>#{node.id} · <GameText text={fields[node.fields[0].key] ?? node.name}/></strong>
                {!!root.children.length && <AccordionRoot collapsible defaultValue={true ? ["content"] : []}
                                                          className="task-tree"><AccordionItem
                    value="content"><AccordionItemTrigger>{t("Quest tree")}</AccordionItemTrigger><AccordionItemContent>
                    <ul><TaskBranch node={root} edits={fields} selected={node} choose={setNode}/></ul>
                </AccordionItemContent></AccordionItem></AccordionRoot>}
                <Tabs.Root key={node.fields[0].key} defaultValue={sections[0]} size="sm" colorPalette="teal">
                    <Tabs.List className="task-sections" aria-label={t("Quest properties")}>
                        {sections.map(section => <Tabs.Trigger key={section}
                                                               value={section}>{message(section)}</Tabs.Trigger>)}
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
                            if (structured) return <Box key={field.key} className="task-structured-field">
                                {fields[field.key] !== undefined && <Button type="button" disabled={busy}
                                                                            onClick={() => update(field, field.value)}>{t("Revert block changes")}</Button>}
                                {structured}
                            </Box>;
                            const npc = sourceText(field.label) === "Quest giver NPC ID" || sourceText(field.label) === "Reward NPC ID";
                            const item = /item ID$/i.test(sourceText(field.label));
                            const name = npc ? pack?.npc_names?.[Number(value)] : item ? pack?.item_names?.[Number(value)] : undefined;
                            const input = <TaskFieldInput field={field} value={value} disabled={busy}
                                                          change={next => update(field, next)}/>;
                            return <Box className="task-field" key={field.key}>
                                <span>{t(field.label)}</span>
                                {npc || item ? <Box className="task-npc-reference">
                                    <RecordLink value={value} label={field.label} busy={busy}
                                                open={npc ? openNpc : openItem} npc={npc}/>
                                    {input}
                                    {name && <span title={plainGameText(name)}><GameText text={name}/></span>}
                                </Box> : input}
                                <Box className="task-record-actions">
                                    {fields[field.key] !== undefined && <Button type="button" disabled={busy}
                                                                                aria-label={t("Revert field · {value0}", {value0: field.label})}
                                                                                onClick={() => update(field, field.value)}>↶</Button>}
                                </Box>
                            </Box>;
                        })}
                    </Tabs.Content>)}
                </Tabs.Root>
            </article>}
        </Box>
    </section>;
}
