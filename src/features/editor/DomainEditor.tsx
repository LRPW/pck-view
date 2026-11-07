import {matchesShortcut} from '../../app/shortcuts';
import {message, t} from "../../i18n";
import {Alert, Box, Button, Field, Input, Select, Textarea} from "@chakra-ui/react";
import {invoke} from '@tauri-apps/api/core';
import {save as chooseExportPath} from '@tauri-apps/plugin-dialog';
import type {ComponentProps} from "react";
import {useEffect, useMemo, useRef, useState} from 'react';
import {AccordionItem, AccordionItemContent, AccordionItemTrigger, AccordionRoot} from "../../components/ui/accordion";
import {SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValueText} from "../../components/ui/select";
import {ColumnDivider, resizeWidth} from './ColumnDivider';
import {type DomainData, type Point, readDomain, type Territory, writeDomain, writeDomainServer} from './domain-data';
import './domain.css';
import {selectCollection} from './select-collection';
import {useColumnWidth} from './useColumnWidth';

function makeDraft(item: Territory) {
    return {
        name: item.name, id: String(item.id), type: String(item.type), reward: String(item.reward),
        x: String(item.center[0]), y: String(item.center[1]),
        vertices: item.vertices.map(point => point.join(' ')).join('\n'),
        faces: item.faces.map((_, i) => i % 3 === 0 ? item.faces.slice(i, i + 3).join(' ') : '')
            .filter(Boolean).join('\n'),
        neighbours: item.neighbours.join(', '),
        country: String(item.nations?.country ?? 0),
        capital: String(item.nations?.capital ?? 0),
        positions: item.nations?.positions.map((_, index, positions) => index % 3 === 0
            ? positions.slice(index, index + 3).join(' ') : '').filter(Boolean).join('\n') ?? '',
    };
}

type Draft = ReturnType<typeof makeDraft>;

function integer(value: string, label: string) {
    const number = Number(value);
    if (!/^-?\d+$/.test(value.trim()) || number < -0x80000000 || number > 0x7fffffff) {
        throw new Error(`${label} · an i32 integer is required`);
    }
    return number;
}

function numbers(value: string, label: string) {
    return value.trim() ? value.trim().split(/[\s,;]+/).map(part => integer(part, label)) : [];
}

function editTerritory(draft: Draft, items: Territory[], selected: number) {
    const old = items[selected];
    const id = integer(draft.id, 'ID');
    if (id !== old.id && items.some(item => item.id === id)) throw new Error(`ID ${id} is already in use`);
    if (draft.name !== old.name && (draft.name.length > 15 || draft.name.includes('\0'))) {
        throw new Error("The name must fit in 15 UTF-16 code units");
    }
    const coordinates = numbers(draft.vertices, "Vertices");
    if (coordinates.length % 2) throw new Error("Vertices must contain X Y pairs");
    const vertices: Point[] = [];
    for (let i = 0; i < coordinates.length; i += 2) vertices.push([coordinates[i], coordinates[i + 1]]);
    const faces = numbers(draft.faces, "Triangles");
    if (faces.length % 3 || faces.some(index => index < 0 || index >= vertices.length)) {
        throw new Error("Each triangle must contain three valid vertex indices");
    }
    const neighbours = numbers(draft.neighbours, "Neighbours").map(value => value === old.id ? id : value);
    if (draft.neighbours !== old.neighbours.join(', ') &&
        (new Set(neighbours).size !== neighbours.length ||
            neighbours.some(value => value === id || !items.some(item => item.id === value)))) {
        throw new Error("Specify distinct IDs of existing neighbouring territories");
    }
    const updated: Territory = {
        id, name: draft.name, type: integer(draft.type, "Tier"), reward: integer(draft.reward, "Reward"),
        center: [integer(draft.x, "Center X"), integer(draft.y, "Center Y")], vertices, faces, neighbours,
    };
    if (old.nations) {
        const positions = draft.positions === makeDraft(old).positions ? old.nations.positions :
            draft.positions.trim().split(/[\s,;]+/).map(value => Math.fround(Number(value)));
        if (positions.length !== 12 || positions.some(value => !Number.isFinite(value))) {
            throw new Error("Specify four sets of X Y Z coordinates");
        }
        updated.nations = {
            country: integer(draft.country, "Country"),
            capital: integer(draft.capital, "Capital"),
            positions,
        };
    }
    return items.map((item, index) => {
        if (index === selected) return updated;
        return id !== old.id && item.neighbours.includes(old.id)
            ? {...item, neighbours: item.neighbours.map(value => value === old.id ? id : value)}
            : item;
    });
}

function mapShape(item: Territory) {
    const edges = new Map<string, { from: number; to: number; count: number }>();
    let fill = '';
    for (let i = 0; i < item.faces.length; i += 3) {
        const triangle = item.faces.slice(i, i + 3);
        fill += `M${triangle.map(index => item.vertices[index].join(',')).join('L')}Z`;
        triangle.forEach((from, j) => {
            const to = triangle[(j + 1) % 3];
            const key = from < to ? `${from}:${to}` : `${to}:${from}`;
            const edge = edges.get(key);
            if (edge) edge.count++;
            else edges.set(key, {from, to, count: 1});
        });
    }
    let outline = '';
    for (const {from, to, count} of edges.values()) {
        if (count === 1) outline += `M${item.vertices[from].join(',')}L${item.vertices[to].join(',')}`;
    }
    return {fill, outline};
}

export function DomainEditor({id, index, filename, active, onDirty, onSaved}: {
    id: number;
    index: number;
    filename: string;
    active: boolean;
    onDirty: (dirty: boolean) => void;
    onSaved: () => void;
}) {
    const nations = /^domain2/i.test(filename);
    const serverName = filename.replace(/\.data$/i, '.sev').toLowerCase();
    const [listWidth, setListWidth] = useColumnWidth('domain.list', 240);
    const [panelHeight, setPanelHeight] = useColumnWidth('domain.properties', 240);
    const properties = useRef<HTMLDivElement>(null);
    const [document, setDocument] = useState<DomainData>();
    const [original, setOriginal] = useState<Uint8Array>();
    const [items, setItems] = useState<Territory[]>([]);
    const [selected, setSelected] = useState(0);
    const [draft, setDraft] = useState<Draft>();
    const [speed, setSpeed] = useState('');
    const [query, setQuery] = useState('');
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState('');
    const [status, setStatus] = useState('');
    const item = items[selected];
    const changed = !!draft && !!item && Object.entries(makeDraft(item)).some(([key, value]) => draft[key as keyof Draft] !== value);
    const speedChanged = nations && !!document && speed !== String(document.speed);
    const dirty = !!document && (items !== document.territories || changed || speedChanged);
    useEffect(() => onDirty(dirty || busy), [onDirty, dirty, busy]);

    useEffect(() => {
        let disposed = false;
        setBusy(true);
        void invoke<number[]>('ide_read', {id, index}).then(raw => {
            if (disposed) return;
            const bytes = new Uint8Array(raw);
            const parsed = readDomain(bytes, nations);
            setDocument(parsed);
            setOriginal(bytes);
            setItems(parsed.territories);
            setSelected(0);
            setDraft(parsed.territories.length ? makeDraft(parsed.territories[0]) : undefined);
            setSpeed(parsed.speed === undefined ? '' : String(parsed.speed));
        }).catch(reason => {
            if (!disposed) setError(String(reason));
        })
            .finally(() => {
                if (!disposed) setBusy(false);
            });
        return () => {
            disposed = true;
        };
    }, [id, index, nations]);

    function commit() {
        return changed && draft ? editTerritory(draft, items, selected) : items;
    }

    function apply() {
        try {
            const updated = commit();
            setItems(updated);
            setDraft(makeDraft(updated[selected]));
            setError('');
        } catch (reason) {
            setError(String(reason));
        }
    }

    function select(next: number) {
        if (busy || next === selected) return;
        try {
            const updated = commit();
            setItems(updated);
            setSelected(next);
            setDraft(makeDraft(updated[next]));
            setError('');
        } catch (reason) {
            setError(String(reason));
        }
    }

    function editedSpeed() {
        const nextSpeed = speedChanged ? Math.fround(Number(speed)) : document?.speed;
        if (speedChanged && (!Number.isFinite(nextSpeed) || nextSpeed! < Math.fround(0.001))) {
            throw new Error(t("Movement speed must be at least 0.001"));
        }
        return nextSpeed;
    }

    async function save() {
        if (!document || !original || busy || !dirty) return;
        setBusy(true);
        setError('');
        setStatus('');
        try {
            const updated = commit();
            const nextSpeed = editedSpeed();
            const bytes = writeDomain(document, updated, nextSpeed);
            const parsed = readDomain(bytes, nations);
            await invoke('ide_save_domain', {id, index, original: Array.from(original), bytes: Array.from(bytes)});
            setDocument(parsed);
            setOriginal(bytes);
            setItems(parsed.territories);
            setDraft(parsed.territories[selected] ? makeDraft(parsed.territories[selected]) : undefined);
            setSpeed(parsed.speed === undefined ? '' : String(parsed.speed));
            setStatus(t("Saved"));
            onSaved();
        } catch (reason) {
            setError(String(reason));
        } finally {
            setBusy(false);
        }
    }

    async function exportServer() {
        if (!document || busy) return;
        setBusy(true);
        setError('');
        setStatus('');
        try {
            const bytes = writeDomainServer(document, commit(), editedSpeed());
            const path = await chooseExportPath({
                title: t("Export server territories"),
                defaultPath: serverName,
                filters: [{name: t("Server territories"), extensions: ['sev']}],
            });
            if (!path) return;
            await invoke('ide_export_server_data', {path, bytes: Array.from(bytes)});
            setStatus(serverName + " exported");
        } catch (reason) {
            setError(String(reason));
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

    const map = useMemo(() => {
        if (!items.length) return undefined;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const territory of items) for (const [x, y] of [...territory.vertices, territory.center]) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        }
        const margin = Math.max(1, Math.max(maxX - minX, maxY - minY) * 0.025);
        return {
            viewBox: [minX - margin, minY - margin, maxX - minX + margin * 2, maxY - minY + margin * 2].join(' '),
            shapes: items.map(mapShape),
        };
    }, [items]);

    const neighbours = new Set(item?.neighbours);
    const state = (territory: Territory, position: number) =>
        position === selected ? 'selected' : neighbours.has(territory.id) ? 'neighbour' : '';
    const update = (field: keyof Draft, value: string) => setDraft(old => old && {...old, [field]: value});
    const handleColumnDividerDelta: ComponentProps<typeof ColumnDivider>["onDelta"] = delta => {
        const panel = properties.current;
        if (!panel?.parentElement) return;
        const max = panel.parentElement.clientHeight - 107;
        if (max > 0) setPanelHeight(height => resizeWidth(Math.min(height, max), -delta, Math.min(80, max), max));
    };
    return <section className="domain-editor">
        <header>
            <Button disabled={busy || !dirty} onClick={() => void save()}>{t("Save")}{dirty ? ' *' : ''}</Button>
            <Button size="xs" variant="outline" disabled={busy || !document}
                    onClick={() => void exportServer()}>{t("Export ")}{serverName}</Button>
            <Button disabled={busy || !changed} onClick={apply}>{t("Apply to map")}</Button>
            <Button disabled={busy || !changed} onClick={() => {
                setDraft(makeDraft(item));
                setError('');
            }}>{t("Revert territory changes")}</Button>
            <span role="status">{busy ? t("Working…") : status}</span>
        </header>
        {error && <Alert.Root status="error" size="sm"
                              role="alert"><Alert.Indicator/><Alert.Content>{message(error)}</Alert.Content></Alert.Root>}
        <Box className="domain-workspace">
            <aside style={{width: listWidth}}>
                <Field.Root width="auto"><Input aria-label={t("Find territory")} placeholder={t("ID or name…")}
                                                value={query}
                                                onChange={event => setQuery(event.target.value)}/></Field.Root>
                <nav aria-label={t("Territories")}>
                    {items.map((territory, position) =>
                        (territory.name.toLowerCase().includes(query.toLowerCase()) || String(territory.id).includes(query)) &&
                        <Button key={position} className={state(territory, position)} disabled={busy}
                                onClick={() => select(position)} aria-pressed={position === selected}>
                            <code>{territory.id}</code>{territory.name || "Untitled"}
                        </Button>)}
                </nav>
            </aside>
            <ColumnDivider label={t("Territory list width")}
                           onDelta={delta => setListWidth(width => resizeWidth(width, delta, 120, 460))}/>
            <Box className="domain-details">
                {map && <svg className="domain-map" viewBox={map.viewBox} aria-label={t("Territory map")}>
                    {items.map((territory, position) => <g key={position}
                                                           className={`domain-region ${state(territory, position)}`}
                                                           onClick={() => select(position)}>
                        <title>{territory.id} · {territory.name}</title>
                        <path className="domain-fill" d={map.shapes[position].fill}/>
                        <path className="domain-outline" d={map.shapes[position].outline}/>
                    </g>)}
                    {item && <circle cx={item.center[0]} cy={item.center[1]} r="3" className="domain-center"/>}
                </svg>}
                {draft && <ColumnDivider label={t("Properties panel height")} orientation="horizontal"
                                         onDelta={handleColumnDividerDelta}/>}
                {draft && <Box className="domain-properties" ref={properties} style={{height: panelHeight}}>
                    {([['name', t("Name")], ['id', 'ID'], ['reward', nations ? t("Points") : t("Weekly reward")],
                        ['x', t("Center X")], ['y', t("Center Y")]] as const).map(([field, label]) =>
                        <Field.Root width="auto" key={field}><Field.Label>{t(label)}</Field.Label><Input
                            value={draft[field]} disabled={busy}
                            inputMode={field === 'name' ? 'text' : 'numeric'}
                            onChange={event => update(field, event.target.value)}/></Field.Root>)}
                    {nations ? <>
                        <Field.Root width="auto"><Field.Label>{t("Battle type")}</Field.Label><Input inputMode="numeric"
                                                                                                     value={draft.type}
                                                                                                     disabled={busy}
                                                                                                     onChange={event => update('type', event.target.value)}/></Field.Root>
                        <Field.Root width="auto"><Field.Label>{t("Initial country")}</Field.Label><SelectRoot size="sm"
                                                                                                              lazyMount
                                                                                                              unmountOnExit
                                                                                                              minW="140px"
                                                                                                              collection={selectCollection(<>{!['0', '1', '2', '3', '4'].includes(draft.country) &&
                                                                                                                  <option
                                                                                                                      value={draft.country}>{draft.country}</option>}
                                                                                                                  <option
                                                                                                                      value="0">{t("No country")}</option>
                                                                                                                  {[1, 2, 3, 4].map(country =>
                                                                                                                      <option
                                                                                                                          key={country}
                                                                                                                          value={country}>{t("Country ")}{country}</option>)}</>)}
                                                                                                              value={[String(draft.country)]}
                                                                                                              onValueChange={async ({value: [value]}) => update('country', value)}
                                                                                                              disabled={busy}><SelectTrigger><SelectValueText/></SelectTrigger><SelectContent><Select.Context>{select => select.collection.items.map(item =>
                            <SelectItem key={select.collection.getItemValue(item)}
                                        item={item}>{t(select.collection.stringifyItem(item))}</SelectItem>)}</Select.Context></SelectContent></SelectRoot></Field.Root>
                        <Field.Root width="auto"><Field.Label>{t("Capital")}</Field.Label><SelectRoot size="sm"
                                                                                                      lazyMount
                                                                                                      unmountOnExit
                                                                                                      minW="140px"
                                                                                                      collection={selectCollection(<>{!['0', '1'].includes(draft.capital) &&
                                                                                                          <option
                                                                                                              value={draft.capital}>{draft.capital}</option>}
                                                                                                          <option
                                                                                                              value="0">{t("No")}</option>
                                                                                                          <option
                                                                                                              value="1">{t("Yes")}</option>
                                                                                                      </>)}
                                                                                                      value={[String(draft.capital)]}
                                                                                                      onValueChange={async ({value: [value]}) => update('capital', value)}
                                                                                                      disabled={busy}><SelectTrigger><SelectValueText/></SelectTrigger><SelectContent><Select.Context>{select => select.collection.items.map(item =>
                            <SelectItem key={select.collection.getItemValue(item)}
                                        item={item}>{t(select.collection.stringifyItem(item))}</SelectItem>)}</Select.Context></SelectContent></SelectRoot></Field.Root>
                        <Field.Root width="auto"><Field.Label>{t("Map movement speed")}</Field.Label><Input
                            inputMode="decimal" value={speed} disabled={busy}
                            onChange={event => setSpeed(event.target.value)}/></Field.Root>
                    </> : <Field.Root width="auto"><Field.Label>{t("Tier")}</Field.Label><SelectRoot size="sm" lazyMount
                                                                                                     unmountOnExit
                                                                                                     minW="140px"
                                                                                                     collection={selectCollection(<>{!['0', '1', '2', '3'].includes(draft.type) &&
                                                                                                         <option
                                                                                                             value={draft.type}>{draft.type}</option>}
                                                                                                         <option
                                                                                                             value="0">{t("No tier")}</option>
                                                                                                         <option
                                                                                                             value="1">III
                                                                                                         </option>
                                                                                                         <option
                                                                                                             value="2">II
                                                                                                         </option>
                                                                                                         <option
                                                                                                             value="3">I
                                                                                                         </option>
                                                                                                     </>)}
                                                                                                     value={[String(draft.type)]}
                                                                                                     onValueChange={async ({value: [value]}) => update('type', value)}
                                                                                                     disabled={busy}><SelectTrigger><SelectValueText/></SelectTrigger><SelectContent><Select.Context>{select => select.collection.items.map(item =>
                        <SelectItem key={select.collection.getItemValue(item)}
                                    item={item}>{t(select.collection.stringifyItem(item))}</SelectItem>)}</Select.Context></SelectContent></SelectRoot></Field.Root>}
                    <Field.Root width="auto"
                                className="domain-wide"><Field.Label>{t("Neighbour IDs")}</Field.Label><Input
                        value={draft.neighbours} disabled={busy}
                        onChange={event => update('neighbours', event.target.value)}/></Field.Root>
                    <AccordionRoot collapsible defaultValue={false ? ["content"] : []}
                                   className="domain-wide"><AccordionItem
                        value="content"><AccordionItemTrigger>{t("Geometry")}</AccordionItemTrigger><AccordionItemContent><Field.Root
                        width="auto"><Field.Label>{t("Vertices (X Y)")}</Field.Label><Textarea rows={5}
                                                                                               value={draft.vertices}
                                                                                               disabled={busy}
                                                                                               onChange={event => update('vertices', event.target.value)}/></Field.Root><Field.Root
                        width="auto"><Field.Label>{t("Triangles (zero-based indices)")}</Field.Label><Textarea rows={5}
                                                                                                               value={draft.faces}
                                                                                                               disabled={busy}
                                                                                                               onChange={event => update('faces', event.target.value)}/></Field.Root>{nations &&
                        <Field.Root width="auto"><Field.Label>{t("Instance coordinates (X Y Z)")}</Field.Label><Textarea
                            rows={4} value={draft.positions}
                            disabled={busy}
                            onChange={event => update('positions', event.target.value)}/></Field.Root>}
                    </AccordionItemContent></AccordionItem></AccordionRoot>
                </Box>}
            </Box>
        </Box>
    </section>;
}
