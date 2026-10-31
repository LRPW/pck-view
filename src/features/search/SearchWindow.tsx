import {message, t, useLanguage} from '../../i18n/index';
import React, {useEffect, useRef, useState} from 'react';
import {Box, Button, Flex, Input, Text} from '@chakra-ui/react';
import {emitTo, listen} from '@tauri-apps/api/event';
import {getCurrentWindow} from '@tauri-apps/api/window';

export type SearchHit = {
    index: number;
    line: number;
    column: number;
    start: number;
    end: number;
    before: string;
    matched: string;
    after: string;
    encoding: string
};
export type SearchSnapshot = {
    contentQuery: string;
    regexp: boolean;
    caseSensitive: boolean;
    wholeWord: boolean;
    searchEncoding: string;
    includeBinary: boolean;
    matches?: SearchHit[];
    searchErrors: string[];
    activeHit: number;
    truncated: boolean;
    busy: boolean;
    searching: boolean;
    cancelling: boolean;
    searchProgress?: { stage: string; completed: number; total: number };
    archive?: { entries: Record<number, { name: string }> }
};
export type SearchAction = { action: string; value?: string | number | boolean };

export function SearchWindow() {
    const language = useLanguage();
    useEffect(() => {
        void getCurrentWindow().setTitle(t('Поиск в файлах') + ' — LRPW | PCK View');
    }, [language]);
    const [snapshot, setSnapshot] = useState<SearchSnapshot>();
    const [draftQuery, setDraftQuery] = useState<string>();
    const searchInput = useRef<HTMLInputElement>(null);
    const send = (action: string, value?: string | number | boolean) => {
        void emitTo('main', 'search-action', {action, value});
    };
    useEffect(() => {
        let mounted = true;
        const listener = listen<SearchSnapshot>('search-state', event => {
            if (mounted) setSnapshot(event.payload);
        });
        void listener.then(() => {
            if (mounted) send('ready');
        });
        return () => {
            mounted = false;
            void listener.then(fn => fn());
        };
    }, []);
    useEffect(() => {
        const key = (event: KeyboardEvent) => {
            if (event.code === 'Escape') {
                event.preventDefault();
                void getCurrentWindow().hide();
            }
            if (event.code === 'F3') {
                event.preventDefault();
                send(event.shiftKey ? 'previous' : 'next');
            }
            if (event.ctrlKey && event.shiftKey && event.code === 'KeyF') {
                event.preventDefault();
                searchInput.current?.focus();
                searchInput.current?.select();
            }
        };
        window.addEventListener('keydown', key);
        return () => window.removeEventListener('keydown', key);
    }, []);
    useEffect(() => {
        searchInput.current?.focus();
    }, [snapshot !== undefined]);
    if (!snapshot) return <Text p="4">{t("Загрузка…")}</Text>;
    const {
        contentQuery,
        regexp,
        caseSensitive,
        wholeWord,
        searchEncoding,
        includeBinary,
        matches,
        searchErrors,
        activeHit,
        truncated,
        busy,
        searching,
        cancelling,
        searchProgress,
        archive
    } = snapshot;
    const setContentQuery = (v: string) => send('contentQuery', v), setRegexp = (v: boolean) => send('regexp', v),
        setCaseSensitive = (v: boolean) => send('caseSensitive', v),
        setWholeWord = (v: boolean) => send('wholeWord', v),
        setSearchEncoding = (v: string) => send('searchEncoding', v),
        setIncludeBinary = (v: boolean) => send('includeBinary', v);
    const searchContents = () => send('search'), cancelSearch = () => send('cancel'),
        openHit = (v: number) => send('hit', v);
    return <div className="native-search"><Box className="find-panel">

        <Input ref={searchInput} disabled={busy || searching} placeholder={t("Текст или регулярное выражение…")}
               value={draftQuery ?? contentQuery} onChange={e => {
            setDraftQuery(e.target.value);
            setContentQuery(e.target.value);
        }} onKeyDown={e => {
            if (e.key === 'Enter' && !busy && !searching && archive && contentQuery) void searchContents();
        }}/>
        <Flex gap="3" wrap="wrap" my="2" fontSize="xs">
            <label><input type="checkbox" disabled={busy || searching} checked={includeBinary}
                          onChange={e => setIncludeBinary(e.target.checked)}/>{t("Включая бинарные")}
            </label><label><input
            type="checkbox" disabled={busy || searching} checked={regexp}
            onChange={e => setRegexp(e.target.checked)}/> Regexp</label>
            <label><input type="checkbox" disabled={busy || searching} checked={caseSensitive}
                          onChange={e => setCaseSensitive(e.target.checked)}/>{t("Учитывать регистр")}</label>
            <label><input type="checkbox" disabled={busy || searching} checked={wholeWord}
                          onChange={e => setWholeWord(e.target.checked)}/>{t("Целое слово")}</label>
        </Flex>
        <Flex gap="2"><select aria-label={t("Кодировка поиска")} disabled={busy || searching} value={searchEncoding}
                              onChange={e => setSearchEncoding(e.target.value)}>
            <option value="auto">{t("Авто")}</option>
            <option value="utf-8">UTF-8</option>
            <option value="gbk">GBK</option>
            <option value="utf-16le">UTF-16 LE</option>
            <option value="utf-16be">UTF-16 BE</option>
        </select><Button size="sm" disabled={busy || searching || !archive || !contentQuery}
                         onClick={searchContents}>{t("Найти")}</Button>{searching &&
            <Button size="sm" colorPalette="red" disabled={cancelling}
                    onClick={cancelSearch}>{cancelling ? t("Отмена…") : t("Остановить")}</Button>}</Flex>
        {searching && <><Text
            fontSize="xs">{(searchProgress?.stage ? message(searchProgress.stage) : undefined) ?? t("Подготовка…")} · {searchProgress?.completed ?? 0} / {searchProgress?.total ?? 0}</Text>
            <progress className="operation-progress" max={searchProgress?.total || 1}
                      value={searchProgress && searchProgress.total > 0 ? searchProgress.completed : undefined}/>
        </>}{searchErrors.length > 0 && <details>
        <summary>{t("Ошибки чтения:")} {searchErrors.length}</summary>
        <Box maxH="120px" overflow="auto" fontSize="xs" wordBreak="break-all">{searchErrors.map((error, i) => <Text
            key={i}>{message(error)}</Text>)}</Box></details>}{matches !== undefined && <><Flex gap="3" align="center"
                                                                                                py="2"><Text
        fontSize="sm">{matches.length} {t("совпадений в")} {new Set(matches.map(hit => hit.index)).size} {t("файлах")}{truncated ? t(' · показаны первые 5000') : ''}</Text><Button
        size="xs" disabled={busy || !matches.length}
        onClick={() => openHit((activeHit - 1 + matches.length) % matches.length)}>↑ Shift+F3</Button><Button size="xs"
                                                                                                              disabled={busy || !matches.length}
                                                                                                              onClick={() => openHit((activeHit + 1) % matches.length)}>↓
        F3</Button></Flex><Box className="find-results" role="list"
                               aria-label={t("Результаты поиска")}>{matches.length === 0 ?
        <Text p="3">{searching ? t("Поиск…") : t("Совпадений нет")}</Text> : matches.map((hit, i) => <React.Fragment
            key={i}>{(i === 0 || matches[i - 1].index !== hit.index) &&
            <div className="find-file">{archive?.entries[hit.index]?.name}</div>}
            <button role="listitem" className={'find-hit' + (activeHit === i ? ' active' : '')} disabled={busy}
                    onClick={() => openHit(i)} title={t("Перейти к совпадению")}><span
                className="find-location">{hit.line}:{hit.column}</span><code>{hit.before}
                <mark>{hit.matched || '∅'}</mark>
                {hit.after}</code></button>
        </React.Fragment>)}</Box></>}
    </Box>
    </div>;
}
