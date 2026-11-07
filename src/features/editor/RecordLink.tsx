import {t} from "../../i18n";
import {Button} from '@chakra-ui/react';

export function RecordLink({value, label, busy, open, npc = false}: {
    value: string; label: string; busy: boolean; open: (id: number, npc?: boolean) => void; npc?: boolean;
}) {
    const id = Number(value);
    return <Button type="button" className="resource-picker-button"
                   title={t("Open record in elements.data")}
                   aria-label={t("Open record in elements.data · {value0}", {value0: label})}
                   disabled={busy || !/^\d+$/.test(value.trim()) || id > 0xffffffff || id === 0}
                   onClick={() => open(id, npc)}>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2">
            <path d="M5 19 19 5M8 5h11v11"/>
        </svg>
    </Button>;
}
