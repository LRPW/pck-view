import {t} from "../../i18n";
import {Box, Button} from "@chakra-ui/react";
import {invoke} from '@tauri-apps/api/core';
import {useState} from 'react';
import {notifications} from '../../app/notifications';
import type {Settings} from './TranslationSettings';

export function TranslateRow({segments, language, settings, disabled, accept}: {
    segments: { color: string | null; text: string }[]; language: string; settings: Settings;
    disabled: boolean; accept: (texts: string[]) => void;
}) {
    const [loading, setLoading] = useState(false);
    const [preview, setPreview] = useState<string[]>();

    async function translate() {
        if (loading || disabled) return;
        setLoading(true);
        setPreview(undefined);
        try {
            setPreview(await invoke<string[]>('ide_translate_row', {
                settings,
                target: language,
                texts: segments.map(part => part.text)
            }));
        } catch (reason) {
            notifications.create({type: 'error', title: t("Failed to translate row"), description: String(reason)});
        } finally {
            setLoading(false);
        }
    }

    return <>
        <Button size="xs" variant="outline" loading={loading} disabled={disabled}
                onClick={() => void translate()}>{t("Translate")}</Button>
        {preview && <Box className="locale-suggestion">
            <Box>{preview.map((text, index) => <span key={index}
                                                     style={{color: segments[index].color ? `#${segments[index].color}` : undefined}}>{text}</span>)}</Box>
            <Button size="xs" disabled={disabled} onClick={() => {
                accept(preview);
                setPreview(undefined);
            }}>{t("Fill empty fragments")}</Button>
            <Button size="xs" variant="outline" onClick={() => setPreview(undefined)}>{t("Close")}</Button>
        </Box>}
    </>;
}
