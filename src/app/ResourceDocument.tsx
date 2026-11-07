import type {DtfCompanion} from '../features/editor/DtfVisualEditor';
import {matchesShortcut} from './shortcuts';
import {message, t} from "../i18n";
import {Alert, Box, Button, Select} from "@chakra-ui/react";
import {invoke} from '@tauri-apps/api/core';
import {save} from '@tauri-apps/plugin-dialog';
import type {ComponentProps} from "react";
import {lazy, Suspense, useEffect, useMemo, useRef, useState} from 'react';
import {SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValueText} from "../components/ui/select";
import type {TextEditorHandle} from '../features/editor/TextEditor';
import {ResourceContext, resourceInvoke, type ResourceScope} from '../features/editor/resource-context';
import {selectCollection} from '../features/editor/select-collection';
import {serverExportName, writeServerList, writeWorldTargets} from '../features/editor/server-exports';
import {MediaPreview, mediaType} from '../features/media/MediaPreview';
import type {IdeHit} from '../features/search/IdeSearchWindow';
import '../styles/ide.css';
import type {Tab} from "./ide-types";
import {notifications} from './notifications';

const DtfVisualEditor = lazy(() => import('../features/editor/DtfVisualEditor').then(module => ({default: module.DtfVisualEditor})));
const LegacyInterfaceEditor = lazy(() => import('../features/editor/LegacyInterfaceEditor').then(module => ({default: module.LegacyInterfaceEditor})));
const DcfEditor = lazy(() => import('../features/editor/DcfEditor').then(module => ({default: module.DcfEditor})));
const TextEditor = lazy(() => import('../features/editor/TextEditor').then(module => ({default: module.TextEditor})));
const InterfaceEditor = lazy(() => import('../features/media/InterfaceEditor').then(module => ({default: module.InterfaceEditor})));
const NativeGfxPreview = lazy(() => import('../features/media/NativeGfxPreview').then(module => ({default: module.NativeGfxPreview})));

function decode(bytes: number[]) {
    const b = new Uint8Array(bytes);
    let encoding = 'utf-8';
    if (bytes[0] === 255 && bytes[1] === 254) encoding = 'utf-16le'; else if (bytes[0] === 254 && bytes[1] === 255) encoding = 'utf-16be'; else {
        try {
            new TextDecoder('utf-8', {fatal: true}).decode(b);
        } catch {
            encoding = 'gbk';
        }
    }
    return {encoding, text: new TextDecoder(encoding, {ignoreBOM: true}).decode(b)};
}

export function ResourceDocument({scope, tab, active, onDirty, onSaved, onOpen, onXmlDraft}: {
    scope: ResourceScope;
    tab: Tab;
    active: boolean;
    onDirty: (key: string, dirty: boolean) => void;
    onSaved: () => void;
    onXmlDraft?: (scope: number, index: number, text?: string) => void;
    onOpen: (name: string) => void
}) {
    const name = tab.resource ?? scope.entries[tab.index!]?.name ?? tab.title;
    const exportName = serverExportName(name);
    const [exporting, setExporting] = useState(false);
    const [bytes, setBytes] = useState<number[]>([]), [text, setText] = useState(''), [saved, setSaved] = useState(''), [encoding, setEncoding] = useState('utf-8'), [loading, setLoading] = useState(true), [error, setError] = useState('');
    const isNative = /\.(gfx|mox|ecm|smd|ski|bon)$/i.test(name), isXml = /\.xml$/i.test(name),
        isDcf = /\.dcf$/i.test(name), legacyFormat = name.match(/\.(stf|htf|dtf)$/i)?.[1].toLowerCase(),
        isMedia = !!mediaType(name);
    const isText = /\.(txt|stf|htf|dtf|dcf|xml|ini|cfg|lua|json|csv|log|fx|vsh|psh|hlsl|html|css|js|md|properties)$/i.test(name);
    const [mode, setMode] = useState(isNative || isXml || isMedia || isDcf || legacyFormat ? 'preview' : isText ? 'text' : 'hex');
    const [editor, setEditor] = useState<TextEditorHandle | null>(null);
    const appliedJump = useRef<IdeHit['hit'] | undefined>(undefined);
    useEffect(() => {
        if (!tab.jump || !active || loading) return;
        if (text === saved && (encoding !== tab.jump.encoding || (!isText && !text))) {
            const value = new TextDecoder(tab.jump.encoding, {ignoreBOM: true}).decode(new Uint8Array(bytes));
            setEncoding(tab.jump.encoding);
            setText(value);
            setSaved(value);
        }
        setMode('text');
    }, [tab.jump, active, loading]);
    useEffect(() => {
        const jump = tab.jump;
        if (!jump || appliedJump.current === jump || !active || loading || mode !== 'text' || !editor) return;
        if (text === saved && (encoding !== jump.encoding || (!isText && !text && bytes.length > 0))) return;
        editor.reveal(jump.start, jump.end);
        appliedJump.current = jump;
    }, [tab.jump, active, loading, mode, text, saved, encoding, isText, bytes.length, editor]);
    const [dtfCompanion, setDtfCompanion] = useState<DtfCompanion | null>(null);
    const [savedCompanion, setSavedCompanion] = useState('');
    const dirty = text !== saved || !!dtfCompanion && dtfCompanion.text !== savedCompanion;
    const onOpenRef = useRef(onOpen);
    onOpenRef.current = onOpen;
    const boundInvoke = useMemo(() => resourceInvoke(scope, n => onOpenRef.current(n)), [scope.id]);
    const context = useMemo(() => ({
        invoke: boundInvoke,
        active,
        clientVersion: scope.clientVersion
    }), [boundInvoke, active, scope.clientVersion]);
    useEffect(() => {
        let alive = true;
        setLoading(true);
        const p = tab.resource ? invoke<number[]>('ide_resource', {
            id: scope.id,
            name: tab.resource
        }) : invoke<number[]>('ide_read', {id: scope.id, index: tab.index});
        void p.then(data => {
            if (!alive) return;
            const d = isText ? decode(data) : {encoding: "gbk", text: ""};
            setBytes(data);
            setEncoding(d.encoding);
            setSaved(d.text);
            setText(d.text);
            setLoading(false);
        }).catch(e => {
            if (alive) {
                setError(String(e));
                setLoading(false);
            }
        });
        return () => {
            alive = false;
        };
    }, [scope.id, tab.index, tab.resource]);
    useEffect(() => {
        if (!isXml || tab.index === undefined || !onXmlDraft) return;
        const index = tab.index;
        onXmlDraft(scope.id, index, text !== saved ? text : undefined);
        return () => onXmlDraft(scope.id, index);
    }, [isXml, scope.id, tab.index, text, saved, onXmlDraft]);
    useEffect(() => onDirty(tab.key, dirty), [dirty, onDirty, tab.key]);

    async function saveFile() {
        if (tab.index === undefined) return;
        setLoading(true);
        try {
            if (dtfCompanion && dtfCompanion.text !== savedCompanion) {
                await invoke('ide_save', {
                    id: scope.id,
                    index: dtfCompanion.index,
                    text: dtfCompanion.text,
                    encoding: dtfCompanion.encoding,
                    original: dtfCompanion.original
                });
                const original = await invoke<number[]>('ide_read', {id: scope.id, index: dtfCompanion.index});
                setDtfCompanion({...dtfCompanion, original});
                setSavedCompanion(dtfCompanion.text);
            }
            await invoke('ide_save', {id: scope.id, index: tab.index, text, encoding, original: bytes});
            const b = await invoke<number[]>('ide_read', {id: scope.id, index: tab.index});
            setBytes(b);
            setSaved(text);
            onSaved();
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (!active) return;
        const handler = (e: KeyboardEvent) => {
            if (matchesShortcut(e, 'save')) {
                e.stopPropagation();
                e.preventDefault();
                if (dirty && !loading) void saveFile();
            }
        };
        const menuSave = () => {
            if (dirty && !loading) void saveFile();
        };
        window.addEventListener('pw-forge-save', menuSave);
        window.addEventListener('keydown', handler, true);
        return () => {
            window.removeEventListener('keydown', handler, true);
            window.removeEventListener('pw-forge-save', menuSave);
        };
    });

    async function exportServer() {
        if (!exportName || exporting || loading) return;
        setExporting(true);
        setError('');
        try {
            const data = exportName === 'world_targets.sev' ? writeWorldTargets(text) : writeServerList(text);
            const path = await save({defaultPath: exportName, filters: [{name: 'SEV', extensions: ['sev']}]});
            if (!path) return;
            await invoke('ide_export_server_data', {path, bytes: Array.from(data)});
            notifications.create({type: 'success', title: t("Exported"), description: exportName});
        } catch (error) {
            setError(String(error));
        } finally {
            setExporting(false);
        }
    }

    const hex = useMemo(() => Array.from({length: Math.ceil(Math.min(bytes.length, 65536) / 16)}, (_, i) => `${(i * 16).toString(16).padStart(8, '0')}  ${bytes.slice(i * 16, i * 16 + 16).map(b => b.toString(16).padStart(2, '0')).join(' ')}`).join('\n'), [bytes]);
    const handleButtonClick: ComponentProps<typeof Button>["onClick"] = () => {
        if (!isText && !text) {
            const d = decode(bytes);
            setText(d.text);
            setSaved(d.text);
            setEncoding(d.encoding);
        }
        setMode('text');
    };
    const handleSelectRootValueChange: ComponentProps<typeof Select.Root>["onValueChange"] = async ({value: [value]}) => {
        if (dirty) return;
        setEncoding(value);
        const s = new TextDecoder(value, {ignoreBOM: true}).decode(new Uint8Array(bytes));
        setText(s);
        setSaved(s);
    };
    return <ResourceContext.Provider value={context}>
        <Box className="ide-resource">
            <Box className="ide-document-toolbar"><span
                title={name}>{name}</span>{(isNative || isXml || isMedia || isDcf || legacyFormat) &&
                <Button onClick={() => setMode('preview')}>{t("Preview")}</Button>}
                <Button onClick={handleButtonClick}>{t("Text")}</Button>
                <Button onClick={() => setMode('hex')}>HEX</Button>
                <SelectRoot size="sm" lazyMount unmountOnExit minW="140px" collection={selectCollection(<>
                    <option value="utf-8">UTF-8</option>
                    <option value="gbk">GBK</option>
                    <option value="utf-16le">UTF-16 LE</option>
                    <option value="utf-16be">UTF-16 BE</option>
                </>)} value={[String(encoding)]}
                            onValueChange={handleSelectRootValueChange}><SelectTrigger><SelectValueText/></SelectTrigger><SelectContent><Select.Context>{select => select.collection.items.map(item =>
                    <SelectItem key={select.collection.getItemValue(item)}
                                item={item}>{t(select.collection.stringifyItem(item))}</SelectItem>)}</Select.Context></SelectContent></SelectRoot>
                {exportName && <Button size="xs" variant="outline" disabled={loading} loading={exporting}
                                       onClick={() => void exportServer()}>{t("Export ")}{exportName}</Button>}
                <Button disabled={loading || !dirty || tab.index === undefined}
                        onClick={() => void saveFile()}>{t("Save")}</Button>
            </Box>
            {error && <Alert.Root status="error" size="sm"
                                  role="alert"><Alert.Indicator/><Alert.Content>{message(error)}</Alert.Content></Alert.Root>}{loading &&
            <Box className="ide-loading">…</Box>}
            <Box className="ide-document-body">
                <Suspense fallback={<Box className="ide-loading"
                                         role="status">{t('Loading…')}</Box>}>{mode === 'preview' && legacyFormat === 'dtf' ?
                    <DtfVisualEditor
                        onCompanion={data => setDtfCompanion(current => ({
                            ...data,
                            original: current?.index === data.index ? current.original : data.original
                        }))} text={text} fileName={name} entries={scope.entries} onChange={setText} onOpen={onOpen}
                        disabled={loading || !active}/> : mode === 'preview' && legacyFormat ?
                        <LegacyInterfaceEditor text={text} format={legacyFormat} onChange={setText}
                                               disabled={loading || !active}/> : mode === 'preview' && isDcf ?
                            <DcfEditor entries={scope.entries} text={text} onChange={setText} onOpen={onOpen}
                                       disabled={loading || !active}/> : mode === 'preview' && isNative ?
                                <NativeGfxPreview file={name}/> : mode === 'preview' && isXml ?
                                    <InterfaceEditor text={text} fileName={name} entries={scope.entries}
                                                     onChange={setText}
                                                     disabled={loading || !active}
                                                     onOpenDialog={onOpen}/> : mode === 'preview' && isMedia ?
                                        <MediaPreview name={name} bytes={bytes}/> : mode === 'hex' ?
                                            <pre className="ide-hex">{hex}</pre> :
                                            <TextEditor ref={setEditor} value={text} fileName={name}
                                                        readOnly={loading || !active}
                                                        onChange={setText}/>}
                </Suspense>
            </Box>
        </Box>
    </ResourceContext.Provider>;
}
