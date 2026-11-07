import {t} from "../../i18n";
import {Box, Button, Field, Input, Select} from "@chakra-ui/react";
import type {ComponentProps} from "react";
import {AccordionItem, AccordionItemContent, AccordionItemTrigger, AccordionRoot} from "../../components/ui/accordion";
import {SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValueText} from "../../components/ui/select";
import {ColumnDivider, resizeWidth} from './ColumnDivider';
import {EditorSwitch} from './EditorSwitch';
import {GameText, plainGameText} from './GameText';
import {RecordLink} from './RecordLink';
import {selectCollection} from './select-collection';
import {TaskColoredTextInput} from './TaskColoredTextInput';
import {useColumnWidth} from './useColumnWidth';

type Item = { id: number; common: boolean; count: number; probability: number; period: number };
type Group = { random: boolean; items: Item[] };
type Answer = { target: number; param: number; text: string };
type Window = { id: number; parent: number; text: string; options: Answer[] };
type Talk = { id: number; title: string; windows: Window[] };
type Props = { value: string; change: (value: string) => void; disabled: boolean; compact: boolean };

function NumberInput({label, value, change, disabled, min = 0, max = 0xffffffff, step = 1}: {
    label: string; value: number; change: (value: number) => void; disabled: boolean;
    min?: number; max?: number; step?: number | 'any';
}) {
    const handleInputChange: ComponentProps<typeof Input>["onChange"] = event => {
        const next = Number(event.target.value);
        if (Number.isFinite(next) && next >= min && next <= max && (step === 'any' || Number.isInteger(next))) change(next);
    };
    return <Field.Root width="auto"><Input type="number" aria-label={label} value={value} disabled={disabled} min={min}
                                           max={max} step={step}
                                           onChange={handleInputChange}/></Field.Root>;
}

export function TaskAwardGroups({value, change, disabled, compact, names, openItem}: Props & {
    names?: Record<number, string>; openItem: (id: number) => void;
}) {
    const idColumn = useColumnWidth('tasks.award.id', 290);
    const commonColumn = useColumnWidth('tasks.award.common', 130);
    const countColumn = useColumnWidth('tasks.award.count', 100);
    const probabilityColumn = useColumnWidth('tasks.award.probability', 120);
    const periodColumn = useColumnWidth('tasks.award.period', 100);
    const columns = [idColumn, commonColumn, countColumn, probabilityColumn, periodColumn];
    const groups: Group[] = JSON.parse(value);
    const save = (next: Group[]) => change(JSON.stringify(next));
    const update = (i: number, next: Group) => save(groups.map((group, index) => index === i ? next : group));
    return <Box className="task-block">
        {groups.map((group, i) => {
            const updateItem = (j: number, patch: Partial<Item>) => update(i, {
                ...group, items: group.items.map((item, index) => index === j ? {...item, ...patch} : item),
            });
            return <section className="task-block-card" key={i}>
                <Box className="task-block-bar">
                    <strong>{t("Group ")}{i + 1}</strong>
                    <EditorSwitch label={t("Random choice")} showLabel checked={group.random} disabled={disabled}
                                  change={random => update(i, {...group, random})}/>
                    <Button type="button" disabled={disabled}
                            onClick={() => save(groups.filter((_, index) => index !== i))}>{t("Delete group")}</Button>
                </Box>
                {!!group.items.length && <Box className="task-block-scroll">
                    <table className="task-award-table"
                           style={{width: columns.reduce((total, [width]) => total + width, 48)}}>
                        <colgroup>{columns.map(([width], n) => <col key={n} style={{width}}/>)}
                            <col style={{width: 48}}/>
                        </colgroup>
                        <thead>
                        <tr>{[t("Item"), t("Regular"), t("Quantity"), t("Probability"), t("Duration")].map((label, n) =>
                            <th scope="col" key={label}>{label}<ColumnDivider
                                label={t("Column width: {value0}", {value0: label})}
                                onDelta={delta => columns[n][1](width => resizeWidth(width, delta, 60, 640))}/>
                            </th>)}
                            <th scope="col" aria-label={t("Actions")}/>
                        </tr>
                        </thead>
                        <tbody>{group.items.map((item, j) => {
                            const name = names?.[item.id];
                            return <tr key={j}>
                                <td>
                                    <Box className="task-npc-reference">
                                        <RecordLink label={t("Item ID")} value={String(item.id)} busy={disabled}
                                                    open={openItem}/>
                                        <NumberInput label={t("Item ID {value0}", {value0: j + 1})} value={item.id}
                                                     disabled={disabled}
                                                     change={id => updateItem(j, {id})}/>
                                        {name && <span title={plainGameText(name)}><GameText text={name}/></span>}
                                    </Box>
                                </td>
                                <td><EditorSwitch label={t("Common item {value0}", {value0: j + 1})}
                                                  checked={item.common}
                                                  disabled={disabled}
                                                  change={common => updateItem(j, {common})}/></td>
                                <td><NumberInput label={t("Quantity")} value={item.count} disabled={disabled} min={1}
                                                 change={count => updateItem(j, {count})}/></td>
                                <td><NumberInput label={t("Probability from 0 to 1")} value={item.probability}
                                                 disabled={disabled} max={1} step="any"
                                                 change={probability => updateItem(j, {probability})}/></td>
                                <td><NumberInput label={t("Duration")} value={item.period} disabled={disabled}
                                                 min={-0x80000000}
                                                 max={0x7fffffff}
                                                 change={period => updateItem(j, {period})}/></td>
                                <td>
                                    <Button type="button" aria-label={t("Delete item {value0}", {value0: j + 1})}
                                            disabled={disabled}
                                            onClick={() => update(i, {
                                                ...group,
                                                items: group.items.filter((_, index) => index !== j)
                                            })}>×
                                    </Button>
                                </td>
                            </tr>;
                        })}</tbody>
                    </table>
                </Box>}
                <Button type="button" disabled={disabled || (compact && group.items.length >= 127)}
                        onClick={() => update(i, {
                            ...group,
                            items: [...group.items, {id: 0, common: true, count: 1, probability: 1, period: 0}]
                        })}>
                    {t("Add item")}</Button>
            </section>;
        })}
        <Button type="button" disabled={disabled || groups.length >= 12}
                onClick={() => save([...groups, {random: false, items: []}])}>{t("Add group")}</Button>
    </Box>;
}

function TextInput({label, text, change, disabled, multiline = false}: {
    label: string; text: string; change: (value: string) => void; disabled: boolean; multiline?: boolean;
}) {
    return <Box className="task-dialogue-text">
        <span>{label}</span>
        <TaskColoredTextInput label={label} text={text} change={change} disabled={disabled} multiline={multiline}/>
    </Box>;
}

export function TaskDialogue({value, change, disabled, compact}: Props) {
    const talk: Talk = JSON.parse(value);
    const root = compact ? 255 : 0xffffffff;
    const maxId = compact ? 127 : 0x7fffffff;
    let nextId = 0;
    const ids = new Set(talk.windows.map(window => window.id));
    while (ids.has(nextId)) nextId++;
    const save = (next: Talk) => change(JSON.stringify(next));
    const update = (i: number, next: Window) => save({
        ...talk,
        windows: talk.windows.map((window, index) => index === i ? next : window)
    });
    const handleNumberInputchange: ComponentProps<typeof NumberInput>["change"] = id => save({
        ...talk,
        id
    });
    return <Box className="task-block">
        {!compact &&
            <Field.Root width="auto"><Field.Label>{t("Dialogue ID")}</Field.Label><NumberInput label={t("Dialogue ID")}
                                                                                               value={talk.id}
                                                                                               disabled={disabled}
                                                                                               change={handleNumberInputchange}/></Field.Root>}
        <TextInput label={t("Title")} text={talk.title} disabled={disabled} change={title => save({...talk, title})}/>
        {talk.windows.map((window, i) => {
            const changeId = (id: number) => {
                if (id !== window.id && !ids.has(id)) save({
                    ...talk, windows: talk.windows.map((other, index) => ({
                        ...other, id: index === i ? id : other.id,
                        parent: other.parent === window.id ? id : other.parent,
                        options: other.options.map(option => option.target === window.id ? {
                            ...option,
                            target: id
                        } : option),
                    }))
                });
            };
            const changeAnswer = (j: number, patch: Partial<Answer>) => update(i, {
                ...window, options: window.options.map((option, index) => index === j ? {...option, ...patch} : option),
            });
            const handleSelectRootValueChange: ComponentProps<typeof Select.Root>["onValueChange"] = async ({value: [value]}) => update(i, {
                ...window,
                parent: Number(value)
            });
            const handleButtonClick: ComponentProps<typeof Button>["onClick"] = () => save({
                ...talk, windows: talk.windows
                    .filter((_, index) => index !== i).map(other => ({
                        ...other,
                        parent: other.parent === window.id ? root : other.parent,
                        options: other.options.filter(option => option.target !== window.id),
                    }))
            });
            return <AccordionRoot collapsible defaultValue={true ? ["content"] : []} key={i}
                                  className="task-block-card"><AccordionItem
                value="content"><AccordionItemTrigger>{t("Window ")}{window.id}</AccordionItemTrigger><AccordionItemContent><Box
                className="task-block-bar">
                <Field.Root width="auto"><Field.Label>{t("Window ID")}</Field.Label><NumberInput label={t("Window ID")}
                                                                                                 value={window.id}
                                                                                                 disabled={disabled}
                                                                                                 max={maxId}
                                                                                                 change={changeId}/></Field.Root>
                <Field.Root width="auto"><Field.Label>{t("Parent")}</Field.Label><SelectRoot size="sm" lazyMount
                                                                                             unmountOnExit minW="140px"
                                                                                             collection={selectCollection(<>
                                                                                                 <option
                                                                                                     value={root}>{t("Root window")}</option>
                                                                                                 {window.parent !== root && (!ids.has(window.parent) || window.parent === window.id) &&
                                                                                                     <option
                                                                                                         value={window.parent}>{window.parent}</option>}{talk.windows.filter(other => other.id !== window.id).map((other, j) =>
                                                                                                 <option key={j}
                                                                                                         value={other.id}>{t("Window ")}{other.id}</option>)}</>)}
                                                                                             value={[String(window.parent)]}
                                                                                             onValueChange={handleSelectRootValueChange}
                                                                                             aria-label={t("Parent window")}
                                                                                             disabled={disabled}><SelectTrigger><SelectValueText/></SelectTrigger><SelectContent><Select.Context>{select => select.collection.items.map(item =>
                    <SelectItem key={select.collection.getItemValue(item)}
                                item={item}>{t(select.collection.stringifyItem(item))}</SelectItem>)}</Select.Context></SelectContent></SelectRoot></Field.Root>
                <Button type="button" disabled={disabled} onClick={handleButtonClick}>{t("Delete window")}</Button>
            </Box><TextInput label={t("Window text")} text={window.text} multiline disabled={disabled}
                             change={text => update(i, {...window, text})}/>{window.options.map((option, j) => <Box
                key={j} className="task-answer">
                <TextInput label={t("Response {value0}", {value0: j + 1})} text={option.text} disabled={disabled}
                           change={text => changeAnswer(j, {text})}/>
                <Field.Root width="auto"><Field.Label>{t("Transition ID")}</Field.Label><NumberInput
                    label={t("Transition ID")}
                    value={option.target}
                    disabled={disabled}
                    change={target => changeAnswer(j, {target})}/></Field.Root>
                <Field.Root width="auto"><Field.Label>{t("Parameter")}</Field.Label><NumberInput
                    label={t("Response parameter")}
                    value={option.param}
                    disabled={disabled}
                    change={param => changeAnswer(j, {param})}/></Field.Root>
                <Button type="button" disabled={disabled} aria-label={t("Delete response {value0}", {value0: j + 1})}
                        onClick={() => update(i, {
                            ...window,
                            options: window.options.filter((_, index) => index !== j)
                        })}>×
                </Button>
            </Box>)}<Button type="button" disabled={disabled || (compact && window.options.length >= 127)}
                            onClick={() => update(i, {
                                ...window,
                                options: [...window.options, {target: 0, param: 0, text: ''}]
                            })}>{t("Add response")}</Button></AccordionItemContent></AccordionItem></AccordionRoot>;
        })}
        <Button type="button" disabled={disabled || nextId > maxId || (compact && talk.windows.length >= 127)}
                onClick={() => save({
                    ...talk,
                    windows: [...talk.windows, {id: nextId, parent: root, text: '', options: []}]
                })}>{t("Add window")}</Button>
    </Box>;
}
