import {matchesShortcut} from '../../app/shortcuts';
import {Box, Button, Field, Flex, Input, Select, Switch, Text} from '@chakra-ui/react';
import {emitTo, listen} from '@tauri-apps/api/event';
import {getCurrentWindow} from '@tauri-apps/api/window';
import React, {useEffect, useRef, useState} from 'react';
import {AccordionItem, AccordionItemContent, AccordionItemTrigger, AccordionRoot} from "../../components/ui/accordion";
import {ProgressBar, ProgressRoot} from "../../components/ui/progress";
import {SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValueText} from "../../components/ui/select";
import {message, t, useLanguage} from '../../i18n/index';
import {selectCollection} from '../editor/select-collection';

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
        void getCurrentWindow().setTitle(t("Find in Files") + ' — PW Forge');
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
            if (matchesShortcut(event, 'next') || matchesShortcut(event, 'previous')) {
                event.preventDefault();
                send(matchesShortcut(event, 'previous') ? 'previous' : 'next');
            }
            if (matchesShortcut(event, 'search')) {
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
    if (!snapshot) return <Text p="4">{t("Loading…")}</Text>;
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
    return <Box className="native-search"><Box className="find-panel">

        <Field.Root width="auto"><Input ref={searchInput} disabled={busy || searching}
                                        placeholder={t("Text or regular expression…")}
                                        value={draftQuery ?? contentQuery} onChange={e => {
            setDraftQuery(e.target.value);
            setContentQuery(e.target.value);
        }} onKeyDown={e => {
            if (e.key === 'Enter' && !busy && !searching && archive && contentQuery) void searchContents();
        }}/></Field.Root>
        <Flex gap="3" wrap="wrap" my="2" fontSize="xs">
            <Switch.Root size="sm" colorPalette="teal" disabled={busy || searching} checked={includeBinary}
                         onCheckedChange={({checked}) => setIncludeBinary(checked)}><Switch.HiddenInput/><Switch.Control><Switch.Thumb/></Switch.Control><Switch.Label>{t("Include binary files")}</Switch.Label></Switch.Root><Switch.Root
            size="sm" colorPalette="teal" disabled={busy || searching} checked={regexp}
            onCheckedChange={({checked}) => setRegexp(checked)}><Switch.HiddenInput/><Switch.Control><Switch.Thumb/></Switch.Control><Switch.Label>Regexp</Switch.Label></Switch.Root>
            <Switch.Root size="sm" colorPalette="teal" disabled={busy || searching} checked={caseSensitive}
                         onCheckedChange={({checked}) => setCaseSensitive(checked)}><Switch.HiddenInput/><Switch.Control><Switch.Thumb/></Switch.Control><Switch.Label>{t("Match case")}</Switch.Label></Switch.Root>
            <Switch.Root size="sm" colorPalette="teal" disabled={busy || searching} checked={wholeWord}
                         onCheckedChange={({checked}) => setWholeWord(checked)}><Switch.HiddenInput/><Switch.Control><Switch.Thumb/></Switch.Control><Switch.Label>{t("Whole words")}</Switch.Label></Switch.Root>
        </Flex>
        <Flex gap="2"><SelectRoot size="sm" lazyMount unmountOnExit minW="140px" collection={selectCollection(<>
            <option value="auto">{t("Auto")}</option>
            <option value="utf-8">UTF-8</option>
            <option value="gbk">GBK</option>
            <option value="utf-16le">UTF-16 LE</option>
            <option value="utf-16be">UTF-16 BE</option>
        </>)} value={[String(searchEncoding)]} onValueChange={async ({value: [value]}) => setSearchEncoding(value)}
                                  aria-label={t("Search encoding")}
                                  disabled={busy || searching}><SelectTrigger><SelectValueText/></SelectTrigger><SelectContent><Select.Context>{select => select.collection.items.map(item =>
            <SelectItem key={select.collection.getItemValue(item)}
                        item={item}>{t(select.collection.stringifyItem(item))}</SelectItem>)}</Select.Context></SelectContent></SelectRoot><Button
            size="sm" disabled={busy || searching || !archive || !contentQuery}
            onClick={searchContents}>{t("Find")}</Button>{searching &&
            <Button size="sm" colorPalette="red" disabled={cancelling}
                    onClick={cancelSearch}>{cancelling ? t("Cancelling…") : t("Stop")}</Button>}</Flex>
        {searching && <><Text
            fontSize="xs">{(searchProgress?.stage ? message(searchProgress.stage) : undefined) ?? t("Preparing…")} · {searchProgress?.completed ?? 0} / {searchProgress?.total ?? 0}</Text>
            <ProgressRoot className="operation-progress" max={searchProgress?.total || 1}
                          value={searchProgress && searchProgress.total > 0 ? searchProgress.completed : undefined}><ProgressBar/></ProgressRoot>
        </>}{searchErrors.length > 0 &&
        <AccordionRoot collapsible defaultValue={false ? ["content"] : []}><AccordionItem
            value="content"><AccordionItemTrigger>{t("Read errors:")}{searchErrors.length}</AccordionItemTrigger><AccordionItemContent><Box
            maxH="120px" overflow="auto" fontSize="xs" wordBreak="break-all">{searchErrors.map((error, i) => <Text
            key={i}>{message(error)}</Text>)}</Box></AccordionItemContent></AccordionItem></AccordionRoot>}{matches !== undefined && <>
        <Flex gap="3" align="center"
              py="2"><Text
            fontSize="sm">{matches.length} {t("matches in")} {new Set(matches.map(hit => hit.index)).size} {t("files")}{truncated ? t(" · first 5000 shown") : ''}</Text><Button
            size="xs" disabled={busy || !matches.length}
            onClick={() => openHit((activeHit - 1 + matches.length) % matches.length)}>↑ Shift+F3</Button><Button
            size="xs"
            disabled={busy || !matches.length}
            onClick={() => openHit((activeHit + 1) % matches.length)}>↓
            F3</Button></Flex><Box className="find-results" role="list"
                                   aria-label={t("Search results")}>{matches.length === 0 ?
        <Text p="3">{searching ? t("Searching…") : t("No matches")}</Text> : matches.map((hit, i) => <React.Fragment
            key={i}>{(i === 0 || matches[i - 1].index !== hit.index) &&
            <Box className="find-file">{archive?.entries[hit.index]?.name}</Box>}
            <Button role="listitem" className={'find-hit' + (activeHit === i ? ' active' : '')} disabled={busy}
                    onClick={() => openHit(i)} title={t("Go to match")}><span
                className="find-location">{hit.line}:{hit.column}</span><code>{hit.before}
                <mark>{hit.matched || '∅'}</mark>
                {hit.after}</code></Button>
        </React.Fragment>)}</Box></>}
    </Box>
    </Box>;
}
