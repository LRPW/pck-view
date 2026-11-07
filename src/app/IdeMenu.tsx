import {useShortcuts} from './shortcuts';
import {WindowControls} from './WindowControls';
import {t, useLanguage} from "../i18n";
import {Box, Button, Flex, Menu, Text} from '@chakra-ui/react';
import {MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger} from '../components/ui/menu';

type Command = { id: string; label: string; shortcut?: string; disabled?: boolean; run: () => void };
export type IdeMenuActions = {
    create: () => void;
    open: () => void;
    save: () => void;
    close: () => void;
    saveArchive: () => void;
    saveArchiveAs: () => void;
    search: () => void;
    settings: () => void;
    projectSettings: () => void;
    importServer: () => void;
    build: () => void;
    buildFull: () => void;
    cleanBuilds: () => void;
    exportTexts: () => void;
    translate: () => void;
    help: () => void; checkUpdates: () => void;
};

export function IdeMenu({actions, busy, dirty, hasTab, kind, scopeDirty, archiveChanged}: {
    actions: IdeMenuActions; busy: boolean; dirty: boolean; hasTab: boolean;
    kind?: string; scopeDirty: boolean; archiveChanged: boolean;
}) {
    useLanguage();
    const shortcuts = useShortcuts();
    const menus: { label: string; commands: (Command | null)[] }[] = [
        {
            label: t("File"), commands: [
                {id: 'new', label: t("New project"), disabled: busy, run: actions.create},
                {
                    id: 'project-settings',
                    label: t('Project settings'),
                    disabled: busy || kind !== 'project',
                    run: actions.projectSettings
                },
                {id: 'open', label: t("Open…"), shortcut: shortcuts.open, disabled: busy, run: actions.open},
                null,
                {
                    id: 'save',
                    label: t("Save file"),
                    shortcut: shortcuts.save,
                    disabled: busy || !dirty,
                    run: actions.save
                },
                ...(kind === 'archive' ? [
                    {
                        id: 'save-archive', label: "Save PCK" + (archiveChanged ? ' ●' : ''),
                        disabled: busy || scopeDirty, run: actions.saveArchive
                    },
                    {
                        id: 'save-archive-as', label: t("Save PCK as…"),
                        disabled: busy || scopeDirty, run: actions.saveArchiveAs
                    },
                ] : []),
                null,
                {
                    id: 'close', label: t("Close tab"), shortcut: shortcuts.close,
                    disabled: busy || !hasTab, run: actions.close
                },
            ]
        },
        {
            label: t("Edit"), commands: [
                {id: 'search', label: t("Find in Files"), shortcut: shortcuts.search, run: actions.search},
            ]
        },
        {
            label: t("Settings"), commands: [
                {id: 'settings', label: t("Settings…"), run: actions.settings},
            ]
        },
        {
            label: t("Tools"), commands: [
                {
                    id: 'import', label: t("Import server files…"),
                    disabled: busy || kind !== 'project', run: actions.importServer
                },
                {
                    id: 'clean-builds',
                    label: t('Clean old builds'),
                    disabled: busy || kind !== 'project',
                    run: actions.cleanBuilds
                },
                {
                    id: 'build-full',
                    shortcut: shortcuts.buildFull,
                    label: t("Build full project"),
                    disabled: busy || kind !== 'project',
                    run: actions.buildFull
                },
                {
                    id: 'build',
                    shortcut: shortcuts.build,
                    label: t("Build changes"),
                    disabled: busy || kind !== 'project',
                    run: actions.build
                },
                null,
                {
                    id: 'export',
                    label: t("Export texts…"),
                    disabled: busy || !kind || scopeDirty,
                    run: actions.exportTexts
                },
                {id: 'translate', label: t("Translator"), disabled: !kind, run: actions.translate},
            ]
        },
        {
            label: t("Help"), commands: [
                {id: 'help', label: t("About PW Forge"), run: actions.help},
            ]
        },
    ];
    return <Flex as="header" className="ide-header">
        <Flex className="ide-brand" aria-label="PW Forge" data-tauri-drag-region>
            <Box className="ide-brand-mark" aria-hidden="true" pointerEvents="none">PW</Box><Text fontWeight="semibold"
                                                                                                  pointerEvents="none">Forge</Text>
        </Flex>
        {menus.map(menu => menu.commands[0]?.id === 'settings' ?
            <Button key="settings" className="ide-menu-button" size="xs" variant="ghost"
                    onClick={actions.settings}>{menu.label}</Button> :
            <MenuRoot key={menu.label} positioning={{placement: 'bottom-start'}}>
                <MenuTrigger asChild><Button className="ide-menu-button" size="xs" variant="ghost">{menu.label}</Button></MenuTrigger>
                <MenuContent className="ide-menu-popup">
                    {menu.commands.map((command, index) => command ?
                        <MenuItem key={command.id} value={command.id} disabled={command.disabled}
                                  onSelect={command.run}>
                            {command.label}
                            {command.shortcut && <Menu.ItemCommand>{command.shortcut}</Menu.ItemCommand>}
                        </MenuItem> : <MenuSeparator key={'separator-' + index}/>)}
                </MenuContent>
            </MenuRoot>)}
        <Box flex="1" minW="4" alignSelf="stretch" data-tauri-drag-region/>
        <WindowControls/>
    </Flex>;
}
