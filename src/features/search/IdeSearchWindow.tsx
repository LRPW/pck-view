import {matchesShortcut} from '../../app/shortcuts';
import {Alert, Box, Button, Flex, Progress, Text} from '@chakra-ui/react';
import {emitTo} from '@tauri-apps/api/event';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {type KeyboardEvent, useMemo, useState} from 'react';
import {WindowTitlebar} from '../../app/WindowTitlebar';
import {SplitterPanel, SplitterResizeTrigger, SplitterRoot} from '../../components/ui/splitter';
import {message, t} from '../../i18n';
import {EditorSwitch} from '../editor/EditorSwitch';
import {SearchForm, SearchMask} from './SearchForm';
import {SearchPreview} from './SearchPreview';
import {SearchResults} from './SearchResults';
import type {IdeHit} from './search-types';
import {useFileSearch} from './useFileSearch';

export type {IdeHit} from './search-types';
const panels = [{id: 'results', minSize: 15}, {id: 'preview', minSize: 20}];

export function IdeSearchWindow() {
    const controller = useFileSearch();
    const {matches, selected, setSelected, options, change, result, running, progress, error, input} = controller;
    const [preview, setPreview] = useState(true);
    const selectedItem = matches[selected];
    const fileCount = useMemo(() => new Set(matches.map(item => item.source + ':' + item.path)).size, [matches]);
    const summary = matches.length ? t('{matches} matches in {files} files', {
        matches: matches.length,
        files: fileCount
    }) : '';

    function openResult(item: IdeHit) {
        void emitTo('main', 'ide-search-open', item).catch(error => controller.reportError(String(error)));
    }

    function openSelected() {
        if (selectedItem) openResult(selectedItem);
    }

    function updateMask(value: string) {
        change('mask', value);
    }

    function handleKeys(event: KeyboardEvent) {
        if (event.defaultPrevented) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            if (running) void controller.cancel();
            else void getCurrentWindow().hide();
            return;
        }
        if (matchesShortcut(event.nativeEvent, 'openResult')) {
            event.preventDefault();
            openSelected();
            return;
        }
        const inResults = event.target instanceof Element && !!event.target.closest('[data-search-results]');
        const inQuery = event.target === input.current;
        if ((inResults || inQuery) && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            const delta = event.key === 'ArrowDown' ? 1 : -1;
            setSelected(index => Math.max(0, Math.min(matches.length - 1, index + delta)));
        } else if (inResults && event.key === 'Enter') {
            event.preventDefault();
            openSelected();
        }
    }

    const results = <SearchResults matches={matches} selected={selected} select={setSelected} open={openResult}/>;
    return <Flex as="section" direction="column" height="100vh" minH="0" bg="bg.panel" color="fg"
                 onKeyDown={handleKeys}>
        <WindowTitlebar title={t('Find in Files')} subtitle={summary}
                        actions={<SearchMask mask={options.mask} change={updateMask}/>}/>
        <SearchForm controller={controller}/>
        {running &&
            <Progress.Root size="xs" value={progress?.total ? progress.completed : null} max={progress?.total || 100}
                           aria-label={t('Search progress')}><Progress.Track><Progress.Range/></Progress.Track></Progress.Root>}
        {error && <Alert.Root status="error" size="sm"><Alert.Indicator/><Alert.Content>{message(error)}</Alert.Content></Alert.Root>}
        <Box flex="1" minH="0" overflow="hidden">
            {preview ?
                <SplitterRoot orientation="vertical" panels={panels} defaultSize={[38, 62]} height="full" gap="0">
                    <SplitterPanel id="results" minH="0" overflow="hidden">{results}</SplitterPanel>
                    <SplitterResizeTrigger id="results:preview" aria-label={t('Resize search preview')} height="5px"
                                           bg="bg.subtle" _hover={{bg: 'border'}}/>
                    <SplitterPanel id="preview" minH="0" overflow="hidden"><SearchPreview
                        item={selectedItem}/></SplitterPanel>
                </SplitterRoot> : results}
        </Box>
        <Flex as="footer" flexShrink="0" align="center" gap="3" px="3" py="2" borderTopWidth="1px" bg="bg.panel">
            <EditorSwitch label={t('Show preview')} checked={preview} change={setPreview} showLabel/>
            <Text role="status" fontSize="xs" color="fg.muted" truncate flex="1">
                {running ? message(progress?.stage || 'Preparing…') :
                    result?.cancelled ? t('Search cancelled') :
                        result?.truncated ? t('Result limit reached') :
                            result?.unreadable ? t('{count} unreadable files', {count: result.unreadable}) : ''}
            </Text>
            <Text fontSize="xs" color="fg.subtle" display={{base: 'none', md: 'block'}}>Ctrl+Enter</Text>
            <Button size="xs" variant="outline" disabled={!selectedItem}
                    onClick={openSelected}>{t('Open in editor')}</Button>
        </Flex>
    </Flex>;
}
