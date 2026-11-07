import {setLanguage, t, useLanguage} from "../i18n";
import {Button, createListCollection, Field, Flex, Input, Kbd, Stack, Text} from '@chakra-ui/react';
import type {ComponentProps} from 'react';
import {useState} from 'react';
import {defaults, setShortcuts, shortcutFromEvent, useShortcuts} from './shortcuts';
import {SegmentedControl} from '../components/ui/segmented-control';
import {SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValueText} from '../components/ui/select';
import {type ThemeMode, useAppTheme} from './useAppTheme';

export function AppearanceSettings() {
    useLanguage();
    const [theme, changeTheme] = useAppTheme();
    const themes = [
        {value: 'light', label: t("Light")},
        {value: 'dark', label: t("Dark")},
        {value: 'system', label: t("System")},
    ];
    const handleThemeChange: ComponentProps<typeof SegmentedControl>['onValueChange'] = event => {
        if (event.value) changeTheme(event.value as ThemeMode);
    };
    return <Stack gap="4">
        <Field.Root>
            <Field.Label>{t("Chakra theme")}</Field.Label>
            <SegmentedControl value={theme} items={themes} onValueChange={handleThemeChange}/>
        </Field.Root>
        <Text color="fg.muted" fontSize="sm">
            {t("Applied immediately to open windows.")}
        </Text>
    </Stack>;
}

export function LanguageSettings() {
    const languages = createListCollection({
        items: [
            {value: 'ru', label: t("Russian")},
            {value: 'en', label: t('English')},
        ]
    });


    const language = useLanguage();
    const handleLanguageChange: ComponentProps<typeof SelectRoot>['onValueChange'] = event => {
        const value = event.value[0];
        if (value === 'ru' || value === 'en') setLanguage(value);
    };
    return <Field.Root>
        <Field.Label>{t("Interface language")}</Field.Label>
        <SelectRoot collection={languages} value={[language]} onValueChange={handleLanguageChange}>
            <SelectTrigger><SelectValueText/></SelectTrigger>
            <SelectContent>
                {languages.items.map(item => <SelectItem key={item.value} item={item}>{t(item.label)}</SelectItem>)}
            </SelectContent>
        </SelectRoot>
    </Field.Root>;
}

export function KeyboardShortcuts() {
    const bindings = useShortcuts();
    const [error, setError] = useState('');
    const labels = {
        build: 'Build changes',
        buildFull: 'Build full project',
        open: 'Open…',
        save: 'Save file',
        search: 'Find in Files',
        close: 'Close tab',
        find: 'Find in text',
        replace: 'Find and replace',
        next: 'Next match',
        previous: 'Previous match',
        replaceNext: 'Replace next match',
        replaceAll: 'Replace all matches',
        gotoLine: 'Go to line',
        selectMatches: 'Select all matches',
        selectNext: 'Select next occurrence',
        undo: 'Undo',
        redo: 'Redo',
        fold: 'Fold code',
        unfold: 'Unfold code',
        openResult: 'Open search result',
        duplicate: 'Duplicate interface control',
        saveAs: 'Save archive as…'
    };
    return <Stack gap="4">
        <Text
            color="fg.muted">{t('Focus a shortcut and press the new key combination. Changes are saved immediately.')}</Text>
        <Stack gap="1" role="group" aria-label={t('Keyboard shortcuts')}>
            {Object.entries(labels).map(([action, label]) => <Button key={action} variant="ghost" size="sm"
                                                                     w="full" minH="7" h="auto" py="1" px="3"
                                                                     rounded="sm" justifyContent="space-between"
                                                                     fontWeight="normal"
                                                                     color="fg.muted"
                                                                     _hover={{bg: 'bg.subtle', color: 'fg'}}
                                                                     _focusVisible={{
                                                                         bg: {
                                                                             base: 'blue.100',
                                                                             _dark: 'blue.900'
                                                                         }, color: 'fg', outline: 'none'
                                                                     }}
                                                                     aria-label={t(label) + ': ' + bindings[action as keyof typeof bindings]}
                                                                     onKeyDown={event => {
                                                                         if (event.key === 'Tab') return;
                                                                         event.preventDefault();
                                                                         event.stopPropagation();
                                                                         const value = shortcutFromEvent(event.nativeEvent);
                                                                         if (!value) return;
                                                                         if (!(event.ctrlKey || event.metaKey || event.altKey || /^F\d+$/.test(event.code))) {
                                                                             setError(t('Use Ctrl or Alt with another key.'));
                                                                             return;
                                                                         }
                                                                         if (Object.entries(bindings).some(([key, current]) => key !== action && current === value)) {
                                                                             setError(t('This shortcut is already assigned.'));
                                                                             return;
                                                                         }
                                                                         setShortcuts({...bindings, [action]: value});
                                                                         setError('');
                                                                     }}>
                <Text textAlign="start">{t(label)}</Text>
                <Flex gap="1" flexShrink="0" aria-hidden="true">
                    {bindings[action as keyof typeof bindings].split('+').map((key, index) =>
                        <Kbd key={index} fontSize="xs" lineHeight="1" px="1" py="0.5" minW="4" textAlign="center"
                             bg="transparent" color="inherit" borderWidth="1px" borderColor="border.emphasized"
                             rounded="sm" shadow="none">{key}</Kbd>)}
                </Flex>
            </Button>)}
        </Stack>
        {error && <Text role="alert" color="fg.error">{error}</Text>}
        <Button alignSelf="start" variant="outline" onClick={() => {
            setShortcuts({...defaults});
            setError('');
        }}>{t('Reset shortcuts')}</Button>
    </Stack>;
}

export function BuildSettings() {
    const [threads, setThreads] = useState(() => localStorage.getItem('pwforge:build-threads') ?? 'auto');
    const [manual, setManual] = useState(() => threads === 'auto' ? '4' : threads);
    return <Stack gap="3">
        <Field.Root>
            <Field.Label>{t('Build threads')}</Field.Label>
            <SegmentedControl value={threads === 'auto' ? 'auto' : 'manual'}
                              items={[{value: 'auto', label: t('Auto')}, {value: 'manual', label: t('Manual')}]}
                              onValueChange={event => {
                                  const value = event.value === 'auto' ? 'auto' : manual;
                                  setThreads(value);
                                  localStorage.setItem('pwforge:build-threads', value);
                              }}/>
        </Field.Root>
        {threads !== 'auto' && <Field.Root>
            <Field.Label>{t('Build threads')}</Field.Label>
            <Input type="number" min={1} max={32} step={1} value={manual} maxW="32" onChange={event => {
                const value = event.target.value;
                setManual(value);
                const count = Number(value);
                if (Number.isInteger(count) && count >= 1 && count <= 32) {
                    setThreads(value);
                    localStorage.setItem('pwforge:build-threads', value);
                }
            }} onBlur={() => setManual(threads)}/>
        </Field.Root>}
    </Stack>;
}
