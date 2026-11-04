import {useEffect, useMemo, useRef, useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {ColumnDivider, resizeWidth} from './ColumnDivider';
import {useColumnWidth} from './useColumnWidth';
import {type DomainData, type Point, readDomain, type Territory, writeDomain} from './domain-data';
import './domain.css';

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
        throw new Error(`${label} · требуется целое число в диапазоне i32`);
    }
    return number;
}

function numbers(value: string, label: string) {
    return value.trim() ? value.trim().split(/[\s,;]+/).map(part => integer(part, label)) : [];
}

function editTerritory(draft: Draft, items: Territory[], selected: number) {
    const old = items[selected];
    const id = integer(draft.id, 'ID');
    if (id !== old.id && items.some(item => item.id === id)) throw new Error(`ID ${id} уже используется`);
    if (draft.name !== old.name && (draft.name.length > 15 || draft.name.includes('\0'))) {
        throw new Error('Название должно помещаться в 15 символов UTF-16');
    }
    const coordinates = numbers(draft.vertices, 'Вершины');
    if (coordinates.length % 2) throw new Error('Вершины должны содержать пары X Y');
    const vertices: Point[] = [];
    for (let i = 0; i < coordinates.length; i += 2) vertices.push([coordinates[i], coordinates[i + 1]]);
    const faces = numbers(draft.faces, 'Треугольники');
    if (faces.length % 3 || faces.some(index => index < 0 || index >= vertices.length)) {
        throw new Error('Каждый треугольник должен содержать три индекса существующих вершин');
    }
    const neighbours = numbers(draft.neighbours, 'Соседи').map(value => value === old.id ? id : value);
    if (draft.neighbours !== old.neighbours.join(', ') &&
        (new Set(neighbours).size !== neighbours.length ||
            neighbours.some(value => value === id || !items.some(item => item.id === value)))) {
        throw new Error('Укажите разные ID существующих соседних территорий');
    }
    const updated: Territory = {
        id, name: draft.name, type: integer(draft.type, 'Уровень'), reward: integer(draft.reward, 'Награда'),
        center: [integer(draft.x, 'Центр X'), integer(draft.y, 'Центр Y')], vertices, faces, neighbours,
    };
    if (old.nations) {
        const positions = draft.positions === makeDraft(old).positions ? old.nations.positions :
            draft.positions.trim().split(/[\s,;]+/).map(value => Math.fround(Number(value)));
        if (positions.length !== 12 || positions.some(value => !Number.isFinite(value))) {
            throw new Error('Укажите четыре тройки координат X Y Z');
        }
        updated.nations = {
            country: integer(draft.country, 'Страна'),
            capital: integer(draft.capital, 'Столица'),
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

export function DomainEditor({id, index, nations, active, onDirty, onSaved}: {
    id: number;
    index: number;
    nations: boolean;
    active: boolean;
    onDirty: (dirty: boolean) => void;
    onSaved: () => void;
}) {
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

    async function save() {
        if (!document || !original || busy || !dirty) return;
        setBusy(true);
        setError('');
        setStatus('');
        try {
            const updated = commit();
            const nextSpeed = speedChanged ? Math.fround(Number(speed)) : document.speed;
            if (speedChanged && (!Number.isFinite(nextSpeed) || nextSpeed! < Math.fround(0.001))) {
                throw new Error('Скорость перемещения должна быть не меньше 0,001');
            }
            const bytes = writeDomain(document, updated, nextSpeed);
            const parsed = readDomain(bytes, nations);
            await invoke('ide_save_domain', {id, index, original: Array.from(original), bytes: Array.from(bytes)});
            setDocument(parsed);
            setOriginal(bytes);
            setItems(parsed.territories);
            setDraft(parsed.territories[selected] ? makeDraft(parsed.territories[selected]) : undefined);
            setSpeed(parsed.speed === undefined ? '' : String(parsed.speed));
            setStatus('Сохранено');
            onSaved();
        } catch (reason) {
            setError(String(reason));
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
    return <section className="domain-editor">
        <header>
            <button disabled={busy || !dirty} onClick={() => void save()}>Сохранить{dirty ? ' *' : ''}</button>
            <button disabled={busy || !changed} onClick={apply}>Применить к карте</button>
            <button disabled={busy || !changed} onClick={() => {
                setDraft(makeDraft(item));
                setError('');
            }}>Отменить правки территории
            </button>
            <span role="status">{busy ? 'Выполняется операция…' : status}</span>
        </header>
        {error && <div className="ide-error" role="alert">{error}</div>}
        <div className="domain-workspace">
            <aside style={{width: listWidth}}>
                <input aria-label="Поиск территории" placeholder="ID или название…" value={query}
                       onChange={event => setQuery(event.target.value)}/>
                <nav aria-label="Территории">
                    {items.map((territory, position) =>
                        (territory.name.toLowerCase().includes(query.toLowerCase()) || String(territory.id).includes(query)) &&
                        <button key={position} className={state(territory, position)} disabled={busy}
                                onClick={() => select(position)} aria-pressed={position === selected}>
                            <code>{territory.id}</code>{territory.name || 'Без названия'}
                        </button>)}
                </nav>
            </aside>
            <ColumnDivider label="Ширина списка территорий"
                           onDelta={delta => setListWidth(width => resizeWidth(width, delta, 120, 460))}/>
            <div className="domain-details">
                {map && <svg className="domain-map" viewBox={map.viewBox} aria-label="Карта территорий">
                    {items.map((territory, position) => <g key={position}
                                                           className={`domain-region ${state(territory, position)}`}
                                                           onClick={() => select(position)}>
                        <title>{territory.id} · {territory.name}</title>
                        <path className="domain-fill" d={map.shapes[position].fill}/>
                        <path className="domain-outline" d={map.shapes[position].outline}/>
                    </g>)}
                    {item && <circle cx={item.center[0]} cy={item.center[1]} r="3" className="domain-center"/>}
                </svg>}
                {draft && <ColumnDivider label="Высота панели параметров" orientation="horizontal" onDelta={delta => {
                    const panel = properties.current;
                    if (!panel?.parentElement) return;
                    const max = panel.parentElement.clientHeight - 107;
                    if (max > 0) setPanelHeight(height => resizeWidth(Math.min(height, max), -delta, Math.min(80, max), max));
                }}/>}
                {draft && <div className="domain-properties" ref={properties} style={{height: panelHeight}}>
                    {([['name', 'Название'], ['id', 'ID'], ['reward', nations ? 'Очки' : 'Награда за неделю'],
                        ['x', 'Центр X'], ['y', 'Центр Y']] as const).map(([field, label]) =>
                        <label key={field}>{label}<input value={draft[field]} disabled={busy}
                                                         inputMode={field === 'name' ? 'text' : 'numeric'}
                                                         onChange={event => update(field, event.target.value)}/></label>)}
                    {nations ? <>
                        <label>Тип боя<input inputMode="numeric" value={draft.type} disabled={busy}
                                             onChange={event => update('type', event.target.value)}/></label>
                        <label>Начальная страна<select value={draft.country} disabled={busy}
                                                       onChange={event => update('country', event.target.value)}>
                            {!['0', '1', '2', '3', '4'].includes(draft.country) &&
                                <option value={draft.country}>{draft.country}</option>}
                            <option value="0">Без страны</option>
                            {[1, 2, 3, 4].map(country => <option key={country}
                                                                 value={country}>Страна {country}</option>)}
                        </select></label>
                        <label>Столица<select value={draft.capital} disabled={busy}
                                              onChange={event => update('capital', event.target.value)}>
                            {!['0', '1'].includes(draft.capital) &&
                                <option value={draft.capital}>{draft.capital}</option>}
                            <option value="0">Нет</option>
                            <option value="1">Да</option>
                        </select></label>
                        <label>Скорость перемещения по карте<input inputMode="decimal" value={speed} disabled={busy}
                                                                   onChange={event => setSpeed(event.target.value)}/></label>
                    </> : <label>Уровень<select value={draft.type} disabled={busy}
                                                onChange={event => update('type', event.target.value)}>
                        {!['0', '1', '2', '3'].includes(draft.type) && <option value={draft.type}>{draft.type}</option>}
                        <option value="0">Без уровня</option>
                        <option value="1">III</option>
                        <option value="2">II</option>
                        <option value="3">I</option>
                    </select></label>}
                    <label className="domain-wide">ID соседей<input value={draft.neighbours} disabled={busy}
                                                                    onChange={event => update('neighbours', event.target.value)}/></label>
                    <details className="domain-wide">
                        <summary>Геометрия</summary>
                        <label>Вершины (X Y)<textarea rows={5} value={draft.vertices} disabled={busy}
                                                      onChange={event => update('vertices', event.target.value)}/></label>
                        <label>Треугольники (индексы с 0)<textarea rows={5} value={draft.faces} disabled={busy}
                                                                   onChange={event => update('faces', event.target.value)}/></label>
                        {nations && <label>Координаты в инстансе (X Y Z)<textarea rows={4} value={draft.positions}
                                                                                  disabled={busy}
                                                                                  onChange={event => update('positions', event.target.value)}/></label>}
                    </details>
                </div>}
            </div>
        </div>
    </section>;
}
