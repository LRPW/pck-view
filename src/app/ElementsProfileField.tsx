import {invoke} from '@tauri-apps/api/core';
import {Field, NativeSelect, Stack, Text} from '@chakra-ui/react';
import {useEffect, useState} from 'react';
import type {ElementsProfile} from '../features/editor/resource-context';
import {message, t} from '../i18n';

type ProfileOption = ElementsProfile & { client: string };

export function ElementsProfileField({value, onChange, disabled}: {
    value: ElementsProfile | null;
    onChange: (profile: ElementsProfile | null) => void;
    disabled: boolean;
}) {
    const [profiles, setProfiles] = useState<ProfileOption[]>([]);
    const [error, setError] = useState('');
    useEffect(() => {
        let disposed = false;
        void invoke<ProfileOption[]>('elements_schema_profiles').then(result => {
            if (!disposed) setProfiles(result);
        }).catch(reason => {
            if (!disposed) setError(String(reason));
        });
        return () => {
            disposed = true;
        };
    }, []);

    const versions = [...new Set(profiles.map(profile => profile.version))];
    const variants = profiles.filter(profile => profile.version === value?.version);
    return <Stack gap="3">
        <Field.Root disabled={disabled || !profiles.length}>
            <Field.Label>{t('Elements format version')}</Field.Label>
            <NativeSelect.Root size="sm">
                <NativeSelect.Field value={value?.version ?? 'auto'} onChange={event => {
                    if (event.target.value === 'auto') {
                        onChange(null);
                        return;
                    }
                    const profile = profiles.find(item => item.version === Number(event.target.value));
                    if (profile) onChange({version: profile.version, variant: profile.variant});
                }}>
                    <option value="auto">{t('Auto')}</option>
                    {versions.map(version => <option key={version} value={version}>v{version}</option>)}
                </NativeSelect.Field>
                <NativeSelect.Indicator/>
            </NativeSelect.Root>
        </Field.Root>
        {value && <Field.Root disabled={disabled || !variants.length}>
            <Field.Label>{t('Elements schema variant')}</Field.Label>
            <NativeSelect.Root size="sm">
                <NativeSelect.Field value={value.variant ?? ''} onChange={event => {
                    onChange({version: value.version, variant: event.target.value || null});
                }}>
                    {variants.map(profile => <option key={profile.variant ?? ''} value={profile.variant ?? ''}>
                        {profile.client}{profile.variant === 'lrpw' ? '' : ' · ' + (profile.variant ?? t('Default'))}
                    </option>)}
                </NativeSelect.Field>
                <NativeSelect.Indicator/>
            </NativeSelect.Root>
        </Field.Root>}
        {error && <Text role="alert" color="fg.error">{message(error)}</Text>}
    </Stack>;
}
