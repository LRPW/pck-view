import {useState} from 'react';
import {Button} from '@chakra-ui/react';
import {invoke} from '@tauri-apps/api/core';
import {notifications} from '../../app/notifications';
import type {Settings} from './TranslationSettings';

export function TranslateRow({segments,language,settings,disabled,accept}:{
    segments:{color:string|null;text:string}[]; language:string; settings:Settings;
    disabled:boolean; accept:(texts:string[])=>void;
}){
    const [loading,setLoading]=useState(false);
    const [preview,setPreview]=useState<string[]>();
    async function translate(){
        if(loading||disabled)return;
        setLoading(true);
        setPreview(undefined);
        try{
            setPreview(await invoke<string[]>('ide_translate_row',{settings,target:language,texts:segments.map(part=>part.text)}));
        }catch(reason){
            notifications.create({type:'error',title:'Не удалось перевести строку',description:String(reason)});
        }finally{setLoading(false);}
    }
    return <>
        <Button size="xs" variant="outline" loading={loading} disabled={disabled}
            onClick={()=>void translate()}>Перевести</Button>
        {preview&&<div className="locale-suggestion">
            <div>{preview.map((text,index)=><span key={index}
                style={{color:segments[index].color?`#${segments[index].color}`:undefined}}>{text}</span>)}</div>
            <Button size="xs" disabled={disabled} onClick={()=>{accept(preview);setPreview(undefined);}}>Заполнить пустые фрагменты</Button>
            <Button size="xs" variant="outline" onClick={()=>setPreview(undefined)}>Закрыть</Button>
        </div>}
    </>;
}
