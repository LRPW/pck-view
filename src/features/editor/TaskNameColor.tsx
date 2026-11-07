import {t} from "../../i18n";
import {Button, ColorPicker, parseColor, Portal} from '@chakra-ui/react';
import type {ReactNode} from 'react';

const leadingColor = /^\^([0-9a-f]{6})/i;

export function TaskNameColor({text, change, disabled}: {
    text: string; change: (text: string) => void; disabled: boolean;
}) {
    const match = leadingColor.exec(text);
    const body = match ? text.slice(match[0].length) : text;
    return <TaskColorPicker label={t("Quest name color")} color={match?.[1]} disabled={disabled}
                            change={hex => {
                                const next = `^${hex}${body}`;
                                if (next.length <= 29 && match?.[1].toLowerCase() !== hex.toLowerCase()) change(next);
                            }}>
        {body.length > 22 && <small>{t("A color code requires 7 of the 29 characters.")}</small>}
        <Button type="button" size="xs" variant="outline" disabled={!match}
                onClick={() => change(body)}>{t("Remove color")}</Button>
    </TaskColorPicker>;
}

export function TaskColorPicker({label, color, change, disabled, children}: {
    label: string; color?: string; change: (hex: string) => void; disabled: boolean; children?: ReactNode;
}) {
    return <ColorPicker.Root value={parseColor(`#${color ?? 'e2e8f0'}`)} size="sm"
                             disabled={disabled}
                             onValueChange={event => change(event.value.toString('hex').slice(1, 7))}>
        <ColorPicker.HiddenInput/>
        <ColorPicker.Control>
            <ColorPicker.Trigger aria-label={label} title={label}>
                <ColorPicker.ValueSwatch/>
            </ColorPicker.Trigger>
        </ColorPicker.Control>
        <Portal>
            <ColorPicker.Positioner>
                <ColorPicker.Content>
                    <ColorPicker.Area>
                        <ColorPicker.AreaBackground/>
                        <ColorPicker.AreaThumb/>
                    </ColorPicker.Area>
                    <ColorPicker.ChannelSlider channel="hue">
                        <ColorPicker.ChannelSliderTrack/>
                        <ColorPicker.ChannelSliderThumb/>
                    </ColorPicker.ChannelSlider>
                    <ColorPicker.ChannelInput channel="hex" aria-label={t("HEX color")}/>
                    {children}
                </ColorPicker.Content>
            </ColorPicker.Positioner>
        </Portal>
    </ColorPicker.Root>;
}
