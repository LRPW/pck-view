import {EditorSwitch} from './EditorSwitch';
import {GameText, plainGameText} from './GameText';
import {RecordLink} from './RecordLink';
import {ColumnDivider, resizeWidth} from './ColumnDivider';
import {useColumnWidth} from './useColumnWidth';
import {TaskColoredTextInput} from './TaskColoredTextInput';

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
    return <input type="number" aria-label={label} value={value} disabled={disabled} min={min} max={max} step={step}
                  onChange={event => {
                      const next = Number(event.target.value);
                      if (Number.isFinite(next) && next >= min && next <= max && (step === 'any' || Number.isInteger(next))) change(next);
                  }}/>;
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
    return <div className="task-block">
        {groups.map((group, i) => {
            const updateItem = (j: number, patch: Partial<Item>) => update(i, {
                ...group, items: group.items.map((item, index) => index === j ? {...item, ...patch} : item),
            });
            return <section className="task-block-card" key={i}>
                <div className="task-block-bar">
                    <strong>Группа {i + 1}</strong>
                    <EditorSwitch label="Случайный выбор" showLabel checked={group.random} disabled={disabled}
                                  change={random => update(i, {...group, random})}/>
                    <button type="button" disabled={disabled}
                            onClick={() => save(groups.filter((_, index) => index !== i))}>Удалить группу
                    </button>
                </div>
                {!!group.items.length && <div className="task-block-scroll">
                    <table className="task-award-table"
                           style={{width: columns.reduce((total, [width]) => total + width, 48)}}>
                        <colgroup>{columns.map(([width], n) => <col key={n} style={{width}}/>)}
                            <col style={{width: 48}}/>
                        </colgroup>
                        <thead>
                        <tr>{['Предмет', 'Обычный', 'Количество', 'Вероятность', 'Срок'].map((label, n) =>
                            <th scope="col" key={label}>{label}<ColumnDivider label={`Ширина колонки ${label}`}
                                                                              onDelta={delta => columns[n][1](width => resizeWidth(width, delta, 60, 640))}/>
                            </th>)}
                            <th scope="col" aria-label="Действия"/>
                        </tr>
                        </thead>
                        <tbody>{group.items.map((item, j) => {
                            const name = names?.[item.id];
                            return <tr key={j}>
                                <td>
                                    <div className="task-npc-reference">
                                        <RecordLink label="ID предмета" value={String(item.id)} busy={disabled}
                                                    open={openItem}/>
                                        <NumberInput label={`ID предмета ${j + 1}`} value={item.id} disabled={disabled}
                                                     change={id => updateItem(j, {id})}/>
                                        {name && <span title={plainGameText(name)}><GameText text={name}/></span>}
                                    </div>
                                </td>
                                <td><EditorSwitch label={`Обычный предмет ${j + 1}`} checked={item.common}
                                                  disabled={disabled}
                                                  change={common => updateItem(j, {common})}/></td>
                                <td><NumberInput label="Количество" value={item.count} disabled={disabled} min={1}
                                                 change={count => updateItem(j, {count})}/></td>
                                <td><NumberInput label="Вероятность от 0 до 1" value={item.probability}
                                                 disabled={disabled} max={1} step="any"
                                                 change={probability => updateItem(j, {probability})}/></td>
                                <td><NumberInput label="Срок" value={item.period} disabled={disabled} min={-0x80000000}
                                                 max={0x7fffffff}
                                                 change={period => updateItem(j, {period})}/></td>
                                <td>
                                    <button type="button" aria-label={`Удалить предмет ${j + 1}`} disabled={disabled}
                                            onClick={() => update(i, {
                                                ...group,
                                                items: group.items.filter((_, index) => index !== j)
                                            })}>×
                                    </button>
                                </td>
                            </tr>;
                        })}</tbody>
                    </table>
                </div>}
                <button type="button" disabled={disabled || (compact && group.items.length >= 127)}
                        onClick={() => update(i, {
                            ...group,
                            items: [...group.items, {id: 0, common: true, count: 1, probability: 1, period: 0}]
                        })}>
                    Добавить предмет
                </button>
            </section>;
        })}
        <button type="button" disabled={disabled || groups.length >= 12}
                onClick={() => save([...groups, {random: false, items: []}])}>Добавить группу
        </button>
    </div>;
}

function TextInput({label, text, change, disabled, multiline = false}: {
    label: string; text: string; change: (value: string) => void; disabled: boolean; multiline?: boolean;
}) {
    return <div className="task-dialogue-text">
        <span>{label}</span>
        <TaskColoredTextInput label={label} text={text} change={change} disabled={disabled} multiline={multiline}/>
    </div>;
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
    return <div className="task-block">
        {!compact && <label>ID диалога<NumberInput label="ID диалога" value={talk.id} disabled={disabled}
                                                   change={id => save({...talk, id})}/></label>}
        <TextInput label="Заголовок" text={talk.title} disabled={disabled} change={title => save({...talk, title})}/>
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
            return <details key={i} className="task-block-card" open>
                <summary>Окно {window.id}</summary>
                <div className="task-block-bar">
                    <label>ID окна<NumberInput label="ID окна" value={window.id} disabled={disabled} max={maxId}
                                               change={changeId}/></label>
                    <label>Родитель<select aria-label="Родительское окно" value={window.parent} disabled={disabled}
                                           onChange={event => update(i, {
                                               ...window,
                                               parent: Number(event.target.value)
                                           })}>
                        <option value={root}>Корневое окно</option>
                        {window.parent !== root && (!ids.has(window.parent) || window.parent === window.id) &&
                            <option value={window.parent}>{window.parent}</option>}
                        {talk.windows.filter(other => other.id !== window.id).map((other, j) =>
                            <option key={j} value={other.id}>Окно {other.id}</option>)}
                    </select></label>
                    <button type="button" disabled={disabled} onClick={() => save({
                        ...talk, windows: talk.windows
                            .filter((_, index) => index !== i).map(other => ({
                                ...other,
                                parent: other.parent === window.id ? root : other.parent,
                                options: other.options.filter(option => option.target !== window.id),
                            }))
                    })}>Удалить окно
                    </button>
                </div>
                <TextInput label="Текст окна" text={window.text} multiline disabled={disabled}
                           change={text => update(i, {...window, text})}/>
                {window.options.map((option, j) => <div key={j} className="task-answer">
                    <TextInput label={`Ответ ${j + 1}`} text={option.text} disabled={disabled}
                               change={text => changeAnswer(j, {text})}/>
                    <label>ID перехода<NumberInput label="ID перехода" value={option.target} disabled={disabled}
                                                   change={target => changeAnswer(j, {target})}/></label>
                    <label>Параметр<NumberInput label="Параметр ответа" value={option.param} disabled={disabled}
                                                change={param => changeAnswer(j, {param})}/></label>
                    <button type="button" disabled={disabled} aria-label={`Удалить ответ ${j + 1}`}
                            onClick={() => update(i, {
                                ...window,
                                options: window.options.filter((_, index) => index !== j)
                            })}>×
                    </button>
                </div>)}
                <button type="button" disabled={disabled || (compact && window.options.length >= 127)}
                        onClick={() => update(i, {
                            ...window,
                            options: [...window.options, {target: 0, param: 0, text: ''}]
                        })}>Добавить ответ
                </button>
            </details>;
        })}
        <button type="button" disabled={disabled || nextId > maxId || (compact && talk.windows.length >= 127)}
                onClick={() => save({
                    ...talk,
                    windows: [...talk.windows, {id: nextId, parent: root, text: '', options: []}]
                })}>Добавить окно
        </button>
    </div>;
}
