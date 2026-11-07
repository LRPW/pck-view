import type {ReactNode} from 'react';
import {Flex, Text} from '@chakra-ui/react';
import {WindowControls} from './WindowControls';

export function WindowTitlebar({title, subtitle, actions}: { title: string; subtitle?: string; actions?: ReactNode }) {
    return <Flex as="header" height="40px" flexShrink="0" align="center"
                 bg="bg.panel" borderBottomWidth="1px" userSelect="none">
        <Flex flex="1" minW="0" height="full" align="center" gap="3" px="3" data-tauri-drag-region>
            <Text fontSize="xs" fontWeight="medium" truncate pointerEvents="none">{title}</Text>
            {subtitle && <Text fontSize="xs" color="fg.muted" truncate pointerEvents="none"
                               display={{base: 'none', md: 'block'}}>{subtitle}</Text>}
        </Flex>
        {actions}
        <WindowControls/>
    </Flex>;
}
