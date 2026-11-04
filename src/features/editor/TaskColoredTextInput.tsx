import {type ChangeEvent, type SyntheticEvent, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {TaskColorPicker} from './TaskNameColor';
import {GameText, plainGameText} from './GameText';
import './colored-text.css';

type Input = HTMLInputElement | HTMLTextAreaElement;
type Selection = { start: number; end: number };
const codes = /\^([0-9a-f]{6})/gi;
const defaultColor = 'ffffff';

function readText(raw: string) {
    const offsets = [0];
    const colors: string[] = [];
    let position = 0;
    let color = defaultColor;
    const add = (end: number) => {
        for (; position < end; position++) {
            if (raw[position] === '\r' && position + 1 < end && raw[position + 1] === '\n') position++;
            offsets.push(position + 1);
            colors.push(color);
        }
    };
    for (const match of raw.matchAll(codes)) {
        add(match.index);
        color = match[1].toLowerCase();
        position += match[0].length;
    }
    add(raw.length);
    return {plain: plainGameText(raw).replace(/\r\n?/g, '\n'), offsets, colors};
}

function replaceText(raw: string, model: ReturnType<typeof readText>, start: number, end: number, replacement: string, color: string) {
    const prefix = raw.slice(0, model.offsets[start]);
    const suffix = raw.slice(model.offsets[end]);
    const before = model.colors[start - 1] ?? defaultColor;
    const after = model.colors[end] ?? defaultColor;
    const head = replacement && color !== before ? `^${color}` : '';
    const restore = end < model.plain.length && !/^\^[0-9a-f]{6}/i.test(suffix) &&
    after !== (replacement ? color : before) ? `^${after}` : '';
    return prefix + head + replacement + restore + suffix;
}

export function TaskColoredTextInput({
                                         label,
                                         text,
                                         change,
                                         disabled,
                                         multiline = false,
                                         maxLength = multiline ? undefined : 63,
                                         placeholder
                                     }: {
    label: string;
    text: string;
    change: (text: string) => void;
    disabled: boolean;
    multiline?: boolean;
    maxLength?: number;
    placeholder?: string;
}) {
    const model = useMemo(() => readText(text), [text]);
    const [selection, setSelection] = useState<Selection>({start: 0, end: 0});
    const [limit, setLimit] = useState(false);
    const input = useRef<Input | null>(null);
    const mirror = useRef<HTMLDivElement>(null);
    const selected = selection.start < selection.end && selection.end <= model.plain.length;

    function sync() {
        if (!input.current || !mirror.current) return;
        const width = input.current.clientWidth;
        mirror.current.style.width = width > 0 ? `${width}px` : '';
        mirror.current.scrollTop = input.current.scrollTop;
        mirror.current.scrollLeft = input.current.scrollLeft;
    }

    useLayoutEffect(sync, [text]);
    useLayoutEffect(() => {
        if (!input.current) return;
        const observer = new ResizeObserver(sync);
        observer.observe(input.current);
        return () => observer.disconnect();
    }, [multiline]);

    function remember(event: SyntheticEvent<Input>) {
        const input = event.currentTarget;
        if (document.activeElement !== input) return;
        setSelection({start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0});
        setLimit(false);
    }

    function commit(next: string) {
        if (maxLength !== undefined && next.length > maxLength) {
            setLimit(true);
            return;
        }
        setLimit(false);
        if (next !== text) change(next);
    }

    function paint(hex: string) {
        if (!selected) return;
        const {start, end} = selection;
        const visible = plainGameText(text.slice(model.offsets[start], model.offsets[end]));
        commit(replaceText(text, model, start, end, visible, hex.toLowerCase()));
    }

    function edit(event: ChangeEvent<Input>) {
        const next = event.target.value;
        const caret = event.target.selectionStart ?? next.length;
        let tail = 0;
        while (tail < model.plain.length && tail < next.length - caret &&
        model.plain[model.plain.length - tail - 1] === next[next.length - tail - 1]) tail++;
        let start = 0;
        while (start < model.plain.length - tail && start < next.length - tail && model.plain[start] === next[start]) start++;
        const end = model.plain.length - tail;
        const replacement = next.slice(start, next.length - tail);
        const color = (end > start ? model.colors[start] : model.colors[start - 1]) ?? model.colors[start] ?? defaultColor;
        commit(replaceText(text, model, start, end, replacement, color));
        setSelection({start: caret, end: caret});
    }

    const props = {
        'aria-label': label, value: model.plain, disabled, onSelect: remember, onChange: edit, onScroll: sync,
        ref: (element: Input | null) => {
            input.current = element;
        }
    };
    return <div className="task-formatted-input">
        <div className="task-color-toolbar">
            <TaskColorPicker label={selected ? `Цвет выделения · ${label}` : 'Выделите текст, чтобы изменить цвет'}
                             disabled={disabled || !selected} color={model.colors[selection.start]} change={paint}/>
        </div>
        <div className={`task-colored-field${multiline ? ' multiline' : ''}`}>
            <div className="task-color-mirror" ref={mirror} aria-hidden="true">
                {model.plain ? <GameText text={text.replace(/\r\n?/g, '\n')}/> :
                    placeholder && <span className="task-color-placeholder">{placeholder}</span>}
                {multiline && '\u200b'}
            </div>
            {multiline ? <textarea {...props} rows={4}/> : <input {...props}/>}
        </div>
        {limit && <small role="status">Лимит текста с кодами цвета · {maxLength} кодовых единиц UTF-16.</small>}
    </div>;
}
