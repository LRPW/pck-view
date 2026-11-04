import {Tabs} from '@chakra-ui/react';
import {type CSSProperties, useState} from 'react';
import {ColumnDivider} from './ColumnDivider';
import {EditorSwitch} from './EditorSwitch';

export const buyField = /^buy\[([0-3])\]\.(.+)$/;
const maxU32 = 0xffffffff;
const colors = ['#63e2c5', '#b99aff'];
const types = ['Цена из файла', 'По периоду', 'По дням недели', 'По дням месяца', 'Цена с сервера'];
const statuses = [
    'Обычный', 'Новинка', 'Акция', 'Рекомендуемый',
    ...Array.from({length: 9}, (_, i) => `Скидка ${90 - i * 10}%`),
    'Мгновенная распродажа',
    ...Array.from({length: 6}, (_, i) => `Значок VIP ${i + 1}`),
];
const vipLevels = ['Без требования', ...Array.from({length: 6}, (_, i) => `VIP ${i + 1}`)];
const labels: Record<string, string> = {
    price: 'Цена', end_time: 'Конец продаж', time: 'Срок аренды', start_time: 'Начало продаж',
    type: 'Тип расписания', day: 'Маска дней', status: 'Статус', flag: 'Флаги',
    min_vip_level: 'Минимальный VIP',
};

type SlotField = { name: string; index: number; value: string };

function SlotInput({name, value, type, disabled, change}: {
    name: string;
    value: string;
    type: string | undefined;
    disabled: boolean;
    change: (value: string) => void;
}) {
    const label = labels[name] ?? name;
    const options = name === 'type' ? types : name === 'status' ? statuses : name === 'min_vip_level' ? vipLevels : undefined;
    const offset = name === 'type' ? -1 : 0;
    if (options) return <select aria-label={label} value={value} disabled={disabled}
                                onChange={event => change(event.target.value)}>
        {!options.some((_, i) => String(i + offset) === value) && <option value={value}>{value}</option>}
        {options.map((text, i) => <option key={i} value={i + offset}>{i + offset} · {text}</option>)}
    </select>;

    if (name === 'start_time' || name === 'end_time') {
        const timestamp = Number(value);
        return <div className="shop-slot-input">
            <input aria-label={`${label} (UTC)`} type="datetime-local" step={1} disabled={disabled}
                   min="1970-01-01T00:00:01" max="2106-02-07T06:28:15"
                   value={timestamp ? new Date(timestamp * 1000).toISOString().slice(0, 19) : ''}
                   onChange={event => {
                       const next = event.target.value;
                       const seconds = next ? Date.parse(next + 'Z') / 1000 : 0;
                       if (Number.isInteger(seconds) && seconds >= 0 && seconds <= maxU32) change(String(seconds));
                   }}/>
            <small>UTC · {timestamp || 'без ограничения'}</small>
            {!!timestamp && <button type="button" disabled={disabled} onClick={() => change('0')}>Сбросить</button>}
        </div>;
    }

    const dayCount = name === 'day' ? type === '1' ? 7 : type === '2' ? 31 : 0 : 0;
    const duration = Number(value);
    return <div className="shop-slot-input">
        <input aria-label={label} type="number" min={0} max={maxU32} step={1} value={value}
               disabled={disabled} onChange={event => {
            const next = event.target.value;
            if (/^\d*$/.test(next) && Number(next) <= maxU32) change(next);
        }}/>
        {name === 'price' && <small>0 · слот без цены</small>}
        {name === 'time' && <>
            <small>{duration ? `сек · ${(duration / 86400).toLocaleString(undefined, {maximumFractionDigits: 3})} дн.` : '0 · бессрочно'}</small>
            {[1, 7, 30].map(days => <button type="button" key={days} disabled={disabled}
                                            onClick={() => change(String(days * 86400))}>{days} дн.</button>)}
        </>}
        {!!dayCount && <div className="shop-day-mask" role="group" aria-label={label}>
            {Array.from({length: dayCount}, (_, index) => {
                const bit = 1 << index;
                return <EditorSwitch key={index} label={String(index + 1)} showLabel disabled={disabled}
                                     checked={Boolean(Number(value) & bit)}
                                     change={() => change(String((Number(value) ^ bit) >>> 0))}/>;
            })}
        </div>}
    </div>;
}

export function ShopSlots({fields, draft, original, query, disabled, change, resize}: {
    fields: { name: string }[];
    draft: string[];
    original: string[];
    query: string;
    disabled: boolean;
    change: (index: number, value: string) => void;
    resize: (delta: number) => void;
}) {
    const [selected, setSelected] = useState('0');
    const slots: SlotField[][] = Array.from({length: 4}, () => []);
    fields.forEach((field, index) => {
        const match = buyField.exec(field.name);
        if (match) slots[Number(match[1])].push({name: match[2], index, value: draft[index]});
    });
    const signatures = slots.map(slot => JSON.stringify(slot.map(({
                                                                      name,
                                                                      value
                                                                  }) => [name, value === '' ? null : Number(value)])));
    const repeated = [...new Set(signatures.filter((signature, index) => signatures.indexOf(signature) !== index))];
    const term = query.trim().toLowerCase();
    const matches = ({name}: SlotField, slot: number) =>
        `buy[${slot}].${name}`.includes(term) || labels[name]?.toLowerCase().includes(term);
    const available = slots.map((fields, slot) => fields.some(field => matches(field, slot)));
    const first = available.indexOf(true);
    if (first < 0) return null;

    return <Tabs.Root className="shop-slots" value={available[Number(selected)] ? selected : String(first)}
                      onValueChange={event => setSelected(event.value)} size="sm" colorPalette="teal">
        <Tabs.List aria-label="Слоты покупки">
            {slots.map((_, slot) => {
                const group = repeated.indexOf(signatures[slot]);
                const duplicates = signatures.flatMap((signature, i) => i !== slot && signature === signatures[slot] ? [i + 1] : []);
                return <Tabs.Trigger key={slot} value={String(slot)} className="shop-slot-tab"
                                     disabled={!available[slot]}
                                     style={{'--slot-match-color': colors[group]} as CSSProperties}
                                     title={duplicates.length ? `Совпадает со слотами ${duplicates.join(', ')}` : undefined}>
                    Слот {slot + 1}
                </Tabs.Trigger>;
            })}
        </Tabs.List>
        {slots.map((fields, slot) => <Tabs.Content key={slot} value={String(slot)} className="shop-slot-panel">
            {fields.filter(field => matches(field, slot)).map(({name, index, value}) =>
                <div className={value === original[index] ? 'elements-field' : 'elements-field modified'} key={index}>
                    <span>{labels[name] ?? name}<small>{name}</small></span>
                    <ColumnDivider label="Ширина названий полей" onDelta={resize}/>
                    <div className="elements-field-value">
                        <SlotInput name={name} value={value} type={fields.find(field => field.name === 'type')?.value}
                                   disabled={disabled} change={next => change(index, next)}/>
                    </div>
                </div>)}
        </Tabs.Content>)}
    </Tabs.Root>;
}
