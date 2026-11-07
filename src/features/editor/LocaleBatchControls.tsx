import {t} from "../../i18n";
import {Button, HStack, Progress, Text} from '@chakra-ui/react';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {useEffect, useRef, useState} from 'react';
import {notifications} from '../../app/notifications';
import type {Settings} from './TranslationSettings';

type ProgressValue = {
    id: number;
    language: string;
    completed: number;
    total: number;
    translated: number;
    failed: number
};
type Outcome = { progress: ProgressValue; cancelled: boolean; error: string | null };
type Finished = { id: number; language: string; outcome: Outcome | null; error: string | null };

export function LocaleBatchControls({id, language, settings, disabled, onRunning, onFinished}: {
    id: number; language: string; settings: Settings; disabled: boolean;
    onRunning: (running: boolean) => void; onFinished: () => void;
}) {
    const [running, setRunning] = useState(false);
    const [stopping, setStopping] = useState(false);
    const [progress, setProgress] = useState<ProgressValue>();
    const started = useRef(false);
    const callbacks = useRef({onRunning, onFinished});
    callbacks.current = {onRunning, onFinished};

    function finish(outcome: Outcome | null, error: string | null) {
        setRunning(false);
        setStopping(false);
        callbacks.current.onRunning(false);
        callbacks.current.onFinished();
        if (outcome) setProgress(outcome.progress);
        const problem = error ?? outcome?.error;
        if (problem) {
            notifications.create({type: 'error', title: t("Batch translation stopped"), description: problem});
            return;
        }
        if (outcome) notifications.create({
            type: outcome.cancelled || outcome.progress.failed ? 'warning' : 'success',
            title: outcome.cancelled ? t("Translation stopped") : t("Batch translation completed"),
            description: t("Rows saved · {value0}. Skipped · {value1}", {
                value0: outcome.progress.translated.toLocaleString(),
                value1: outcome.progress.failed.toLocaleString()
            }),
        });
    }

    useEffect(() => {
        let alive = true;
        setProgress(undefined);
        const update = listen<ProgressValue>('locale-batch-progress', ({payload}) => {
            if (!alive || payload.id !== id || payload.language !== language) return;
            setProgress(payload);
            setRunning(true);
            callbacks.current.onRunning(true);
        });
        const done = listen<Finished>('locale-batch-finished', ({payload}) => {
            if (alive && !started.current && payload.id === id && payload.language === language) finish(payload.outcome, payload.error);
        });
        void invoke<ProgressValue | null>('ide_locale_batch_status', {id, language}).then(value => {
            if (alive && value) {
                setProgress(value);
                setRunning(true);
                callbacks.current.onRunning(true);
            }
        }).catch(() => {
        });
        return () => {
            alive = false;
            void update.then(stop => stop());
            void done.then(stop => stop());
        };
    }, [id, language]);

    async function start() {
        if (running || disabled) return;
        started.current = true;
        setRunning(true);
        setStopping(false);
        setProgress(undefined);
        callbacks.current.onRunning(true);
        try {
            finish(await invoke<Outcome>('ide_locale_batch_start', {id, language, settings}), null);
        } catch (reason) {
            finish(null, String(reason));
        } finally {
            started.current = false;
        }
    }

    async function stop() {
        setStopping(true);
        try {
            await invoke('ide_locale_batch_cancel', {id, language});
        } catch (reason) {
            setStopping(false);
            notifications.create({type: 'error', title: t("Failed to stop translation"), description: String(reason)});
        }
    }

    return <HStack gap="2">
        {running ? <Button size="sm" variant="outline" disabled={stopping} onClick={() => void stop()}>
            {stopping ? t("Stopping…") : t("Stop")}
        </Button> : <Button size="sm" disabled={disabled} onClick={() => void start()}>
            {progress && (progress.completed < progress.total || progress.failed > 0) ? t("Resume translation") : t("Translate empty entries")}
        </Button>}
        {running && <Progress.Root size="xs" colorPalette="teal" minW="80px" max={progress?.total || 100}
                                   value={progress?.total ? progress.completed : null}
                                   aria-label={t("Batch translation")}>
            <Progress.Track><Progress.Range/></Progress.Track>
        </Progress.Root>}
        {progress && <Text fontSize="xs" whiteSpace="nowrap">
            {progress.completed.toLocaleString()} / {progress.total.toLocaleString()}
            {!!progress.failed && t(" · skipped {value0}", {value0: progress.failed.toLocaleString()})}
        </Text>}
    </HStack>;
}
