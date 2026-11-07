import {matchesShortcut} from '../../app/shortcuts';
import {message, t} from "../../i18n";
import {Alert, Box, Button, Field, Input, Select, Textarea} from "@chakra-ui/react";
import {invoke as rawInvoke} from '@tauri-apps/api/core';
import {confirm, save} from '@tauri-apps/plugin-dialog';
import type {ComponentProps} from "react";
import {useCallback, useEffect, useRef, useState} from 'react';
import {AccordionItem, AccordionItemContent, AccordionItemTrigger, AccordionRoot} from "../../components/ui/accordion";
import {SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValueText} from "../../components/ui/select";
import {ColumnDivider, resizeWidth} from './ColumnDivider';
import './elements.css';
import {GameText} from './GameText';
import {InventoryIcon, useInventoryIcons} from './InventoryIcons';
import {useItemDescriptions} from './item-descriptions';
import {RecordLink} from './RecordLink';
import {isImageField, isImageResource, ResourceFieldPreview} from './ResourceFieldPreview';
import {selectCollection} from './select-collection';
import {buyField, ShopSlots} from './ShopSlots';
import {TaskColoredTextInput} from './TaskColoredTextInput';
import {useUnsavedGuard} from './unsaved';
import {useColumnWidth} from './useColumnWidth';

type Summary = {
    id: number;
    path: string;
    encrypted: boolean;
    gshop_version?: number | null; elements_version?: number | null;
    lists: [string, number][]
};
type Field = { name: string; kind: string; size: number; unit: number };
const shopFieldNames: Record<string, string> = {
    local_id: "Shop record ID",
    main_type: "Category",
    sub_type: "Subcategory",
    icon: "Shop image path",
    item_id: "Item ID",
    num: "Item quantity",
    desc: "Product description",
    name: "Name",
    idGift: "Gift ID",
    iGiftNum: "Gift quantity",
    iGiftTime: "Gift duration (seconds)",
    iLogPrice: "Log price",
    owner_npcs: "Vendor NPC IDs",
    buy_times_limit: "Purchase limit",
    buy_times_limit_mode: "Purchase limit period",
};
const shopFieldLabel = (name: string) => shopFieldNames[name] ?? name;

function isResourceField(field: Field) {
    return (field.kind === 'gbk' || field.kind === 'utf16') &&
        (isImageField(field.name) || /(?:^|[._])file(?:_|$)|^show_model$/i.test(field.name));
}

type RecordData = { fields: Field[]; values: string[] };
type Rows = { total: number; rows: { index: number; id: number; name: string }[] };
type ShopCategory = { name: string; subcategories: string[] };
type ShopFilter = { mainType?: number; subType?: number };
const categoryName = (name: string, index: number) => name || `Category ${index}`;
const subcategoryName = (name: string, index: number) => name || `Subcategory ${index}`;

export function ElementsEditor({
                                   visible,
                                   onBack,
                                   onOpen,
                                   requestedPath,
                                   requestedProject,
                                   requestedIde,
                                   embedded = false,
                                   shop = false,
                                   onDirty,
                                   onSaved,
                                   readImage,
                                   openResource,
                                   openItem,
                                   itemJump,
                                   pickResource,
                                   cancelResourcePick
                               }: {
    visible: boolean;
    onBack: () => void;
    onOpen: () => void;
    requestedPath?: string;
    requestedProject?: { manifest: string; path: string };
    requestedIde?: { id: number; index: number; gshopVersion?: number | null };
    embedded?: boolean;
    shop?: boolean;
    onDirty?: (dirty: boolean) => void;
    onSaved?: () => void;
    readImage?: (path: string) => Promise<number[]>;
    openResource?: (path: string) => void;
    openItem?: (id: number, npc?: boolean) => void;
    itemJump?: { id: number; npc?: boolean };
    pickResource?: (field: string, imageOnly: boolean, choose: (path: string) => void) => void;
    cancelResourcePick?: () => void
}) {
    const [categoryWidth, setCategoryWidth] = useColumnWidth('elements.categories', 220);
    const [recordsWidth, setRecordsWidth] = useColumnWidth('elements.records', 240);
    const [idWidth, setIdWidth] = useColumnWidth('elements.id', 50);
    const [fieldWidth, setFieldWidth] = useColumnWidth('elements.fields', 175);
    const [doc, setDoc] = useState<Summary>();
    const [list, setList] = useState(0);
    const [index, setIndex] = useState<number>();
    const itemDescriptions = useItemDescriptions(shop ? requestedIde?.id : undefined);
    const inventoryAtlas = useInventoryIcons(shop ? requestedIde?.id : undefined);
    const [shopCategories, setShopCategories] = useState<ShopCategory[]>([]);
    const [shopFilter, setShopFilter] = useState<ShopFilter>({});
    const invoke = useCallback(<T, >(command: string, args: Record<string, unknown> = {}) => rawInvoke<T>(command, {
        ...args,
        document: doc?.id
    }), [doc?.id]);
    useEffect(() => {
        const id = doc?.id;
        return () => {
            if (id) void rawInvoke('elements_close', {document: id});
        };
    }, [doc?.id]);
    const [query, setQuery] = useState('');
    const [category, setCategory] = useState('');
    const [page, setPage] = useState(0);
    const [rows, setRows] = useState<Rows>({total: 0, rows: []});
    const [record, setRecord] = useState<RecordData>();
    const [draft, setDraft] = useState<string[]>([]);
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');
    const [fieldQuery, setFieldQuery] = useState('');
    const [revision, setRevision] = useState(0);
    useEffect(() => () => cancelResourcePick?.(), [index, list, visible, cancelResourcePick]);
    const changed = !!record && draft.some((v, i) => v !== record.values[i]);
    const unsaved = useRef(false);
    unsaved.current = dirty || changed;
    useEffect(() => {
        if (!requestedIde) return;
        setDoc(undefined);
        setRecord(undefined);
        setDraft([]);
        let cancelled = false;
        void run(async () => {
            const summary = await rawInvoke<Summary>('elements_open_ide', requestedIde);
            if (cancelled) {
                void rawInvoke('elements_close', {document: summary.id});
                return;
            }
            setDoc(summary);
            setList(0);
            setIndex(undefined);
            setRecord(undefined);
            setDraft([]);
            setDirty(false);
            setQuery('');
            setPage(0);
            setRows({total: 0, rows: []});
            setStatus('');
        });
        return () => {
            cancelled = true;
        };
    }, [requestedIde]);
    useEffect(() => {
        if (!requestedProject) return;
        void (async () => {
            if (unsaved.current && !(await confirm(t("Open another elements.data and discard changes?"), {
                title: 'PW Forge',
                kind: 'warning'
            }))) return;
            await run(async () => {
                const summary = await invoke<Summary>('elements_open_project', requestedProject);
                setDoc(summary);
                setList(0);
                setIndex(undefined);
                setRecord(undefined);
                setDraft([]);
                setDirty(false);
                setQuery('');
                setPage(0);
                setRows({total: 0, rows: []});
                setStatus(summary.path);
            });
        })();
    }, [requestedProject]);
    useEffect(() => {
        if (!requestedPath || requestedPath === doc?.path) return;
        void (async () => {
            if (unsaved.current && !(await confirm(t("Open another elements.data and discard changes?"), {
                title: 'PW Forge',
                kind: 'warning'
            }))) return;
            await run(async () => {
                const summary = await invoke<Summary>('elements_open', {path: requestedPath});
                setDoc(summary);
                setList(0);
                setIndex(undefined);
                setRecord(undefined);
                setDraft([]);
                setDirty(false);
                setQuery('');
                setPage(0);
                setRows({total: 0, rows: []});
                setStatus(summary.path);
            });
        })();
    }, [requestedPath]);
    useUnsavedGuard('elements.data:' + (requestedPath ?? requestedProject?.path ?? (requestedIde ? `${requestedIde.id}:${requestedIde.index}` : doc?.id)), dirty || changed || busy);
    useEffect(() => {
        onDirty?.(dirty || changed);
    }, [dirty, changed, onDirty]);
    useEffect(() => {
        if (!visible) return;
        const handler = (e: KeyboardEvent) => {
            if (matchesShortcut(e, 'save')) {
                e.preventDefault();
                if (!busy) void saveFile(e.shiftKey);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    });
    useEffect(() => {
        if (!shop || !doc) return;
        let active = true;
        void invoke<ShopCategory[]>('gshop_categories').then(items => {
            if (active) setShopCategories(items);
        })
            .catch(reason => {
                if (active) setError(String(reason));
            });
        return () => {
            active = false;
        };
    }, [shop, doc?.id, invoke, revision]);
    useEffect(() => {
        if (!doc) return;
        let active = true;
        const timer = setTimeout(() => {
            const filter = shop && list === 0 ? shopFilter : {};
            invoke<Rows>('elements_rows', {list, query, page, ...filter}).then(v => {
                if (!active) return;
                setRows(v);
                const lastPage = Math.max(0, Math.ceil(v.total / 200) - 1);
                if (page > lastPage) setPage(lastPage);
            }).catch(e => {
                if (active) setError(String(e));
            });
        }, 150);
        return () => {
            active = false;
            clearTimeout(timer);
        };
    }, [doc, list, query, page, revision, shop, shopFilter, invoke]);

    async function run(action: () => Promise<void>) {
        setBusy(true);
        setError('');
        try {
            await action();
        } catch (e) {
            setError(String(e));
        } finally {
            setBusy(false);
        }
    }

    async function apply() {
        if (!changed || !record || index === undefined) return;
        const changes = draft.flatMap((v, i) => v === record.values[i] ? [] : [[i, v]]);
        await invoke('elements_update', {list, index, changes});
        setRecord({...record, values: [...draft]});
        setDirty(true);
        setRevision(v => v + 1);
        setStatus(t("Changes applied. Save the file."));
    }

    async function mayLeaveRecord() {
        if (!changed) return true;
        return confirm(t("Discard unapplied changes to this record?"), {title: 'PW Forge', kind: 'warning'});
    }

    async function selectList(next: number, filter: ShopFilter = {}) {
        if (!(await mayLeaveRecord())) return;
        setList(next);
        setShopFilter(filter);
        setIndex(undefined);
        setRecord(undefined);
        setDraft([]);
        setRows({total: 0, rows: []});
        setPage(0);
        setQuery('');
    }

    const itemField = shop ? record?.fields.findIndex(field => field.name === "item_id") ?? -1 : -1;
    const itemDescription = itemField >= 0 ? itemDescriptions?.get(Number(draft[itemField])) : undefined;
    const mainField = record?.fields.findIndex(field => field.name === 'main_type') ?? -1;
    const subField = record?.fields.findIndex(field => field.name === 'sub_type') ?? -1;

    function shopTypeSelector(field: number) {
        const main = field === mainField;
        const subcategories = shopCategories[Number(draft[mainField])]?.subcategories ?? [];
        const names = main ? shopCategories.map((item, i) => categoryName(item.name, i)) :
            subcategories.map(subcategoryName);
        if (!main && !names.length) names.push(t("No subcategory"));
        return <SelectRoot size="sm" lazyMount unmountOnExit minW="140px"
                           collection={selectCollection(<>{!names.some((_, i) => String(i) === draft[field]) &&
                               <option value={draft[field]} disabled>{draft[field]}</option>}{names.map((name, i) =>
                               <option key={i} value={i}>{name}</option>)}</>)} value={[String(draft[field])]}
                           onValueChange={async ({value: [value]}) => {
                               const next = value;
                               setDraft(values => values.map((value, i) => i === field ? next : main && i === subField ? '0' : value));
                           }} aria-label={shopFieldLabel(main ? 'main_type' : 'sub_type')}
                           disabled={busy || !shopCategories.length}><SelectTrigger><SelectValueText/></SelectTrigger><SelectContent><Select.Context>{select => select.collection.items.map(item =>
            <SelectItem key={select.collection.getItemValue(item)}
                        item={item}>{t(select.collection.stringifyItem(item))}</SelectItem>)}</Select.Context></SelectContent></SelectRoot>;
    }

    async function selectRecord(next: number) {
        if (!(await mayLeaveRecord())) return;
        await run(async () => {
            const r = await invoke<RecordData>('elements_record', {list, index: next});
            setIndex(next);
            setRecord(r);
            setDraft(r.values);
            setFieldQuery('');
        });
    }

    const handledItem = useRef<typeof itemJump>(undefined);
    useEffect(() => {
        if (!itemJump || shop || !doc || busy || handledItem.current === itemJump) return;
        handledItem.current = itemJump;
        void run(async () => {
            const target = await invoke<[number, number] | null>('elements_find_item', {
                itemId: itemJump.id,
                npc: itemJump.npc
            });
            if (!target) throw new Error(`${itemJump.npc ? 'NPC' : t("Item")} ${itemJump.id} was not found in elements.data`);
            const [nextList, nextIndex] = target;
            if (nextList === list && nextIndex === index) return;
            if (!(await mayLeaveRecord())) return;
            const next = await invoke<RecordData>('elements_record', {list: nextList, index: nextIndex});
            setList(nextList);
            setIndex(nextIndex);
            setRecord(next);
            setDraft(next.values);
            setCategory('');
            setQuery('');
            setFieldQuery('');
            setRows({total: 0, rows: []});
            setPage(Math.floor(nextIndex / 200));
        });
    }, [itemJump, shop, doc, busy, list, index, invoke]);
    const selectedRow = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        selectedRow.current?.scrollIntoView({block: 'nearest'});
    }, [rows, index]);

    async function saveFile(as: boolean) {
        if (!doc) return;
        await run(async () => {
            let path = doc.path;
            if (as) {
                const picked = await save({
                    defaultPath: doc.path.replace(/\.data$/i, '.edited.data'),
                    filters: [{name: shop ? 'GShop data' : 'Elements data', extensions: ['data']}]
                });
                if (!picked) return;
                path = picked;
            }
            await apply();
            const result = await invoke<{ path: string; backup: string }>('elements_save', {path});
            setDoc({...doc, path: result.path});
            setDirty(false);
            setStatus(t("Saved: {value0}{value1}", {
                value0: result.path,
                value1: result.backup ? " • Backup: " + result.backup : ''
            }));
            if (!as) onSaved?.();
            window.dispatchEvent(new Event('pwforge-saved'));
        });
    }

    const serverShopName = shop && doc?.path.split(/[\\/]/).at(-1)
        ?.match(/^gshop([12]?)(?:\.edited)*\.data$/i);
    const serverShop = serverShopName ? 'gshopsev' + serverShopName[1] + '.data' : undefined;

    async function exportShop() {
        if (!serverShop || busy) return;
        await run(async () => {
            const path = await save({
                defaultPath: serverShop, filters: [{name: t("Server shop"), extensions: ['data']}],
            });
            if (!path) return;
            await apply();
            await invoke('gshop_export_server', {path});
            setStatus("Exported: " + path);
        });
    }

    return <section className={`elements-editor${embedded ? ' elements-embedded' : ''}`}
                    style={{display: visible ? 'flex' : 'none'}}>
        <header>{!embedded && <>
            <Button onClick={onBack}>{t("← Back")}</Button>
            <strong>PW Forge <span>/ elements.data</span></strong>
            <Button disabled={busy} onClick={onOpen}>{t("Open")}</Button>
        </>}
            <Button disabled={busy || !doc}
                    onClick={() => void saveFile(false)}>{t("Save")}{dirty || changed ? ' *' : ''}</Button>
            <Button disabled={busy || !doc} onClick={() => void saveFile(true)}>{t("Save as…")}</Button>
            {serverShop &&
                <Button disabled={busy} onClick={() => void exportShop()}>{t("Export ")}{serverShop}</Button>}
        </header>
        <Box className="elements-path">{doc?.path ?? ''} {doc?.gshop_version != null &&
            <span> · GShop v{doc.gshop_version}</span>} {doc && !shop &&
            <span>v{doc.elements_version} · {doc.encrypted ? 'XOR' : t("unencrypted")}</span>}</Box>
        {error && <Alert.Root status="error" size="sm"
                              role="alert"><Alert.Indicator/><Alert.Content>{message(error)}</Alert.Content></Alert.Root>}
        <main>
            <aside style={{width: categoryWidth}}><Field.Root width="auto"><Input aria-label={t("Find category")}
                                                                                  placeholder={t("Category…")}
                                                                                  value={category}
                                                                                  onChange={e => setCategory(e.target.value)}/></Field.Root>
                <nav>{shop && <>
                    <Button className={list === 0 && shopFilter.mainType === undefined ? 'selected' : ''}
                            disabled={busy}
                            onClick={() => void selectList(0)}>{t("All products")}</Button>
                    {shopCategories.map((item, mainType) => {
                        const name = categoryName(item.name, mainType);
                        const matchingSubs = item.subcategories.map((sub, subType) => ({
                            name: subcategoryName(sub, subType),
                            subType
                        }))
                            .filter(sub => sub.name.toLowerCase().includes(category.toLowerCase()));
                        if (!name.toLowerCase().includes(category.toLowerCase()) && !matchingSubs.length) return null;
                        return <Box key={mainType} className="shop-category">
                            <Button
                                className={list === 0 && shopFilter.mainType === mainType && shopFilter.subType === undefined ? 'selected' : ''}
                                disabled={busy} onClick={() => void selectList(0, {mainType})}>{name}</Button>
                            {(category || shopFilter.mainType === mainType) && <Box className="shop-subcategories">
                                {(category && !name.toLowerCase().includes(category.toLowerCase()) ? matchingSubs :
                                    item.subcategories.map((sub, subType) => ({
                                        name: subcategoryName(sub, subType),
                                        subType
                                    })))
                                    .map(sub => <Button key={sub.subType} disabled={busy}
                                                        className={list === 0 && shopFilter.mainType === mainType && shopFilter.subType === sub.subType ? 'selected' : ''}
                                                        onClick={() => void selectList(0, {
                                                            mainType,
                                                            subType: sub.subType
                                                        })}>{sub.name}</Button>)}
                            </Box>}
                        </Box>;
                    })}
                </>}
                    {shop ? <AccordionRoot collapsible defaultValue={list > 0 || undefined ? ["content"] : []}
                                           className="shop-category-names"><AccordionItem
                        value="content"><AccordionItemTrigger>{t("Category names")}</AccordionItemTrigger><AccordionItemContent>{shopCategories.map((item, i) =>
                        <Box key={i}>
                            <Button disabled={busy} className={list === i * 2 + 1 ? 'selected' : ''}
                                    onClick={() => void selectList(i * 2 + 1)}>
                                {categoryName(item.name, i)}
                            </Button>
                            {!!item.subcategories.length &&
                                <Button disabled={busy} className={list === i * 2 + 2 ? 'selected' : ''}
                                        onClick={() => void selectList(i * 2 + 2)}>{t("Subcategories ·")}{categoryName(item.name, i)}</Button>}
                        </Box>)}</AccordionItemContent></AccordionItem></AccordionRoot> : doc?.lists.map(([name, count], i) => name.toLowerCase().includes(category.toLowerCase()) &&
                        <Button key={i} className={list === i ? 'selected' : ''} disabled={busy}
                                onClick={() => void selectList(i)}>
                            <span>{message(name)}</span><small>{count.toLocaleString()}</small>
                        </Button>)}</nav>
            </aside>
            <ColumnDivider label={t("Category list width")}
                           onDelta={delta => setCategoryWidth(width => resizeWidth(width, delta, 110, 480))}/>
            <Box className="elements-records" style={{width: recordsWidth}}><Field.Root width="auto"><Input
                aria-label={t("Find records")}
                placeholder={t("ID or name…")}
                value={query} disabled={busy || !doc}
                onChange={e => {
                    setQuery(e.target.value);
                    setPage(0);
                }}/></Field.Root>
                <Box className={shop && list === 0 ? "elements-list shop-items" : "elements-list"}
                     style={{"--elements-id-width": `${idWidth}px`} as React.CSSProperties}>
                    <Box className="elements-list-columns">{shop && list === 0 &&
                        <span aria-hidden="true"/>}<code>ID</code><ColumnDivider label={t("ID column width")}
                                                                                 onDelta={delta => setIdWidth(width => resizeWidth(width, delta, 32, 260))}/><span>{t("Name")}</span>
                    </Box>
                    {rows.rows.map(r => <Button disabled={busy} key={r.index}
                                                ref={index === r.index ? selectedRow : undefined}
                                                className={index === r.index ? 'selected' : ''}
                                                onClick={() => void selectRecord(r.index)}>{shop && list === 0 &&
                        <InventoryIcon atlas={inventoryAtlas}
                                       id={r.id}/>}<code>{r.id}</code><span>{r.name || "Untitled"}</span></Button>)}
                </Box>
                <footer>
                    <Button disabled={busy || page === 0} onClick={() => setPage(v => v - 1)}>←</Button>
                    <span>{page + 1} / {Math.max(1, Math.ceil(rows.total / 200))} · {rows.total}</span>
                    <Button disabled={busy || (page + 1) * 200 >= rows.total} onClick={() => setPage(v => v + 1)}>→
                    </Button>
                </footer>
            </Box>
            <ColumnDivider label={t("Record list width")}
                           onDelta={delta => setRecordsWidth(width => resizeWidth(width, delta, 110, 520))}/>
            <article>{record ? <>
                <Box className="elements-field-toolbar"><strong>{doc?.lists[list][0]} / #{index}</strong>
                    <Button disabled={busy || !changed} onClick={() => void run(apply)}>{t("Apply record")}</Button>
                    <Button disabled={busy || !changed}
                            onClick={() => setDraft([...record.values])}>{t("Revert changes")}</Button>
                </Box>
                <Field.Root width="auto"><Input aria-label={t("Find field")} placeholder={t("Find a field…")}
                                                value={fieldQuery}
                                                onChange={e => setFieldQuery(e.target.value)}/></Field.Root>
                <Box className="elements-fields"
                     style={{"--elements-field-width": `${fieldWidth}px`} as React.CSSProperties}>{record.fields.map((f, i) => (!shop || !buyField.test(f.name)) && (f.name.toLowerCase().includes(fieldQuery.toLowerCase()) || (shop && shopFieldLabel(f.name).toLowerCase().includes(fieldQuery.toLowerCase()))) &&
                    <Box key={i}
                         className={draft[i] !== record.values[i] ? 'elements-field modified' : 'elements-field'}><span
                        title={shop ? f.name : undefined}>{shop ? shopFieldLabel(f.name) : f.name}<small>{f.kind}{!['gbk', 'utf16'].includes(f.kind) && f.size > f.unit ? ` [${f.size / f.unit}]` : ''}</small></span><ColumnDivider
                        label={t("Field name width")}
                        onDelta={delta => setFieldWidth(width => resizeWidth(width, delta, 65, 420))}/>
                        <Box
                            className="elements-field-value">{shop && list === 0 && (i === mainField || i === subField) ? shopTypeSelector(i) : shop && f.name === 'owner_npcs' && openItem ?
                            <Box className="shop-npc-links">{draft[i].split(',').map((part, npcIndex) => {
                                const label = `Vendor NPC ID ${npcIndex + 1}`;
                                const handleInputChange: ComponentProps<typeof Input>["onChange"] = event => {
                                    const value = event.target.value;
                                    if (!/^\d*$/.test(value) || Number(value) > 0xffffffff) return;
                                    setDraft(values => values.map((old, field) => field === i
                                        ? old.split(',').map((part, position) => position === npcIndex ? value : part.trim()).join(', ')
                                        : old));
                                };
                                return <Box key={npcIndex}>
                                    <Field.Root width="auto"><Input aria-label={label} inputMode="numeric"
                                                                    value={part.trim()} disabled={busy}
                                                                    onChange={handleInputChange}/></Field.Root>
                                    <RecordLink value={part} label={label} busy={busy} open={openItem} npc/>
                                </Box>;
                            })}</Box> : shop && f.name === 'desc' && f.kind === 'utf16' ?
                                <Box className="shop-description">
                                    <TaskColoredTextInput label={shopFieldLabel(f.name)} text={draft[i]} disabled={busy}
                                                          multiline
                                                          placeholder={itemDescription ? t("Custom product description") : t("This product has no description in gshop")}
                                                          maxLength={f.size / 2 - 1}
                                                          change={value => setDraft(values => values.map((old, field) => field === i ? value : old))}/>
                                    {!draft[i].trim() && itemDescription && <Box className="shop-description-fallback">
                                        <small>{t("Item description")}</small>
                                        <Box><GameText text={itemDescription}/></Box>
                                    </Box>}
                                </Box> : <Textarea aria-label={shop ? shopFieldLabel(f.name) : f.name} disabled={busy}
                                                   rows={Math.min(5, Math.max(1, Math.ceil(draft[i].length / 85)))}
                                                   spellCheck={false} value={draft[i]}
                                                   onChange={e => setDraft(v => v.map((x, n) => n === i ? e.target.value : x))}/>} {pickResource && isResourceField(f) &&
                            <Button type="button" className="resource-picker-button" title={t("Choose from tree")}
                                    aria-label={t("Choose file for {value0}", {value0: shop ? shopFieldLabel(f.name) : f.name})}
                                    disabled={busy}
                                    onClick={() => pickResource(f.name, isImageField(f.name) || isImageResource(draft[i].trim()), path => setDraft(values => values.map((value, n) => n === i ? path : value)))}>
                                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none"
                                     stroke="currentColor" strokeWidth="2">
                                    <path
                                        d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                                </svg>
                            </Button>}{shop && (f.name === 'item_id' || f.name === 'idGift') && openItem &&
                            <RecordLink value={draft[i]} label={shopFieldLabel(f.name)} busy={busy}
                                        open={openItem}/>}{openResource && isResourceField(f) &&
                            <Button type="button" className="resource-picker-button"
                                    title={t("Open file")}
                                    aria-label={t("Open file for {value0}", {value0: shop ? shopFieldLabel(f.name) : f.name})}
                                    disabled={busy || !draft[i].trim()} onClick={() => openResource(draft[i].trim())}>
                                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none"
                                     stroke="currentColor" strokeWidth="2">
                                    <path d="M5 19 19 5M8 5h11v11"/>
                                </svg>
                            </Button>}{visible && readImage && !(shop && f.name === "icon") && isResourceField(f) && isImageResource(draft[i].trim()) &&
                            <ResourceFieldPreview path={draft[i].trim()} read={readImage}/>}</Box>
                    </Box>)}{shop && list === 0 &&
                    <ShopSlots key={index} fields={record.fields} draft={draft} original={record.values}
                               query={fieldQuery} disabled={busy}
                               change={(field, value) => setDraft(values => values.map((old, i) => i === field ? value : old))}
                               resize={delta => setFieldWidth(width => resizeWidth(width, delta, 65, 420))}/>}</Box>
            </> : <Box className="elements-empty"></Box>}</article>
        </main>
        <Box className="elements-status" role="status">{busy ? t("Working…") : status}</Box>
    </section>;
}
