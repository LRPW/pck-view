import {type ComponentProps, useEffect, useId, useRef, useState} from 'react';
import {ArchiveTree} from '../archive/ArchiveTree';

export function ResourcePicker({field, entries, busy, choose, cancel}: {
    field: string;
    entries: ComponentProps<typeof ArchiveTree>['entries'];
    busy: boolean;
    choose: (index: number) => void;
    cancel: () => void;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const search = useRef<HTMLInputElement>(null);
    const title = useId();
    const [query, setQuery] = useState('');

    useEffect(() => {
        const element = dialog.current;
        element?.showModal();
        search.current?.focus();
        return () => element?.close();
    }, []);

    return <dialog ref={dialog} className="resource-picker" aria-labelledby={title} onCancel={event => {
        event.preventDefault();
        cancel();
    }} onKeyDown={event => event.stopPropagation()}>
        <div className="resource-picker-body">
            <div className="resource-picker-header">
                <strong id={title}>Выбрать файл для {field}</strong>
                <button type="button" aria-label="Закрыть" onClick={cancel}>×</button>
            </div>
            <input ref={search} aria-label="Поиск файлов" placeholder="Поиск…" value={query}
                   onChange={event => setQuery(event.target.value)}/>
            <ArchiveTree entries={entries} query={query} busy={busy} choose={choose}/>
        </div>
    </dialog>;
}
