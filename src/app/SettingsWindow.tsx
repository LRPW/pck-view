import {WindowTitlebar} from './WindowTitlebar';
import {t, useLanguage} from "../i18n";
import {Box, Button, Heading, Stack} from '@chakra-ui/react';
import {useState} from 'react';
import {TranslationSettings, useTranslationSettings} from '../features/editor/TranslationSettings';
import {AppearanceSettings, BuildSettings, KeyboardShortcuts, LanguageSettings} from './SettingsSections';

export function SettingsWindow() {
    useLanguage();
    const [translation, changeTranslation] = useTranslationSettings();
    const [section, setSection] = useState('appearance');
    const sections = [
        {value: 'appearance', label: t("Appearance")},
        {value: 'language', label: t("Language")},
        {value: 'build', label: t('Build')},
        {value: 'shortcuts', label: t("Keyboard shortcuts")},
        {value: 'translation', label: t("Translation")},
    ];
    return <Stack height="100vh" gap="0" bg="bg" color="fg">
        <WindowTitlebar title={t("Settings — PW Forge")}/>
        <Box display="grid" gridTemplateColumns="190px minmax(0,1fr)" flex="1" minH="0">
            <Stack as="nav" p="4" gap="2" borderRightWidth="1px">
                <Heading size="sm" mb="3">{t("Settings")}</Heading>
                {sections.map(item => <Button key={item.value} size="sm" justifyContent="start"
                                              variant={section === item.value ? 'subtle' : 'ghost'} colorPalette="teal"
                                              aria-current={section === item.value ? 'page' : undefined}
                                              onClick={() => setSection(item.value)}>
                    {item.label}
                </Button>)}
            </Stack>
            <Stack p="6" overflowY="auto" gap="5">
                <Heading size="md">{sections.find(item => item.value === section)?.label}</Heading>
                {section === 'appearance' && <AppearanceSettings/>}
                {section === 'language' && <LanguageSettings/>}
                {section === 'build' && <BuildSettings/>}
                {section === 'shortcuts' && <KeyboardShortcuts/>}
                {section === 'translation' &&
                    <TranslationSettings settings={translation} change={changeTranslation} embedded/>}
            </Stack>
        </Box>
    </Stack>;
}
