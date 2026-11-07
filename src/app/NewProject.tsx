import {ClientVersionField} from './ClientVersionField';
import {message, t} from "../i18n";
import {Alert, Box, Button, Field, Input} from "@chakra-ui/react";
import {invoke} from '@tauri-apps/api/core';
import {open} from '@tauri-apps/plugin-dialog';
import {useState} from 'react';
import {EditorSwitch} from '../features/editor/EditorSwitch';
import {useUnsavedGuard} from '../features/editor/unsaved';
import '../styles/ide.css';

export function NewProject({onCreated}: { onCreated: (path: string) => void }) {
    const [source, setSource] = useState(''), [parent, setParent] = useState(''), [name, setName] = useState('Project'), [archives, setArchives] = useState<{
        path: string;
        size: number
    }[]>([]), [selected, setSelected] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [clientVersion, setClientVersion] = useState('1.5.5-lrpw');
    useUnsavedGuard(t("Import"), busy);

    async function chooseSource() {
        const p = await open({directory: true, multiple: false});
        if (typeof p !== 'string') return;
        setBusy(true);
        try {
            setArchives(await invoke('project_scan', {source: p}));
            setSource(p);
            setSelected([]);
        } catch (e) {
            setError(String(e));
        } finally {
            setBusy(false);
        }
    }

    async function create() {
        setBusy(true);
        try {
            const p = await invoke<{ manifest: string }>('project_create', {
                source,
                parent,
                name,
                archives: selected,
                clientVersion
            });
            onCreated(p.manifest);
        } catch (e) {
            setError(String(e));
        } finally {
            setBusy(false);
        }
    }

    return <Box className="ide-new-project"><Field.Root width="auto"><Field.Label>{t("Name")}</Field.Label><Input
        disabled={busy} value={name}
        onChange={e => setName(e.target.value)}/></Field.Root>
        <ClientVersionField value={clientVersion} onChange={setClientVersion} disabled={busy}/>
        <Button disabled={busy} onClick={() => void chooseSource()}>{t("Client…")}</Button>
        <Box>{source}</Box>
        <Button disabled={busy} onClick={() => void (async () => {
            const p = await open({directory: true});
            if (typeof p === 'string') setParent(p);
        })()}>{t("Project directory…")}</Button>
        <Box>{parent}</Box>
        <Box>
            <Button disabled={busy} onClick={() => setSelected(archives.map(a => a.path))}>{t("Select all")}</Button>
            <Button disabled={busy} onClick={() => setSelected([])}>{t("Clear selection")}</Button>
        </Box>
        <Box className="ide-archive-selection">{archives.map(a => <Box className="ide-archive-option" key={a.path}>
            <EditorSwitch label={a.path} showLabel disabled={busy} checked={selected.includes(a.path)}
                          change={checked => setSelected(v => checked ? [...v, a.path] : v.filter(p => p !== a.path))}/><small>{(a.size / 1024 / 1024).toFixed(0)} MiB</small>
        </Box>)}</Box>
        <Button disabled={busy || !source || !parent || !name.trim()}
                onClick={() => void create()}>{t("Create")}</Button>
        {error && <Alert.Root status="error" size="sm"
                              role="alert"><Alert.Indicator/><Alert.Content>{message(error)}</Alert.Content></Alert.Root>}
    </Box>;
}
