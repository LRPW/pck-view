import {Field, NativeSelect} from '@chakra-ui/react';
import {t} from '../i18n';

export function ClientVersionField({value, onChange, disabled}: {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
}) {
    return <Field.Root disabled={disabled}>
        <Field.Label>{t('Client version')}</Field.Label>
        <NativeSelect.Root size="sm">
            <NativeSelect.Field value={value} onChange={event => onChange(event.target.value)}>
                <option value="1.5.5">1.5.5</option>
                <option value="1.5.5-lrpw">1.5.5 (LRPW)</option>
            </NativeSelect.Field>
            <NativeSelect.Indicator/>
        </NativeSelect.Root>
    </Field.Root>;
}
