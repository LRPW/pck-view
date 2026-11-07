import {Button, createListCollection, Field, Flex, IconButton, Input, Text} from '@chakra-ui/react';
import type {ChangeEvent, FormEvent} from 'react';
import {useState} from 'react';
import {LuSearch, LuX} from 'react-icons/lu';
import {InputGroup} from '../../components/ui/input-group';
import {SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValueText} from '../../components/ui/select';
import {Tooltip} from '../../components/ui/tooltip';
import {t} from '../../i18n';
import {EditorSwitch} from '../editor/EditorSwitch';
import {basename} from './search-types';
import type {useFileSearch} from './useFileSearch';

export function SearchMask({mask, change}: { mask: string; change: (value: string) => void }) {
    const [enabled, setEnabled] = useState(!!mask);
    const [pattern, setPattern] = useState(mask || '*.xml');

    function toggle(value: boolean) {
        setEnabled(value);
        change(value ? pattern : '');
    }

    function update(event: ChangeEvent<HTMLInputElement>) {
        setPattern(event.target.value);
        if (enabled) change(event.target.value);
    }

    return <Flex align="center" gap="2" px="2">
        <EditorSwitch label={t('File mask')} checked={enabled} showLabel change={toggle}/>
        <Field.Root width={{base: '80px', md: '120px'}}>
            <Input size="xs" aria-label={t('File mask')} value={pattern} disabled={!enabled} onChange={update}/>
        </Field.Root>
    </Flex>;
}

export function SearchForm({controller}: { controller: ReturnType<typeof useFileSearch> }) {
    const {options, change, input, eligible, source, module, running, stopping, search, cancel} = controller;
    const sources = createListCollection({
        items: eligible.map(item => ({
            value: item.path,
            label: basename(item.path)
        }))
    });
    const modules = createListCollection({
        items: (source?.modules ?? []).map(name => ({
            value: name,
            label: name ? basename(name) : basename(source!.path)
        }))
    });
    const canSearch = !!options.query && !!source;

    function submit(event: FormEvent) {
        event.preventDefault();
        if (canSearch) void search();
    }

    function updateQuery(event: ChangeEvent<HTMLInputElement>) {
        change('query', event.target.value);
    }

    function updateDirectory(event: ChangeEvent<HTMLInputElement>) {
        change('directory', event.target.value);
    }

    function clearQuery() {
        change('query', '');
        input.current?.focus();
    }

    function runCancel() {
        void cancel();
    }

    const flags = [
        {key: 'caseSensitive', label: 'Cc', title: t('Match case')},
        {key: 'wholeWord', label: 'W', title: t('Whole words')},
        {key: 'regexp', label: '.*', title: t('Regular expression')},
    ] as const;
    return <Flex as="form" onSubmit={submit} direction="column" gap="3" px="2" py="2" flexShrink="0"
                 borderBottomWidth="1px">
        <Field.Root>
            <InputGroup width="full" startElement={<LuSearch/>}
                        endElementProps={{width: 'auto', pointerEvents: 'auto', pe: '1'}}
                        endElement={<Flex align="center" gap="0.5">
                            <IconButton aria-label={t('Clear search')} onClick={clearQuery} variant="ghost" size="2xs"
                                        disabled={!options.query}><LuX/></IconButton>
                            {flags.map(flag => <Tooltip key={flag.key} content={flag.title}>
                                <Button type="button" variant="ghost" size="2xs" minW="6" px="1.5"
                                        aria-label={flag.title}
                                        aria-pressed={options[flag.key]}
                                        bg={options[flag.key] ? 'search.selected' : 'transparent'}
                                        onClick={() => change(flag.key, !options[flag.key])}>{flag.label}</Button>
                            </Tooltip>)}
                            {running ? <Button size="2xs" type="button" variant="ghost" disabled={stopping}
                                               onClick={runCancel}>
                                {stopping ? t('Cancelling…') : t('Cancel')}
                            </Button> : <IconButton size="2xs" variant="ghost" type="submit" disabled={!canSearch}
                                                    aria-label={t('Find')}><LuSearch/></IconButton>}
                        </Flex>}>
                <Input ref={input} aria-label={t('Search text')} value={options.query} onChange={updateQuery}
                       pe="180px" size="sm" autoComplete="off" placeholder={t('Search text')}/>
            </InputGroup>
        </Field.Root>
        <Flex gap="2" align="center" wrap={{base: 'wrap', md: 'nowrap'}}>
            <Flex gap="0.5" flexShrink="0">
                {([
                    ['project', t('In Project')], ['module', t('Module')], ['directory', t('Directory')],
                ] as const).map(([mode, label]) => <Button key={mode} variant="ghost" size="2xs" px="2" type="button"
                                                           aria-pressed={options.mode === mode}
                                                           bg={options.mode === mode ? 'bg.emphasized' : 'transparent'}
                                                           onClick={() => change('mode', mode)}>{label}</Button>)}
            </Flex>
            <SelectRoot collection={sources} value={source ? [source.path] : []}
                        flex={options.mode === 'directory' ? undefined : '1'} minW="140px" size="xs"
                        onValueChange={event => change('source', event.value[0])}>
                <SelectTrigger aria-label={t('Source')}><SelectValueText
                    placeholder={t('No open sources')}/></SelectTrigger>
                <SelectContent>{sources.items.map(item => <SelectItem key={item.value}
                                                                      item={item}>{item.label}</SelectItem>)}</SelectContent>
            </SelectRoot>
            {options.mode === 'module' && <SelectRoot collection={modules} value={[module]} size="xs" minW="140px"
                                                      onValueChange={event => change('module', event.value[0])}>
                <SelectTrigger aria-label={t('Module')}><SelectValueText/></SelectTrigger>
                <SelectContent>{modules.items.map(item => <SelectItem key={item.value}
                                                                      item={item}>{item.label}</SelectItem>)}</SelectContent>
            </SelectRoot>}
            {options.mode === 'directory' && <>
                <Field.Root flex="1" minW="120px">
                    <Input size="xs" value={options.directory} onChange={updateDirectory} aria-label={t('Directory')}
                           placeholder={t('Source path')}/>
                </Field.Root>
            </>}
        </Flex>
        {!running && <Text srOnly>{t('Press Enter to search')}</Text>}
    </Flex>;
}
