import {useRef} from 'react';
import './column-divider.css';

export function ColumnDivider({label, onDelta, orientation = 'vertical'}: {
    label: string;
    onDelta: (pixels: number) => void;
    orientation?: 'vertical' | 'horizontal';
}) {
    const horizontal = orientation === 'horizontal';
    const drag = useRef<{ pointer: number; position: number } | null>(null);
    return <div className="column-divider" role="separator" aria-label={label}
                aria-orientation={orientation} tabIndex={0}
                onPointerDown={event => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    drag.current = {pointer: event.pointerId, position: horizontal ? event.clientY : event.clientX};
                    event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={event => {
                    if (drag.current?.pointer !== event.pointerId) return;
                    const position = horizontal ? event.clientY : event.clientX;
                    const delta = position - drag.current.position;
                    drag.current.position = position;
                    onDelta(delta);
                }}
                onLostPointerCapture={() => {
                    drag.current = null;
                }}
                onKeyDown={event => {
                    const backward = horizontal ? 'ArrowUp' : 'ArrowLeft';
                    const forward = horizontal ? 'ArrowDown' : 'ArrowRight';
                    if (event.key !== backward && event.key !== forward) return;
                    event.preventDefault();
                    onDelta((event.key === backward ? -1 : 1) * (event.shiftKey ? 32 : 8));
                }}/>;
}

export function resizeWidth(width: number, delta: number, min: number, max: number) {
    return Math.max(min, Math.min(max, width + delta));
}
