import {t} from '../../i18n';
import {Switch} from '@chakra-ui/react';

export function EditorSwitch({label, checked, disabled = false, change, showLabel = false}: {
    label: string;
    checked: boolean;
    disabled?: boolean;
    change: (checked: boolean) => void;
    showLabel?: boolean;
}) {
    return <Switch.Root size="sm" colorPalette="teal" checked={checked} disabled={disabled}
                        onCheckedChange={event => change(event.checked === true)}>
        <Switch.HiddenInput aria-label={t(label)}/>
        <Switch.Control><Switch.Thumb/></Switch.Control>
        {showLabel && <Switch.Label>{t(label)}</Switch.Label>}
    </Switch.Root>;
}
