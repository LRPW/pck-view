import {HStack, IconButton} from '@chakra-ui/react';
import {LuCopy, LuMinus, LuSquare, LuX} from 'react-icons/lu';
import {Tooltip} from '../components/ui/tooltip';
import {t} from '../i18n';
import {useWindowControls} from './useWindowControls';

export function WindowControls() {
    const {available, maximized, minimize, toggleMaximize, close} = useWindowControls();
    const maximizeLabel = maximized ? t('Restore window') : t('Maximize window');

    return <HStack gap="0" height="full" flexShrink="0" aria-label={t('Window controls')}>
        <Tooltip content={t('Minimize window')}>
            <IconButton aria-label={t('Minimize window')} disabled={!available} onClick={minimize}
                        variant="ghost" width="46px" height="full" minH="40px" rounded="none" color="fg.muted"
                        _hover={{bg: 'bg.emphasized', color: 'fg'}}>
                <LuMinus size={14}/>
            </IconButton>
        </Tooltip>
        <Tooltip content={maximizeLabel}>
            <IconButton aria-label={maximizeLabel} disabled={!available} onClick={toggleMaximize}
                        variant="ghost" width="46px" height="full" minH="40px" rounded="none" color="fg.muted"
                        _hover={{bg: 'bg.emphasized', color: 'fg'}}>
                {maximized ? <LuCopy size={13}/> : <LuSquare size={13}/>}
            </IconButton>
        </Tooltip>
        <Tooltip content={t('Close window')}>
            <IconButton aria-label={t('Close window')} disabled={!available} onClick={close}
                        variant="ghost" width="46px" height="full" minH="40px" rounded="none" color="fg.muted"
                        _hover={{bg: 'red.solid', color: 'white'}}>
                <LuX size={16}/>
            </IconButton>
        </Tooltip>
    </HStack>;
}
