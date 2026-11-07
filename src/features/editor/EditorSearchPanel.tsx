import {matchesShortcut} from '../../app/shortcuts';
import {Button, Flex, Input, Stack, Text} from '@chakra-ui/react';
import {useEffect, useRef} from 'react';
import type {EditorView} from '@codemirror/view';
import {
    closeSearchPanel,
    findNext,
    findPrevious,
    getSearchQuery,
    replaceAll,
    replaceNext,
    SearchQuery,
    setSearchQuery
} from '@codemirror/search';
import {t, useLanguage} from '../../i18n';

export function EditorSearchPanel({editor}: { editor: EditorView }) {
    useLanguage();
    const query = getSearchQuery(editor.state);
    const input = useRef<HTMLInputElement>(null);
    useEffect(() => {
        input.current?.focus();
        input.current?.select();
    }, []);
    const change = (values: Partial<SearchQuery>) => editor.dispatch({effects: setSearchQuery.of(new SearchQuery({...query, ...values}))});
    return <Stack bg="bg" color="fg" p="3" gap="2" borderBottomWidth="1px" fontFamily="body"
                  onKeyDown={event => {
                      const commands = {next: findNext, previous: findPrevious, replaceNext, replaceAll};
                      for (const [action, command] of Object.entries(commands)) {
                          if (matchesShortcut(event.nativeEvent, action as keyof typeof commands)) {
                              event.preventDefault();
                              command(editor);
                              return;
                          }
                      }
                      if (event.key === 'Escape') {
                          event.preventDefault();
                          closeSearchPanel(editor);
                          editor.focus();
                      }
                      if (event.key === 'Enter') {
                          event.preventDefault();
                          (event.shiftKey ? findPrevious : findNext)(editor);
                      }
                  }}>
        <Flex gap="2" wrap="wrap" align="center">
            <Input ref={input} main-field="true" size="sm" flex="1" minW="180px" aria-label={t('Find')}
                   placeholder={t('Find')}
                   value={query.search} onChange={event => change({search: event.target.value})}
                   aria-invalid={!query.valid}/>
            <Button size="xs" variant="outline" onClick={() => findPrevious(editor)}>{t('Previous')}</Button>
            <Button size="xs" variant="outline" onClick={() => findNext(editor)}>{t('Next')}</Button>
            <Button size="xs" variant="ghost" onClick={() => {
                closeSearchPanel(editor);
                editor.focus();
            }}>{t('Close')}</Button>
        </Flex>
        {!editor.state.readOnly && <Flex gap="2" wrap="wrap">
            <Input size="sm" flex="1" minW="180px" aria-label={t('Replace with')} placeholder={t('Replace with')}
                   value={query.replace} onChange={event => change({replace: event.target.value})}/>
            <Button size="xs" variant="outline" disabled={!query.valid}
                    onClick={() => replaceNext(editor)}>{t('Replace')}</Button>
            <Button size="xs" variant="outline" disabled={!query.valid}
                    onClick={() => replaceAll(editor)}>{t('Replace all')}</Button>
        </Flex>}
        <Flex gap="2" wrap="wrap">
            {([['caseSensitive', 'Match case'], ['wholeWord', 'Whole word'], ['regexp', 'Regular expression']] as const).map(([key, label]) =>
                <Button key={key} size="xs" variant={query[key] ? 'subtle' : 'ghost'} colorPalette="teal"
                        aria-pressed={query[key]}
                        onClick={() => change({[key]: !query[key]})}>{t(label)}</Button>)}
        </Flex>
        {!query.valid && <Text fontSize="xs" color="fg.error">{t('Invalid regular expression')}</Text>}
    </Stack>;
}
