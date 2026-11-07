import {matchesShortcut} from '../../app/shortcuts';
import {message, t} from "../../i18n";
import {Alert, Badge, Box, Button, Field, Input, Select, Skeleton, Textarea} from "@chakra-ui/react";
import {invoke} from '@tauri-apps/api/core';
import type {ComponentProps} from "react";
import {useCallback, useEffect, useRef, useState} from 'react';
import {SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValueText} from "../../components/ui/select";
import type {AiPolicy, Condition, Operation, Trigger} from './aipolicy-data';
import {bytes, conditions, hex, targets} from './aipolicy-data';
import './aipolicy-editor.css';
import {availableOperations, decodeName, encodeName, layout, newCondition, newOperation} from './aipolicy-fields';
import {AiPolicyTree} from './AiPolicyTree';
import {EditorSwitch} from './EditorSwitch';
import {selectCollection} from './select-collection';

const expressionTypes = conditions.filter(type =>
    /^c_(plus|minus|multiply|divide|var|constant|history_value|local_var|room_index|player_count_in_radius|player_count_in_region)$/.test(type));
const conditionTypes = conditions.filter(type => !expressionTypes.includes(type));

function TypeSelect({label, value, options, change}: {
    label: string;
    value: string;
    options: readonly string[];
    change: (value: string) => void;
}) {
    return <Field.Root><Field.Label>{t(label)}</Field.Label><SelectRoot size="sm" lazyMount unmountOnExit minW="140px"
                                                                        collection={selectCollection(<>{!options.includes(value) &&
                                                                            <option
                                                                                value={value}>{value}</option>}{options.map(option =>
                                                                            <option key={option}
                                                                                    value={option}>{option.slice(2).replaceAll('_', ' ')}</option>)}</>)}
                                                                        value={[String(value)]}
                                                                        onValueChange={async ({value: [value]}) => change(value)}><SelectTrigger><SelectValueText/></SelectTrigger><SelectContent><Select.Context>{select => select.collection.items.map(item =>
        <SelectItem key={select.collection.getItemValue(item)}
                    item={item}>{t(select.collection.stringifyItem(item))}</SelectItem>)}</Select.Context></SelectContent></SelectRoot></Field.Root>;
}

function NumberField({label, value, kind = 'u', change}: {
    label: string;
    value: number;
    kind?: string;
    change: (value: number) => void;
}) {
    const min = kind === 'u' ? 0 : kind === 'i' ? -2147483648 : -3.4028234663852886e38;
    const max = kind === 'u' ? 4294967295 : kind === 'i' ? 2147483647 : 3.4028234663852886e38;
    const handleInputBlur: ComponentProps<typeof Input>["onBlur"] = e => {
        const field = e.currentTarget;
        if (field.checkValidity()) change(field.valueAsNumber);
        else field.value = String(value);
    };
    return <Field.Root><Field.Label>{t(label)}</Field.Label><Input size="sm" key={value} type="number"
                                                                   defaultValue={value}
                                                                   step={kind === 'f' ? 'any' : 1} min={min} max={max}
                                                                   required
                                                                   onBlur={handleInputBlur}/></Field.Root>;
}

function NameField({label, value, change}: {
    label: string;
    value: string;
    change: (value: string) => void;
}) {
    const handleInputBlur2: ComponentProps<typeof Input>["onBlur"] = e => {
        const field = e.currentTarget;
        if (field.value === decodeName(value)) return;
        try {
            change(encodeName(field.value, value.length / 2));
        } catch (error) {
            field.value = decodeName(value);
            field.setCustomValidity((error as Error).message);
            field.reportValidity();
            field.setCustomValidity('');
        }
    };
    return <Field.Root><Field.Label>{t(label)}</Field.Label><Input size="sm" key={value}
                                                                   defaultValue={decodeName(value)}
                                                                   onBlur={handleInputBlur2}/></Field.Root>;
}

function Parameters({type, value, version, change}: {
    type: string;
    value: string;
    version?: number;
    change: (value: string) => void;
}) {
    const data = bytes(value);
    const view = new DataView(data.buffer);
    return <Box className="ai-fields">
        {layout(type, version).members.map(({name, kind, offset, size}) => {
            const present = offset + size <= data.length;

            function write(update: (next: DataView) => void) {
                const next = new Uint8Array(Math.max(data.length, layout(type, version).size));
                next.set(data);
                update(new DataView(next.buffer));
                change(hex(next));
            }

            if (kind === 'b') return <EditorSwitch key={name} label={name} showLabel
                                                   checked={present && view.getUint8(offset) !== 0}
                                                   change={checked => write(next => next.setUint8(offset, Number(checked)))}/>;
            if (kind === 's') return <NameField key={name} label={name}
                                                value={present ? hex(data.subarray(offset, offset + size)) : '00'.repeat(size)}
                                                change={text => write(next => new Uint8Array(next.buffer).set(bytes(text), offset))}/>;
            const number = !present ? 0 : kind === 'f' ? view.getFloat32(offset, true) :
                kind === 'i' ? view.getInt32(offset, true) : view.getUint32(offset, true);
            const handleNumberFieldchange: ComponentProps<typeof NumberField>["change"] = n => {
                if (Object.is(n, number)) return;
                write(next => {
                    if (kind === 'f') next.setFloat32(offset, n, true);
                    else if (kind === 'i') next.setInt32(offset, n, true);
                    else next.setUint32(offset, n, true);
                });
            };
            return <NumberField key={name} label={name} kind={kind} value={number} change={handleNumberFieldchange}/>;
        })}
    </Box>;
}

function ConditionTree({node, change, expression = false, label = t("Condition")}: {
    node: Condition;
    change: (node: Condition) => void;
    expression?: boolean;
    label?: string;
}) {
    const compares = /^c_(great|less|equ)$/.test(node.type);
    return <Box className="ai-condition">
        <TypeSelect label={label} value={node.type} options={expression ? expressionTypes : conditionTypes}
                    change={type => change(newCondition(type, node))}/>
        <Parameters key={node.type} type={node.type} value={node.param} change={param => change({...node, param})}/>
        {(['left', 'right'] as const).map(side => node[side] && <ConditionTree key={side}
                                                                               label={side === 'left' ? t("Left branch") : t("Right branch")}
                                                                               node={node[side]}
                                                                               expression={expression || compares}
                                                                               change={child => change({
                                                                                   ...node,
                                                                                   [side]: child
                                                                               })}/>)}
    </Box>;
}

function ActionFields({operation, version, change}: {
    operation: Operation;
    version: number;
    change: (operation: Operation) => void;
}) {
    const {type, target} = operation;
    const handleTextareaChange: ComponentProps<typeof Textarea>["onChange"] = e => {
        const suffix = operation.text?.match(/\0+$/)?.[0] ?? '';
        change({
            ...operation,
            text: e.target.value + suffix
        });
    };
    return <>
        <Box className="ai-fields">
            <TypeSelect label={t("Action")} value={type} options={availableOperations(version)}
                        change={value => change(newOperation(value, version, operation))}/>
            <TypeSelect label={t("Target")} value={target} options={targets}
                        change={value => change({
                            ...operation, target: value,
                            occupationMask: value === 't_occupation_list' ? operation.occupationMask ?? 0 : undefined
                        })}/>
            {target === 't_occupation_list' && <NumberField label={t("Class mask")}
                                                            value={operation.occupationMask ?? 0}
                                                            change={occupationMask => change({
                                                                ...operation,
                                                                occupationMask
                                                            })}/>}
        </Box>
        {type === 'o_talk' ? <Box className="ai-fields">
            <Field.Root><Field.Label>{t("Speech")}</Field.Label><Textarea size="sm"
                                                                          value={operation.text?.replace(/\0+$/, '') ?? ''}
                                                                          onChange={handleTextareaChange}/></Field.Root>
            {version >= 17 && <NumberField label={t("Append mask")} value={operation.appendMask ?? 0}
                                           change={appendMask => change({...operation, appendMask})}/>}
        </Box> : <Parameters key={type} type={type} value={operation.param ?? ''} version={version}
                             change={param => change({...operation, param})}/>}
    </>;
}

export function AiPolicyEditor({id, index, active = true, onDirty, onSaved}: {
    id: number;
    index: number;
    active?: boolean; onDirty: (dirty: boolean) => void;
    onSaved: () => void;
}) {
    const [original, setOriginal] = useState<ArrayBuffer>();
    const [policies, setPolicies] = useState<AiPolicy[]>([]);
    const [selected, setSelected] = useState(0);
    const [selectedTrigger, setSelectedTrigger] = useState(0);
    const [changed, setChanged] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const policy = policies[selected];
    const trigger = policy?.triggers[selectedTrigger];

    const worker = useRef<Worker>(null);
    const select = useCallback((key: string) => {
        if (busy) return;
        const [policyIndex, triggerIndex] = key.split(':').map(Number);
        setSelected(policyIndex);
        setSelectedTrigger(triggerIndex);
    }, [busy]);

    useEffect(() => {
        let cancelled = false;
        const parser = new Worker(new URL('./aipolicy.worker.ts', import.meta.url), {type: 'module'});
        worker.current = parser;
        parser.onerror = event => {
            if (!cancelled) setError(event.message);
        };
        void invoke<ArrayBuffer>('ide_read_binary', {id, index}).then(raw => {
            if (cancelled) return;
            parser.onmessage = ({data}: MessageEvent<{ policies: AiPolicy[]; error?: string }>) => {
                if (data.error) setError(data.error);
                else {
                    setPolicies(data.policies);
                    setOriginal(raw);
                }
            };
            const copy = raw.slice(0);
            parser.postMessage(copy, [copy]);
        }).catch(e => {
            if (!cancelled) setError(String(e));
        });
        return () => {
            cancelled = true;
            parser.terminate();
            worker.current = null;
        };
    }, [id, index]);

    useEffect(() => onDirty(changed || busy), [onDirty, changed, busy]);

    function changeTrigger(update: (current: Trigger) => Trigger) {
        setPolicies(current => current.map((p, i) => i === selected ? {
            ...p,
            triggers: p.triggers.map((t, j) => j === selectedTrigger ? update(t) : t)
        } : p));
        setChanged(true);
    }

    function changeActions(update: (actions: Operation[]) => Operation[]) {
        changeTrigger(t => ({...t, operations: update(t.operations)}));
    }

    function moveAction(from: number, to: number) {
        changeActions(actions => {
            const next = actions.slice();
            const [action] = next.splice(from, 1);
            next.splice(to, 0, action);
            return next;
        });
    }

    useEffect(() => {
        if (!active) return;
        const handler = (event: KeyboardEvent) => {
            if (matchesShortcut(event, 'save')) {
                event.preventDefault();
                void save();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    });

    async function save() {
        if (!original || busy || !changed) return;
        setBusy(true);
        setError('');
        try {
            const encoder = worker.current;
            if (!encoder) throw Error(t("The editor is still loading."));
            const encoded = await new Promise<Uint8Array>((resolve, reject) => {
                encoder.onmessage = ({data}: MessageEvent<{ encoded: Uint8Array; error?: string }>) => {
                    if (data.error) reject(Error(data.error));
                    else resolve(data.encoded);
                };
                encoder.onerror = event => reject(Error(event.message));
                encoder.postMessage(policies);
            });
            const payload = new Uint8Array(original.byteLength + encoded.byteLength);
            payload.set(new Uint8Array(original));
            payload.set(encoded, original.byteLength);
            await invoke('ide_save_aipolicy', payload, {
                headers: {
                    'x-ide-id': String(id), 'x-ide-index': String(index), 'x-original-size': String(original.byteLength)
                }
            });
            setOriginal(encoded.slice().buffer);
            setChanged(false);
            onSaved();
        } catch (e) {
            setError(String(e));
        } finally {
            setBusy(false);
        }
    }

    if (!original) return <Box className="ai-editor" aria-busy={!error}>
        {error ? <Alert.Root status="error" size="sm"
                             role="alert"><Alert.Indicator/><Alert.Content>{message(error)}</Alert.Content></Alert.Root> : <>
            <aside className="ai-navigation" aria-label={t("Loading tree")}>
                <Skeleton height="32px"/>
                {Array.from({length: 10}, (_, i) => <Skeleton key={i} height="24px"/>)}
            </aside>
            <section className="ai-loading" role="status">
                <span>{t("Loading AI Policy…")}</span>
                <Skeleton height="36px"/>
                <Skeleton height="110px"/>
                <Skeleton height="160px"/>
            </section>
        </>}
    </Box>;

    return <Box className="ai-editor">
        <AiPolicyTree policies={policies} selected={trigger ? selected + ':' + selectedTrigger : ''} select={select}/>
        <section className="ai-workspace">
            <header className="ai-toolbar">
                <Box>
                    <strong>{policy ? "Policy " + policy.id : 'AI Policy'}</strong>
                    {trigger && <span> {t(" / Trigger ")}{trigger.id}</span>}
                    {changed && <Badge ml="2" colorPalette="orange">{t("Unsaved changes")}</Badge>}
                </Box>
                <Button size="sm" colorPalette="teal" loading={busy} onClick={() => void save()}>{t("Save")}</Button>
            </header>
            <Box className="ai-form" key={selected + ':' + selectedTrigger}>
                {error && <Alert.Root status="error" size="sm"
                                      role="alert"><Alert.Indicator/><Alert.Content>{message(error)}</Alert.Content></Alert.Root>}
                {!trigger && <p>{t("This policy has no triggers.")}</p>}
                {trigger && <fieldset className="ai-trigger" key={selected + ':' + selectedTrigger} disabled={busy}>
                    <legend>{t("Trigger ")}{trigger.id}</legend>
                    <Box className="ai-fields">
                        <NameField label={t("Name")} value={trigger.nameGBK}
                                   change={nameGBK => changeTrigger(t => ({...t, nameGBK}))}/>
                        {([['active', t("Active")], ['run', t("Called by another trigger")],
                            ['battleOnly', t("Combat only")]] as const).map(([field, label]) =>
                            <EditorSwitch key={field} label={label} checked={!!trigger[field]} showLabel
                                          change={checked => changeTrigger(t => ({...t, [field]: Number(checked)}))}/>)}
                    </Box>
                    <h3>{t("Conditions")}</h3>
                    <ConditionTree node={trigger.condition}
                                   change={condition => changeTrigger(t => ({...t, condition}))}/>
                    <h3>{t("Actions")}</h3>
                    {trigger.operations.map((operation, i) => <fieldset key={i} className="ai-action">
                        <legend>{t("Action ")}{i + 1}</legend>
                        <Box className="ai-action-buttons">
                            <Button size="sm" variant="outline" disabled={i === 0}
                                    onClick={() => moveAction(i, i - 1)}>{t("Move up")}</Button>
                            <Button size="sm" variant="outline" disabled={i === trigger.operations.length - 1}
                                    onClick={() => moveAction(i, i + 1)}>{t("Move down")}</Button>
                            <Button size="sm" variant="outline"
                                    onClick={() => changeActions(actions => actions.filter((_, j) => j !== i))}>{t("Delete")}</Button>
                        </Box>
                        <ActionFields operation={operation} version={trigger.version}
                                      change={next => changeActions(actions => actions.map((op, j) => j === i ? next : op))}/>
                    </fieldset>)}
                    <Button size="sm" variant="outline" onClick={() => changeActions(actions => [...actions,
                        newOperation('o_use_skill', trigger.version)])}>{t("Add action")}</Button>
                </fieldset>}
            </Box>
        </section>
    </Box>;
}
