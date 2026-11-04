import {useEffect, useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {Button, Dialog, Field, Input, NativeSelect, Portal, Stack, Text, Textarea} from '@chakra-ui/react';

type Provider = 'deepl' | 'yandex' | 'ollama' | 'compatible';
export type Settings = {provider:Provider;endpoint:string;model:string;apiKey:string;source:string;glossary:string};
const storageKey='pwforge:translation-settings';
const endpoints:Record<Provider,string>={deepl:'https://api-free.deepl.com',yandex:'https://translate.api.cloud.yandex.net',ollama:'http://127.0.0.1:11434/v1',compatible:'https://api.openai.com/v1'};

export function readTranslationSettings():Settings {
    const defaults:Settings={provider:'ollama',endpoint:endpoints.ollama,model:'',apiKey:'',source:'',glossary:''};
    try{
        const stored=JSON.parse(localStorage.getItem(storageKey)??'null');
        if(stored&&Object.hasOwn(endpoints,stored.provider))return {...defaults,...stored,apiKey:''};
    }catch{/* Invalid settings fall back to defaults. */}
    return defaults;
}

function loadKey(provider:Provider, endpoint:string){
    return invoke<string|null>('ide_translation_key_load',{provider,endpoint});
}

export function useTranslationSettings(){
    const [settings,setSettings]=useState(readTranslationSettings);
    useEffect(()=>{
        let current=true;
        const {provider,endpoint}=settings;
        void loadKey(provider,endpoint).then(key=>{
            if(current&&key)setSettings(old=>old.provider===provider&&old.endpoint===endpoint&&!old.apiKey?{...old,apiKey:key}:old);
        }).catch(()=>{});
        return ()=>{current=false;};
    },[]);
    return [settings,setSettings] as const;
}

export function TranslationSettings({settings,change,disabled}:{
    settings:Settings;change:(settings:Settings)=>void;disabled?:boolean;
}){
    const [open,setOpen]=useState(false);
    const [draft,setDraft]=useState(settings);
    const [error,setError]=useState('');
    const [saving,setSaving]=useState(false);
    const [loadingKey,setLoadingKey]=useState(false);
    const [keyReadError,setKeyReadError]=useState('');
    const {provider,endpoint}=draft;
    useEffect(()=>{
        if(!open)return;
        let current=true;
        setLoadingKey(true);
        setKeyReadError('');
        void loadKey(provider,endpoint).then(key=>{
            if(current&&key)setDraft(old=>old.provider===provider&&old.endpoint===endpoint&&!old.apiKey?{...old,apiKey:key}:old);
        }).catch(reason=>{if(current)setKeyReadError(String(reason));})
            .finally(()=>{if(current)setLoadingKey(false);});
        return ()=>{current=false;};
    },[open,provider,endpoint]);
    const update=(field:keyof Settings,value:string)=>setDraft(old=>({...old,[field]:value,...(field==='endpoint'?{apiKey:''}:{})}));
    const save=async()=>{
        if(saving||loadingKey||(keyReadError&&!draft.apiKey.trim()))return;
        setSaving(true);
        setError('');
        try{
            const {apiKey,...publicSettings}=draft;
            const key=apiKey.trim();
            await invoke('ide_translation_key_store',{provider,endpoint,key:key||null});
            localStorage.setItem(storageKey,JSON.stringify(publicSettings));
            change({...publicSettings,apiKey:key});
            setOpen(false);
        }catch(reason){setError(String(reason));}
        finally{setSaving(false);}
    };
    return <Dialog.Root open={open} size="sm" placement="center" scrollBehavior="inside" onOpenChange={event=>{
        if(saving)return;
        if(event.open){setDraft(settings);setError('');}
        setOpen(event.open);
    }}>
        <Dialog.Trigger asChild><Button size="sm" variant="outline" disabled={disabled}>Настройки перевода</Button></Dialog.Trigger>
        <Portal>
            <Dialog.Backdrop/>
            <Dialog.Positioner>
                <Dialog.Content bg="bg.panel" color="fg" borderWidth="1px" borderColor="border">
                    <Dialog.Header><Dialog.Title>Провайдер перевода</Dialog.Title></Dialog.Header>
                    <Dialog.Body><Stack gap="4">
                        <Field.Root><Field.Label>Провайдер</Field.Label>
                            <NativeSelect.Root size="sm"><NativeSelect.Field value={draft.provider} onChange={event=>{
                                const provider=event.target.value as Provider;
                                setDraft(old=>({...old,provider,endpoint:endpoints[provider],model:'',apiKey:'',glossary:''}));
                            }}>
                                <option value="ollama">Ollama · локально</option>
                                <option value="deepl">DeepL</option>
                                <option value="yandex">Yandex Translate</option>
                                <option value="compatible">OpenAI-совместимый API</option>
                            </NativeSelect.Field><NativeSelect.Indicator/></NativeSelect.Root>
                        </Field.Root>
                        {draft.provider==='deepl'?<Field.Root><Field.Label>Тариф DeepL</Field.Label>
                            <NativeSelect.Root size="sm"><NativeSelect.Field value={draft.endpoint} onChange={event=>update('endpoint',event.target.value)}>
                                <option value="https://api-free.deepl.com">API Free</option>
                                <option value="https://api.deepl.com">API Pro</option>
                            </NativeSelect.Field><NativeSelect.Indicator/></NativeSelect.Root>
                        </Field.Root>:draft.provider==='yandex'?null:<>
                            <Field.Root><Field.Label>Базовый URL API</Field.Label><Input size="sm" value={draft.endpoint} onChange={event=>update('endpoint',event.target.value)}/></Field.Root>
                            <Field.Root><Field.Label>Модель</Field.Label><Input size="sm" value={draft.model} onChange={event=>update('model',event.target.value)}/></Field.Root>
                        </>}
                        <Field.Root><Field.Label>Ключ API</Field.Label><Input size="sm" type="password" autoComplete="off" value={draft.apiKey} disabled={loadingKey||saving}
                            onChange={event=>update('apiKey',event.target.value)}/>
                            <Field.HelperText>Ключ хранится в Диспетчере учётных данных Windows. Очистите поле и сохраните, чтобы удалить ключ.</Field.HelperText>
                        </Field.Root>
                        <Field.Root><Field.Label>Исходный язык</Field.Label><Input size="sm" placeholder="Авто" value={draft.source} onChange={event=>update('source',event.target.value)}/></Field.Root>
                        {draft.provider==='deepl'?<Field.Root><Field.Label>ID словаря</Field.Label><Input size="sm" value={draft.glossary}
                            onChange={event=>update('glossary',event.target.value)}/></Field.Root>:
                            <Field.Root><Field.Label>{draft.provider==='yandex'?'Глоссарий · термин = перевод':'Термины и правила'}</Field.Label><Textarea size="sm" rows={3} value={draft.glossary}
                                onChange={event=>update('glossary',event.target.value)}/></Field.Root>}
                        {(error||keyReadError)&&<Text color="fg.error" role="alert">{error||keyReadError}</Text>}
                    </Stack></Dialog.Body>
                    <Dialog.Footer>
                        <Dialog.CloseTrigger asChild><Button size="sm" variant="outline">Отмена</Button></Dialog.CloseTrigger>
                        <Button size="sm" loading={saving} disabled={loadingKey||!!keyReadError&&!draft.apiKey.trim()} onClick={save}>Сохранить</Button>
                    </Dialog.Footer>
                </Dialog.Content>
            </Dialog.Positioner>
        </Portal>
    </Dialog.Root>;
}
