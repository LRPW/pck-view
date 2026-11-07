import {useMemo, useState} from 'react';
import {Button, Dialog, Field, Input, Portal, Stack, Text, Textarea} from '@chakra-ui/react';
import {save} from '@tauri-apps/plugin-dialog';
import {invoke} from '@tauri-apps/api/core';
import {message, t} from '../../i18n';
import {controllerName, generateController} from './controller-generator';

export function ControllerGenerator({xml, fileName}: { xml: string; fileName: string }) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState(() => controllerName(fileName));
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const generated = useMemo(() => {
        try {
            return {result: generateController(xml, name), error: ''};
        } catch (error) {
            return {result: null, error: String(error instanceof Error ? error.message : error)};
        }
    }, [xml, name]);

    async function exportFile(extension: 'h' | 'cpp') {
        if (!generated.result) return;
        setSaving(true);
        setError('');
        try {
            const path = await save({
                defaultPath: generated.result.stem + '.' + extension,
                filters: [{name: 'C++', extensions: [extension]}]
            });
            if (path) await invoke('ide_export_controller', {
                path,
                text: extension === 'h' ? generated.result.header : generated.result.source
            });
        } catch (error) {
            setError(String(error));
        } finally {
            setSaving(false);
        }
    }

    return <>
        <Button size="xs" variant="outline" onClick={() => setOpen(true)}>{t('Generate C++ controller')}</Button>
        <Dialog.Root open={open} size="xl" onOpenChange={event => setOpen(event.open)}>
            <Portal><Dialog.Backdrop/><Dialog.Positioner><Dialog.Content>
                <Dialog.Header><Dialog.Title>{t('Generate C++ controller')}</Dialog.Title></Dialog.Header>
                <Dialog.Body><Stack gap="3">
                    <Field.Root><Field.Label>{t('C++ class name')}</Field.Label><Input value={name}
                                                                                       onChange={event => setName(event.target.value)}/></Field.Root>
                    <Text fontSize="sm"
                          color="fg.muted">{t('Add the generated files to the client project and register the dialog class in EC_GameUIManDlgs.cpp.')}</Text>
                    {(generated.error || error) &&
                        <Text color="fg.error" role="alert">{message(generated.error || error)}</Text>}
                    {generated.result?.warnings.map(warning => <Text key={warning} color="fg.warning">{warning}</Text>)}
                    {generated.result && <>
                        <Field.Root><Field.Label>{generated.result.stem}.h</Field.Label><Textarea readOnly
                                                                                                  value={generated.result.header}
                                                                                                  h="220px"
                                                                                                  fontFamily="mono"
                                                                                                  fontSize="xs"/></Field.Root>
                        <Field.Root><Field.Label>{generated.result.stem}.cpp</Field.Label><Textarea readOnly
                                                                                                    value={generated.result.source}
                                                                                                    h="220px"
                                                                                                    fontFamily="mono"
                                                                                                    fontSize="xs"/></Field.Root>
                    </>}
                </Stack></Dialog.Body>
                <Dialog.Footer>
                    <Button disabled={!generated.result || saving}
                            onClick={() => void exportFile('h')}>{t('Save header')}</Button>
                    <Button disabled={!generated.result || saving}
                            onClick={() => void exportFile('cpp')}>{t('Save source')}</Button>
                    <Button variant="outline" onClick={() => setOpen(false)}>{t('Close')}</Button>
                </Dialog.Footer>
            </Dialog.Content></Dialog.Positioner></Portal>
        </Dialog.Root>
    </>;
}
