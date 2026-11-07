import {useEffect, useMemo, useState} from 'react';
import {Alert, Stack} from '@chakra-ui/react';
import {InterfaceEditor} from '../media/InterfaceEditor';
import {useResourceInvoke} from './resource-context';
import {dtfToXml, stfValues, xmlToDtf} from './dtf-adapter';
import {message} from '../../i18n';

export type DtfCompanion = { index: number; text: string; encoding: string; original: number[] };

export function DtfVisualEditor({text, fileName, entries, onChange, disabled, onOpen, onCompanion}: {
    text: string;
    fileName: string;
    entries: { name: string }[];
    onChange: (text: string) => void;
    disabled: boolean;
    onOpen: (file: string) => void;
    onCompanion: (data: DtfCompanion) => void
}) {
    const invoke = useResourceInvoke();
    const [companion, setCompanion] = useState<DtfCompanion | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
    useEffect(() => {
        let alive = true;
        const file = fileName.replace(/\.dtf$/i, '.stf').replace(/\\/g, '/').toLowerCase();
        const index = entries.findIndex(e => e.name.replace(/\\/g, '/').toLowerCase() === file);
        setCompanion(null);
        setLoading(true);
        if (index >= 0) void invoke<number[]>('read_entry', {index}).then(bytes => {
            const data = new Uint8Array(bytes);
            let encoding = data[0] === 255 && data[1] === 254 ? 'utf-16le' : data[0] === 254 && data[1] === 255 ? 'utf-16be' : 'gbk';
            if (!data.includes(0)) try {
                new TextDecoder('utf-8', {fatal: true}).decode(data);
                encoding = 'utf-8';
            } catch {
            }
            if (alive) {
                setCompanion({
                    index,
                    text: new TextDecoder(encoding, {ignoreBOM: true}).decode(data),
                    encoding,
                    original: bytes
                });
                setLoading(false);
            }
        }).catch(reason => {
            if (alive) {
                setError(String(reason));
                setLoading(false);
            }
        });
        else {
            setError('DTF string table not found');
            setLoading(false);
        }
        return () => {
            alive = false;
        };
    }, [fileName, entries]);
    const model = useMemo(() => {
        try {
            return {xml: dtfToXml(text, companion ? stfValues(companion.text) : {}).xml, error: ''};
        } catch (e) {
            return {xml: '', error: e instanceof Error ? e.message : String(e)};
        }
    }, [text, companion]);
    return <Stack h="full" minH="0" gap="0">{(error || model.error) && <Alert.Root
        status="error"><Alert.Content>{message(error || model.error)}</Alert.Content></Alert.Root>}{model.xml &&
        <InterfaceEditor text={model.xml} fileName={fileName} entries={entries} disabled={disabled || loading}
                         onOpenDialog={onOpen} onChange={xml => {
            try {
                const result = xmlToDtf(text, xml, model.xml, companion?.text ?? '');
                if (result.stf !== (companion?.text ?? '')) {
                    if (!companion) throw Error('DTF string table not found');
                    const next = {...companion, text: result.stf};
                    setCompanion(next);
                    onCompanion(next);
                }
                onChange(result.dtf);
                setError('');
            } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
            }
        }}/>}</Stack>;
}
