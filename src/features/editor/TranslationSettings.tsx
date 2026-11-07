import {t} from "../../i18n";
import {Alert, Button, Dialog, Field, Input, Portal, Select, Stack, Text, Textarea} from '@chakra-ui/react';
import {invoke} from '@tauri-apps/api/core';
import type {ComponentProps} from "react";
import {useEffect, useState} from 'react';
import {SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValueText} from "../../components/ui/select";
import {selectCollection} from './select-collection';

type Provider = 'deepl' | 'yandex' | 'ollama' | 'compatible';
export type Settings = {
    provider: Provider;
    endpoint: string;
    model: string;
    apiKey: string;
    source: string;
    glossary: string
};
const storageKey = 'pwforge:translation-settings';
const endpoints: Record<Provider, string> = {
    deepl: 'https://api-free.deepl.com',
    yandex: 'https://translate.api.cloud.yandex.net',
    ollama: 'http://127.0.0.1:11434/v1',
    compatible: 'https://api.openai.com/v1'
};

export function readTranslationSettings(): Settings {
    const defaults: Settings = {
        provider: 'ollama',
        endpoint: endpoints.ollama,
        model: '',
        apiKey: '',
        source: '',
        glossary: ''
    };
    try {
        const stored = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
        if (stored && Object.hasOwn(endpoints, stored.provider)) return {...defaults, ...stored, apiKey: ''};
    } catch {/* Invalid settings fall back to defaults. */
    }
    return defaults;
}

function loadKey(provider: Provider, endpoint: string) {
    return invoke<string | null>('ide_translation_key_load', {provider, endpoint});
}

export function useTranslationSettings() {
    const [settings, setSettings] = useState(readTranslationSettings);
    useEffect(() => {
        let current = true;
        const {provider, endpoint} = settings;
        void loadKey(provider, endpoint).then(key => {
            if (current && key) setSettings(old => old.provider === provider && old.endpoint === endpoint && !old.apiKey ? {
                ...old,
                apiKey: key
            } : old);
        }).catch(() => {
        });
        return () => {
            current = false;
        };
    }, []);
    useEffect(() => {
        const refresh = () => {
            const next = readTranslationSettings();
            setSettings(next);
            void loadKey(next.provider, next.endpoint).then(key => {
                setSettings(current => current.provider === next.provider && current.endpoint === next.endpoint
                    ? {...current, apiKey: key ?? ''} : current);
            }).catch(() => {
            });
        };
        const listener = (event: StorageEvent) => {
            if (event.key === storageKey) refresh();
        };
        window.addEventListener('storage', listener);
        return () => window.removeEventListener('storage', listener);
    }, []);
    return [settings, setSettings] as const;
}

export function TranslationSettings({settings, change, disabled, embedded = false}: {
    settings: Settings; change: (settings: Settings) => void; disabled?: boolean; embedded?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(settings);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [loadingKey, setLoadingKey] = useState(false);
    const [keyReadError, setKeyReadError] = useState('');
    const {provider, endpoint} = draft;
    useEffect(() => {
        if (!open && !embedded) return;
        let current = true;
        setLoadingKey(true);
        setKeyReadError('');
        void loadKey(provider, endpoint).then(key => {
            if (current && key) setDraft(old => old.provider === provider && old.endpoint === endpoint && !old.apiKey ? {
                ...old,
                apiKey: key
            } : old);
        }).catch(reason => {
            if (current) setKeyReadError(String(reason));
        })
            .finally(() => {
                if (current) setLoadingKey(false);
            });
        return () => {
            current = false;
        };
    }, [open, embedded, provider, endpoint]);
    const update = (field: keyof Settings, value: string) => setDraft(old => ({
        ...old,
        [field]: value, ...(field === 'endpoint' ? {apiKey: ''} : {})
    }));
    const save = async () => {
        if (saving || loadingKey || (keyReadError && !draft.apiKey.trim())) return;
        setSaving(true);
        setSaved(false);
        setError('');
        try {
            const {apiKey, ...publicSettings} = draft;
            const key = apiKey.trim();
            await invoke('ide_translation_key_store', {provider, endpoint, key: key || null});
            localStorage.setItem(storageKey, JSON.stringify(publicSettings));
            change({...publicSettings, apiKey: key});
            setSaved(true);
            setOpen(false);
        } catch (reason) {
            setError(String(reason));
        } finally {
            setSaving(false);
        }
    };
    const handleSelectRootValueChange: ComponentProps<typeof Select.Root>["onValueChange"] = async ({value: [value]}) => {
        const provider = value as Provider;
        setDraft(old => ({
            ...old,
            provider,
            endpoint: endpoints[provider],
            model: '',
            apiKey: '',
            glossary: ''
        }));
    };
    const form = <Stack gap="4">
        <Field.Root><Field.Label>{t("Provider")}</Field.Label>
            <SelectRoot size="sm" lazyMount unmountOnExit minW="140px" collection={selectCollection(<>
                <option value="ollama">{t("Ollama · local")}</option>
                <option value="deepl">DeepL</option>
                <option value="yandex">Yandex Translate</option>
                <option value="compatible">{t("OpenAI-compatible API")}</option>
            </>)} value={[String(draft.provider)]}
                        onValueChange={handleSelectRootValueChange}><SelectTrigger><SelectValueText/></SelectTrigger><SelectContent><Select.Context>{select => select.collection.items.map(item =>
                <SelectItem key={select.collection.getItemValue(item)}
                            item={item}>{t(select.collection.stringifyItem(item))}</SelectItem>)}</Select.Context></SelectContent></SelectRoot>
        </Field.Root>
        {draft.provider === 'deepl' ? <Field.Root><Field.Label>{t("DeepL plan")}</Field.Label>
            <SelectRoot size="sm" lazyMount unmountOnExit minW="140px" collection={selectCollection(<>
                <option value="https://api-free.deepl.com">API Free</option>
                <option value="https://api.deepl.com">API Pro</option>
            </>)} value={[String(draft.endpoint)]}
                        onValueChange={async ({value: [value]}) => update('endpoint', value)}><SelectTrigger><SelectValueText/></SelectTrigger><SelectContent><Select.Context>{select => select.collection.items.map(item =>
                <SelectItem key={select.collection.getItemValue(item)}
                            item={item}>{t(select.collection.stringifyItem(item))}</SelectItem>)}</Select.Context></SelectContent></SelectRoot>
        </Field.Root> : draft.provider === 'yandex' ? null : <>
            <Field.Root><Field.Label>{t("API base URL")}</Field.Label><Input size="sm" value={draft.endpoint}
                                                                             onChange={event => update('endpoint', event.target.value)}/></Field.Root>
            <Field.Root><Field.Label>{t("Model")}</Field.Label><Input size="sm" value={draft.model}
                                                                      onChange={event => update('model', event.target.value)}/></Field.Root>
        </>}
        <Field.Root><Field.Label>{t("API key")}</Field.Label><Input size="sm" type="password" autoComplete="off"
                                                                    value={draft.apiKey} disabled={loadingKey || saving}
                                                                    onChange={event => update('apiKey', event.target.value)}/>
            <Field.HelperText>{t("The key is stored in Windows Credential Manager. Clear this field and save to delete the key.")}</Field.HelperText>
        </Field.Root>
        <Field.Root><Field.Label>{t("Source language")}</Field.Label><Input size="sm" placeholder={t("Auto")}
                                                                            value={draft.source}
                                                                            onChange={event => update('source', event.target.value)}/></Field.Root>
        {draft.provider === 'deepl' ?
            <Field.Root><Field.Label>{t("Glossary ID")}</Field.Label><Input size="sm" value={draft.glossary}
                                                                            onChange={event => update('glossary', event.target.value)}/></Field.Root> :
            <Field.Root><Field.Label>{t(draft.provider === 'yandex' ? t("Glossary · term = translation") : t("Terms and instructions"))}</Field.Label><Textarea
                size="sm" rows={3} value={draft.glossary}
                onChange={event => update('glossary', event.target.value)}/></Field.Root>}
        {(error || keyReadError) && <Alert.Root status="error" size="sm"
                                                role="alert"><Alert.Indicator/><Alert.Content>{error || keyReadError}</Alert.Content></Alert.Root>}
    </Stack>;
    if (embedded) return <Stack gap="4">{form}<Button alignSelf="start" size="sm" loading={saving}
                                                      disabled={loadingKey || !!keyReadError && !draft.apiKey.trim()}
                                                      onClick={save}>{t("Save translation settings")}</Button>{saved &&
        <Text role="status" fontSize="sm" color="fg.muted">{t("Translation settings saved")}</Text>}</Stack>;
    const handleDialogRootOpenChange: ComponentProps<typeof Dialog.Root>["onOpenChange"] = event => {
        if (saving) return;
        if (event.open) {
            setDraft(settings);
            setError('');
        }
        setOpen(event.open);
    };
    return <Dialog.Root open={open} size="sm" placement="center" scrollBehavior="inside"
                        onOpenChange={handleDialogRootOpenChange}>
        <Dialog.Trigger asChild><Button size="sm" variant="outline"
                                        disabled={disabled}>{t("Translation settings")}</Button></Dialog.Trigger>
        <Portal>
            <Dialog.Backdrop/>
            <Dialog.Positioner>
                <Dialog.Content bg="bg.panel" color="fg" borderWidth="1px" borderColor="border">
                    <Dialog.Header><Dialog.Title>{t("Translation provider")}</Dialog.Title></Dialog.Header>
                    <Dialog.Body>{form}</Dialog.Body>
                    <Dialog.Footer>
                        <Dialog.CloseTrigger asChild><Button size="sm"
                                                             variant="outline">{t("Cancel")}</Button></Dialog.CloseTrigger>
                        <Button size="sm" loading={saving}
                                disabled={loadingKey || !!keyReadError && !draft.apiKey.trim()}
                                onClick={save}>{t("Save")}</Button>
                    </Dialog.Footer>
                </Dialog.Content>
            </Dialog.Positioner>
        </Portal>
    </Dialog.Root>;
}
