import {matchesShortcut} from '../../app/shortcuts';
import {message, t} from "../../i18n";
import {ActionBar, Alert, Box, Button, Field, Input, Portal, Textarea} from "@chakra-ui/react";
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import type {ComponentProps} from "react";
import {useEffect, useRef, useState} from 'react';
import {notifications} from '../../app/notifications';
import {AccordionItem, AccordionItemContent, AccordionItemTrigger, AccordionRoot} from "../../components/ui/accordion";
import {EditorProgress, EditorSkeleton} from './EditorLoading';
import {EditorSwitch} from './EditorSwitch';
import {LocaleBatchControls} from './LocaleBatchControls';
import './locales.css';
import {TranslateRow} from './TranslateRow';
import {TranslationSettings, useTranslationSettings} from './TranslationSettings';

type Part = { color: string | null; text: string };
const gameTokens = /\^[0-9a-fA-F]{6}|%(?:\d+\$)?[-+ #0]*(?:\d+|\*)?(?:\.(?:\d+|\*))?(?:I64|ll|[hlL])?[diuoxXfFeEgGaAcspn%]|\{\d+\}|\$\d+|\\[rnt]/gu;

function tokenSignature(text: string) {
    const tokens: string[] = [];
    for (const {0: token, index} of text.matchAll(gameTokens)) {
        // In "10% of", "% o" is part of prose, while "% d" can be a format specifier.
        if (/^% +[a-z]$/i.test(token)
            && /\d/.test(text.charAt(index - 1))
            && /[a-z]/i.test(text.charAt(index + token.length))) continue;
        tokens.push(token);
    }
    return JSON.stringify(tokens.sort());
}

type Row = { index: number; file: string; path: string; segments: Part[]; translation: Part[] | null };
type Page = { rows: Row[]; total: number | null; next: number | null; ready: boolean; path: string };
type BatchRows = { id: number; language: string; rows: number[]; texts: string[] };
const hasEmpty = (row: Row) => row.segments.some((part, i) => part.text.trim() && !row.translation?.[i]?.text);
const mergeRow = (row: Row, texts: string[]): Row => ({
    ...row,
    translation: row.segments.map((part, i) => ({
        ...part,
        text: row.translation?.[i]?.text || (part.text.trim() ? texts[i] ?? '' : '')
    })),
});
const newStream = () => ({pending: false, live: new Map<number, string[]>()});
type Change = { file: string; path: string; texts: string[] };
const keyOf = (row: Row) => JSON.stringify([row.file, row.path]);

export function LocaleEditor({id, active, revision, exporting, onExport, onApply, onDirty}: {
    id: number;
    active: boolean;
    revision: number;
    exporting: boolean;
    onExport: () => void;
    onDirty: (value: boolean) => void;
    onApply?: (language: string) => Promise<string[]>;
}) {
    const [language, setLanguage] = useState('ru');
    const [languageInput, setLanguageInput] = useState('ru');
    const [query, setQuery] = useState('');
    const [onlyEmpty, setOnlyEmpty] = useState(false);
    const [data, setData] = useState<Page>();
    const [changes, setChanges] = useState<Record<string, Change>>({});
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [moreError, setMoreError] = useState('');
    const viewport = useRef<HTMLDivElement>(null);
    const sentinel = useRef<HTMLDivElement>(null);
    const stream = useRef(newStream());
    const [saving, setSaving] = useState(false);
    const [reload, setReload] = useState(0);
    const [error, setError] = useState('');
    const [applyErrors, setApplyErrors] = useState<string[]>([]);
    const [translationSettings, setTranslationSettings] = useTranslationSettings();
    const [batchRunning, setBatchRunning] = useState(false);
    const dirty = Object.keys(changes).length > 0;
    useEffect(() => onDirty(dirty || saving || batchRunning), [dirty, saving, batchRunning, onDirty]);
    useEffect(() => {
        let current = true;
        const subscription = listen<BatchRows>('locale-batch-rows', ({payload}) => {
            if (!current || payload.id !== id || payload.language !== language) return;
            const rows = new Set(payload.rows);
            if (stream.current.pending) for (const index of rows) stream.current.live.set(index, payload.texts);
            setData(previous => previous && ({
                ...previous, rows: previous.rows.map(row =>
                    rows.has(row.index) ? mergeRow(row, payload.texts) : row).filter(row => !onlyEmpty || hasEmpty(row))
            }));
        });
        return () => {
            current = false;
            void subscription.then(unlisten => unlisten()).catch(() => {
            });
        };
    }, [id, language, onlyEmpty]);
    useEffect(() => {
        let current = true;
        const request = newStream();
        request.pending = true;
        stream.current = request;
        setData(undefined);
        setLoading(true);
        setLoadingMore(false);
        setMoreError('');
        setError('');
        const timer = setTimeout(() => {
            void invoke<Page>('ide_locale_page', {id, language, query, cursor: 0, onlyEmpty}).then(value => {
                if (current) setData({...value, rows: mergePage(value.rows, request.live)});
            }).catch(reason => {
                if (current) {
                    setData(undefined);
                    setError(String(reason));
                }
            }).finally(() => {
                request.pending = false;
                request.live.clear();
                if (current) setLoading(false);
            });
        }, query ? 150 : 0);
        return () => {
            current = false;
            stream.current = newStream();
            clearTimeout(timer);
        };
    }, [id, language, query, onlyEmpty, revision, reload]);

    function mergePage(rows: Row[], live: Map<number, string[]>) {
        return rows.map(row => {
            const texts = live.get(row.index);
            return texts ? mergeRow(row, texts) : row;
        }).filter(row => !onlyEmpty || hasEmpty(row));
    }

    async function loadMore() {
        const request = stream.current;
        if (!active || loading || saving || exporting || request.pending || !data?.ready || data.next === null) return;
        request.pending = true;
        setLoadingMore(true);
        setMoreError('');
        try {
            const next = await invoke<Page>('ide_locale_page', {id, language, query, cursor: data.next, onlyEmpty});
            if (stream.current !== request) return;
            const rows = mergePage(next.rows, request.live);
            setData(previous => previous && ({
                ...next,
                rows: [...previous.rows, ...rows],
            }));
        } catch (reason) {
            if (stream.current === request) setMoreError(String(reason));
        } finally {
            request.pending = false;
            request.live.clear();
            if (stream.current === request) setLoadingMore(false);
        }
    }

    useEffect(() => {
        if (!active || loading || loadingMore || saving || exporting || moreError || !sentinel.current || !viewport.current) return;
        const observer = new IntersectionObserver(([entry]) => {
                if (entry.isIntersecting) void loadMore();
            },
            {root: viewport.current, rootMargin: '900px 0px'});
        observer.observe(sentinel.current);
        return () => observer.disconnect();
    }, [active, data, loading, loadingMore, saving, exporting, moreError, id, language, query]);

    async function save() {
        if (!dirty || saving || exporting || batchRunning) return;
        setSaving(true);
        try {
            const path = await invoke<string>('ide_locale_save', {id, language, changes: Object.values(changes)});
            setData(previous => previous && ({
                ...previous, rows: previous.rows.map(row => {
                    const change = changes[keyOf(row)];
                    return change ? {
                        ...row,
                        translation: row.segments.map((part, index) => ({...part, text: change.texts[index]}))
                    } : row;
                })
            }));
            setChanges({});
            if (query.trim() || onlyEmpty) setReload(value => value + 1);
            notifications.create({type: 'success', title: t("Translation saved"), description: path});
        } catch (reason) {
            notifications.create({type: 'error', title: t("Failed to save translation"), description: String(reason)});
        } finally {
            setSaving(false);
        }
    }

    useEffect(() => {
        if (!active) return;
        const handle = (event: KeyboardEvent) => {
            if (matchesShortcut(event, 'save')) {
                event.preventDefault();
                void save();
            }
        };
        window.addEventListener('keydown', handle);
        return () => window.removeEventListener('keydown', handle);
    });

    function edit(row: Row, index: number, text: string) {
        const key = keyOf(row);
        const original = row.segments.map((_, i) => row.translation?.[i]?.text ?? '');
        setChanges(previous => {
            const texts = [...(previous[key]?.texts ?? original)];
            texts[index] = text;
            const next = {...previous};
            if (texts.every((value, i) => value === original[i])) delete next[key];
            else next[key] = {file: row.file, path: row.path, texts};
            return next;
        });
    }

    function acceptTranslation(row: Row, texts: string[]) {
        const key = keyOf(row);
        setChanges(previous => {
            const current = previous[key]?.texts ?? row.segments.map((_, i) => row.translation?.[i]?.text ?? '');
            const next = current.map((text, i) => text || (row.segments[i].text.trim() ? texts[i] : ''));
            return next.some((text, i) => text !== current[i]) ? {
                ...previous,
                [key]: {file: row.file, path: row.path, texts: next}
            } : previous;
        });
    }

    const handleFormSubmit: ComponentProps<"form">["onSubmit"] = event => {
        event.preventDefault();
        if (dirty || batchRunning || !/^([a-z][a-z0-9-]{0,23})$/i.test(languageInput) || languageInput.toLowerCase() === 'source') return;
        setLanguage(languageInput.toLowerCase());
    };
    return <section className="locale-editor">
        <header>
            <TranslationSettings settings={translationSettings} change={setTranslationSettings}
                                 disabled={batchRunning}/>
            <LocaleBatchControls id={id} language={language} settings={translationSettings}
                                 disabled={!data?.ready || loading || dirty || saving || exporting}
                                 onRunning={setBatchRunning} onFinished={() => setReload(value => value + 1)}/>
            <Button size="sm" disabled={!dirty || saving || exporting} onClick={() => void save()}>{t("Save")}</Button>
            {onApply &&
                <Button size="sm" disabled={!data?.ready || dirty || saving || loading || exporting || batchRunning}
                        onClick={() => {
                            setApplyErrors([]);
                            void onApply(language).then(setApplyErrors);
                        }}>{t("Apply translation")}</Button>}
            <form onSubmit={handleFormSubmit}>
                <Field.Root width="auto"><Input size="sm" aria-label={t("Locale code")} value={languageInput}
                                                onChange={event => setLanguageInput(event.target.value)}/></Field.Root>
                <Button size="sm" type="submit"
                        disabled={dirty || saving || batchRunning || languageInput.toLowerCase() === language}>{t("Open locale")}</Button>
            </form>
            <Field.Root width="auto"><Input size="sm" aria-label={t("Find text")} placeholder={t("Text or path…")}
                                            value={query}
                                            onChange={event => setQuery(event.target.value)}/></Field.Root>
            <EditorSwitch label={t("Empty entries only")} checked={onlyEmpty} change={setOnlyEmpty} showLabel/>
            {(saving || loading) && <EditorProgress label={t("Loading locale")}/>}
        </header>
        {error && <Alert.Root status="error" size="sm"
                              role="alert"><Alert.Indicator/><Alert.Content>{message(error)}</Alert.Content></Alert.Root>}
        {!!applyErrors.length && <AccordionRoot collapsible defaultValue={false ? ["content"] : []}
                                                className="locale-apply-errors"><AccordionItem
            value="content"><AccordionItemTrigger>{t("Skipped files · ")}{applyErrors.length}</AccordionItemTrigger><AccordionItemContent>
            <ul>{applyErrors.map(error => <li key={message(error)}>{message(error)}</li>)}</ul>
        </AccordionItemContent></AccordionItem></AccordionRoot>}
        {loading && !data && <EditorSkeleton/>}
        {data && !data.ready && !loading && <Box className="locale-empty">
            <Button size="sm" disabled={exporting} onClick={onExport}>{t("Export source texts")}</Button>
        </Box>}
        {data?.ready && <>
            <Box className="locale-rows" ref={viewport}>
                {data.rows.map(row => <section className="locale-row" key={keyOf(row)}>
                    <code title={`${row.file}#${row.path}`}>{row.file}#{row.path}</code>
                    <TranslateRow key={language} segments={row.segments} language={language}
                                  settings={translationSettings}
                                  disabled={saving || loading || exporting || batchRunning || !row.segments.some((part, i) =>
                                      part.text.trim() && !(changes[keyOf(row)]?.texts[i] ?? row.translation?.[i]?.text))}
                                  accept={texts => acceptTranslation(row, texts)}/>
                    {row.segments.map((part, index) => {
                        const text = changes[keyOf(row)]?.texts[index] ?? row.translation?.[index]?.text ?? '';
                        const needsReview = !!text && tokenSignature(part.text) !== tokenSignature(text);
                        return <Box className="locale-segment" key={index}>
                            <Box className="locale-original"
                                 style={{color: part.color ? `#${part.color}` : undefined}}>{part.text}</Box>
                            <Field.Root invalid={needsReview}>
                                <Textarea size="sm" rows={2}
                                          aria-label={t("Translation · fragment {value0}", {value0: index + 1})}
                                          value={text}
                                          disabled={saving || loading || exporting || batchRunning}
                                          onChange={event => edit(row, index, event.target.value)}/>
                                <Field.ErrorText>{t("Check placeholders and formatting codes.")}</Field.ErrorText>
                            </Field.Root>
                        </Box>;
                    })}
                </section>)}
                {data.next !== null && <Box ref={sentinel} className="locale-scroll-end">
                    {loadingMore && <EditorProgress label={t("Loading more rows")}/>}
                    {moreError && <><span role="alert">{message(moreError)}</span>
                        <Button size="xs" onClick={() => void loadMore()}>{t("Retry")}</Button></>}
                </Box>}
            </Box>
            <ActionBar.Root open={dirty}>
                <Portal><ActionBar.Positioner><ActionBar.Content>
                    <ActionBar.SelectionTrigger>{t("Changed records:")}{Object.keys(changes).length}</ActionBar.SelectionTrigger>
                    <ActionBar.Separator/>
                    <Button size="sm" loading={saving} disabled={exporting}
                            onClick={() => void save()}>{t("Save translations")}</Button>
                </ActionBar.Content></ActionBar.Positioner></Portal>
            </ActionBar.Root>
            <footer>
                <span>{data.rows.length.toLocaleString()}{data.total !== null && ` / ${data.total.toLocaleString()}`}</span>
                <code title={data.path}>{data.path}</code>
            </footer>
        </>}
    </section>;
}
