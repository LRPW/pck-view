import {matchesShortcut} from '../../app/shortcuts';
import {message, t} from "../../i18n";
import {Alert, Box, Button, Field, Flex, Heading, Input, Select, Skeleton, Stack, Text} from '@chakra-ui/react';
import {invoke} from '@tauri-apps/api/core';
import type {ComponentProps} from "react";
import {useEffect, useRef, useState} from 'react';
import {SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValueText} from "../../components/ui/select";
import {bytes, hex} from './aipolicy-data';
import {decodeName, encodeName} from './aipolicy-fields';
import {EditorSwitch} from './EditorSwitch';
import {selectCollection} from './select-collection';
import {type Field as RecordField, type Format, type Group, readServerRecords} from './server-records';

const descriptions: Record<Format, string> = {
    'extra_drops.sev': "Additional monster drop tables",
    'npcgen.data': "Spawn areas, resources, dynamic objects and controllers",
    'path.sev': "Bezier paths for NPC movement",
    'wmgj.nmd': "Convex collision hull bindings for templates",
};

function readField(view: DataView, offset: number, kind: RecordField['kind']) {
    switch (kind) {
        case 'i':
            return view.getInt32(offset, true);
        case 'u':
            return view.getUint32(offset, true);
        case 'f':
            return view.getFloat32(offset, true);
        case 's':
            return decodeName(hex(new Uint8Array(view.buffer, offset, 128)));
        case 'b':
        case 'y':
            return view.getUint8(offset);
    }
}

function Cell({field, value, update, fail}: {
    field: RecordField;
    value: number | string;
    update: (value: number | string) => void;
    fail: (message: string) => void;
}) {
    const {kind, name} = field;
    if (kind === 'b') return <EditorSwitch label={name} showLabel checked={!!value}
                                           change={checked => update(Number(checked))}/>;
    const min = field.min ?? (kind === 'i' ? -2147483648 : kind === 'f' ? -3.4028234663852886e38 : 0);
    const max = field.max ?? (kind === 'i' ? 2147483647 : kind === 'f' ? 3.4028234663852886e38 :
        kind === 'y' ? 255 : 4294967295);
    const handleInputBlur: ComponentProps<typeof Input>["onBlur"] = e => {
        const input = e.currentTarget;
        if (input.value === String(value)) return;
        try {
            if (!input.checkValidity()) throw Error("Check the value of field “" + name + '».');
            const next = kind === 's' ? encodeName(input.value, 128) : input.valueAsNumber;
            update(next);
        } catch (error) {
            input.value = String(value);
            fail(String(error));
        }
    };
    return <Field.Root width="auto" minW="144px">
        <Field.Label>{t(name)}</Field.Label>
        <Input key={value} size="sm" type={kind === 's' ? 'text' : 'number'} defaultValue={value}
               min={min} max={max} step={kind === 'f' ? 'any' : 1} required={kind !== 's'}
               onBlur={handleInputBlur}/>
    </Field.Root>;
}

function RecordNumber({index, count, change, label}: {
    index: number; count: number; change: (index: number) => void; label: string;
}) {
    return <Flex gap="1" align="center">
        <Button size="xs" variant="outline" aria-label={"Previous record: " + label}
                disabled={index === 0} onClick={() => change(index - 1)}>‹</Button>
        <Field.Root width="auto"><Input size="xs" width="6em" type="number" aria-label={label} key={index}
                                        defaultValue={index + 1}
                                        min={1} max={count} step={1} required onBlur={e => {
            const input = e.currentTarget;
            if (input.checkValidity()) change(input.valueAsNumber - 1);
            else input.value = String(index + 1);
        }} onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur();
        }}/></Field.Root>
        <Text fontSize="xs" whiteSpace="nowrap">{t("of ")}{count.toLocaleString()}</Text>
        <Button size="xs" variant="outline" aria-label={"Next record: " + label}
                disabled={index + 1 >= count} onClick={() => change(index + 1)}>›</Button>
    </Flex>;
}

export function ServerRecordsEditor({id, index, format, active = true, onDirty, onSaved}: {
    id: number; index: number; format: Format;
    active?: boolean; onDirty: (dirty: boolean) => void; onSaved: () => void;
}) {
    const original = useRef<ArrayBuffer>(null);
    const draft = useRef<ArrayBuffer>(null);
    const [groups, setGroups] = useState<Group[]>();
    const [groupIndex, setGroupIndex] = useState(0);
    const [recordIndex, setRecordIndex] = useState(0);
    const [blockRows, setBlockRows] = useState<Record<number, number>>({});
    const [revision, setRevision] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [searchId, setSearchId] = useState('');
    const group = groups?.[groupIndex];
    const record = group?.records[recordIndex];

    useEffect(() => {
        let alive = true;
        void invoke<ArrayBuffer>('ide_read_binary', {id, index}).then(raw => {
            if (!alive) return;
            setGroups(readServerRecords(format, new Uint8Array(raw)));
            original.current = raw;
        }).catch(error => {
            if (alive) setError(String(error));
        });
        return () => {
            alive = false;
        };
    }, [id, index, format]);

    useEffect(() => onDirty(revision > 0 || busy), [revision, busy, onDirty]);

    function choose(next: number) {
        setRecordIndex(next);
        setBlockRows({});
    }

    function update(field: RecordField, offset: number, value: number | string) {
        if (!original.current) return;
        const buffer = draft.current ?? original.current.slice(0);
        const view = new DataView(buffer);
        if (typeof value === 'string') new Uint8Array(buffer, offset, 128).set(bytes(value));
        else if (field.kind === 'i') view.setInt32(offset, value, true);
        else if (field.kind === 'u') view.setUint32(offset, value, true);
        else if (field.kind === 'f') view.setFloat32(offset, value, true);
        else view.setUint8(offset, value);
        draft.current = buffer;
        setRevision(value => value + 1);
        setError('');
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
        const previous = original.current, next = draft.current;
        if (!previous || !next || busy) return;
        setBusy(true);
        setError('');
        try {
            if (format === 'path.sev' || format === 'wmgj.nmd') {
                const view = new DataView(next);
                for (const group of groups ?? []) {
                    const ids = new Set<number>();
                    for (const {idOffset} of group.records) {
                        if (idOffset === undefined) continue;
                        const key = view.getInt32(idOffset, true);
                        if (ids.has(key)) throw Error("Duplicate ID " + key + " in section “" + group.label + '».');
                        ids.add(key);
                    }
                }
            }
            const payload = new Uint8Array(previous.byteLength + next.byteLength);
            payload.set(new Uint8Array(previous));
            payload.set(new Uint8Array(next), previous.byteLength);
            await invoke('ide_save_server_records', payload, {
                headers: {
                    'x-ide-id': String(id), 'x-ide-index': String(index), 'x-original-size': String(previous.byteLength)
                }
            });
            original.current = next;
            draft.current = null;
            setRevision(0);
            onSaved();
        } catch (error) {
            setError(String(error));
        } finally {
            setBusy(false);
        }
    }

    const buffer = draft.current ?? original.current;
    const view = buffer && new DataView(buffer);
    if (!groups || !view) return <Stack p="4" aria-busy={!error}>
        {error ? <Alert.Root status="error" size="sm"
                             role="alert"><Alert.Indicator/><Alert.Content>{message(error)}</Alert.Content></Alert.Root> : <>
            <Skeleton height="32px" width="280px"/>
            <Skeleton height="80px"/>
            <Skeleton height="100px"/>
        </>}
    </Stack>;

    const recordId = record?.idOffset === undefined ? '' : ' · ID ' + view.getInt32(record.idOffset, true);
    const recordName = record?.nameOffset === undefined ? '' :
        ' · ' + readField(view, record.nameOffset, 's');
    const handleInputKeyDown: ComponentProps<typeof Input>["onKeyDown"] = event => {
        if (event.key !== 'Enter' || !searchId.trim()) return;
        const value = Number(searchId);
        const result = group?.records.findIndex(entry => entry.idOffset !== undefined &&
            view.getInt32(entry.idOffset, true) === value) ?? -1;
        if (result < 0) setError(t("ID not found in this section."));
        else {
            choose(result);
            setError('');
        }
    };
    return <Stack p="4" minH="0" flex="1" gap="3">
        <Flex justify="space-between" align="center" gap="3">
            <Box><Heading size="sm">{format}</Heading><Text fontSize="sm">{t(descriptions[format])}</Text></Box>
            <Button size="sm" colorPalette="teal" loading={busy} onClick={() => void save()}>
                {t("Save")}{revision ? ' *' : ''}
            </Button>
        </Flex>
        {error && <Alert.Root status="error" size="sm"
                              role="alert"><Alert.Indicator/><Alert.Content>{message(error)}</Alert.Content></Alert.Root>}
        <fieldset disabled={busy} style={{display: 'flex', flexDirection: 'column', minHeight: 0}}>
            <Flex gap="3" align="center" wrap="wrap" mb="3">
                <SelectRoot size="sm" lazyMount unmountOnExit minW="140px"
                            collection={selectCollection(<>{groups.map((g, i) => <option key={t(g.label)}
                                                                                         value={i}>{t(g.label)} · {g.records.length}</option>)}</>)}
                            value={[String(groupIndex)]} onValueChange={async ({value: [value]}) => {
                    setGroupIndex(Number(value));
                    choose(0);
                }}
                            aria-label={t("Section")}><SelectTrigger><SelectValueText/></SelectTrigger><SelectContent><Select.Context>{select => select.collection.items.map(item =>
                    <SelectItem key={select.collection.getItemValue(item)}
                                item={item}>{t(select.collection.stringifyItem(item))}</SelectItem>)}</Select.Context></SelectContent></SelectRoot>
                {!!group?.records.length && <RecordNumber label={t("Record number")} index={recordIndex}
                                                          count={group.records.length} change={choose}/>}
                {record?.idOffset !== undefined && <Flex gap="1">
                    <Field.Root width="auto"><Input size="xs" width="9em" placeholder={t("Find by ID")}
                                                    aria-label={t("Find by ID")}
                                                    value={searchId} onChange={event => setSearchId(event.target.value)}
                                                    onKeyDown={handleInputKeyDown}/></Field.Root>
                </Flex>}
                <Text fontSize="sm">{recordId}{recordName}</Text>
            </Flex>
            <Stack overflowY="auto" gap="3" key={groupIndex + ':' + recordIndex}>
                {!record && <Text fontSize="sm">{t("This section is empty.")}</Text>}
                {record?.blocks.filter(block => block.count > 0).map(block => {
                    const row = blockRows[block.offset] ?? 0;
                    const base = block.offset + row * block.stride;
                    const handleRecordNumberchange: ComponentProps<typeof RecordNumber>["change"] = next => setBlockRows(old => ({
                        ...old,
                        [block.offset]: next
                    }));
                    return <Box borderWidth="1px" borderRadius="md" p="3" key={block.offset}>
                        <Flex gap="3" justify="space-between" align="center" mb="2">
                            <Heading size="xs">{t(block.label)}</Heading>
                            {block.count > 1 && <RecordNumber label={t(block.label)} index={row} count={block.count}
                                                              change={handleRecordNumberchange}/>}
                        </Flex>
                        <Flex gap="3" wrap="wrap" align="end" key={row}>
                            {block.fields.map(field => <Cell key={field.offset} field={field} fail={setError}
                                                             value={readField(view, base + field.offset, field.kind)}
                                                             update={value => update(field, base + field.offset, value)}/>)}
                        </Flex>
                    </Box>;
                })}
            </Stack>
        </fieldset>
    </Stack>;
}
