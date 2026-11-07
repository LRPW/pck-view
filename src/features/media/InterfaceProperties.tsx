import {canonicalFontName, UI_FONTS} from './ui-fonts';
import {Field, Input, NativeSelect, Stack, Text} from '@chakra-ui/react';
import schema from './interface-property-schema.json';
import {t} from '../../i18n';

export const propertySchema = schema as Record<string, Record<string, string>>;

export function propertyLabel(name: string) {
    return t('Property: ' + name);
}

export function InterfaceProperties({element, disabled, change, allowMono = true}: {
    allowMono?: boolean;
    element: Element;
    disabled: boolean;
    change: (key: string, value: string) => void
}) {
    const base = propertySchema[element.tagName.toUpperCase()] ?? {};
    const known = (element.hasAttribute('DtfRow') || element.parentElement?.hasAttribute('DtfRow')) ? Object.fromEntries(Array.from(element.attributes).filter(attribute => attribute.name !== 'DtfRow').map(attribute => [attribute.name, base[attribute.name] ?? (/^-?\d+$/.test(attribute.value) ? 'INT' : 'STRING')])) : base;
    const names = [...new Set([...Object.keys(known), ...Array.from(element.attributes, a => a.name).filter(name => name !== 'DtfRow')])];
    const groups: Record<string, string[]> = {};
    for (const name of names) {
        const group = !(name in known) ? 'Other XML attributes' : ['Name', 'x', 'y', 'Width', 'Height', 'Align', 'TextAlign', 'TextOffsetX', 'TextOffsetY'].includes(name) ? 'Geometry and identity' : /Sound|Command/.test(name) ? 'Commands and sound' : /Font|String|Bold|Italic|Shadow|Color|Line|Text|Wrap|Outline/.test(name) ? 'Text appearance' : 'Element options';
        (groups[group] ??= []).push(name);
    }
    return <Stack gap="4">{Object.entries(groups).map(([group, keys]) => <Stack key={group} gap="2" p="3"
                                                                                borderWidth="1px" rounded="md">
        <Text fontSize="xs" fontWeight="semibold" color="fg.muted">{t(group)}</Text>
        {keys.map(name => {
            const value = element.getAttribute(name) ?? '', type = known[name];
            const label = name in known ? propertyLabel(name) : name;
            return <Field.Root key={name + ':' + value} disabled={disabled} gap="1">
                <Field.Label fontSize="xs" title={name}>{label}</Field.Label>
                {name.toLowerCase() === 'fontname' ?
                    <NativeSelect.Root size="sm"><NativeSelect.Field value={canonicalFontName(value)}
                                                                     onChange={event => change(name, event.target.value)}>
                        <option value="">{t('Unspecified')}</option>
                        {UI_FONTS.filter(font => allowMono || font.name !== 'mono').map(font => <option key={font.name}
                                                                                                        value={font.name}>{font.name}</option>)}
                        {!!value && !UI_FONTS.some(font => font.name === canonicalFontName(value) && (allowMono || font.name !== 'mono')) &&
                            <option value={canonicalFontName(value)} disabled>{value}</option>}
                    </NativeSelect.Field><NativeSelect.Indicator/></NativeSelect.Root> : type === 'BOOL' ?
                        <NativeSelect.Root size="sm"><NativeSelect.Field value={value}
                                                                         onChange={event => change(name, event.target.value)}>
                            <option value="">{t('Unspecified')}</option>
                            <option value="true">{t('Enabled')}</option>
                            <option value="false">{t('Disabled')}</option>
                        </NativeSelect.Field><NativeSelect.Indicator/></NativeSelect.Root> :
                        <Input size="sm" type={type === 'INT' || type === 'FLOAT' ? 'number' : 'text'}
                               defaultValue={value} placeholder={t('Unspecified')}
                               onBlur={event => {
                                   if (event.target.value !== value) change(name, event.target.value);
                               }} onKeyDown={event => {
                            if (event.key === 'Enter') event.currentTarget.blur();
                        }}/>}
            </Field.Root>;
        })}
    </Stack>)}</Stack>;
}
