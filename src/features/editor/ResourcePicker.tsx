import {t} from "../../i18n";
import {Box, Button, Field, Input} from "@chakra-ui/react";
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
        <Box className="resource-picker-body">
            <Box className="resource-picker-header">
                <strong id={title}>{t("Choose file for ")}{field}</strong>
                <Button type="button" aria-label={t("Close")} onClick={cancel}>×</Button>
            </Box>
            <Field.Root width="auto"><Input ref={search} aria-label={t("Find files")} placeholder={t("Searching…")}
                                            value={query}
                                            onChange={event => setQuery(event.target.value)}/></Field.Root>
            <ArchiveTree entries={entries} query={query} busy={busy} choose={choose}/>
        </Box>
    </dialog>;
}
