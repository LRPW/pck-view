export function RecordLink({value, label, busy, open, npc = false}: {
    value: string; label: string; busy: boolean; open: (id: number, npc?: boolean) => void; npc?: boolean;
}) {
    const id = Number(value);
    return <button type="button" className="resource-picker-button"
                   title="Открыть запись в elements.data" aria-label={`Открыть запись в elements.data · ${label}`}
                   disabled={busy || !/^\d+$/.test(value.trim()) || id > 0xffffffff || id === 0}
                   onClick={() => open(id, npc)}>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2">
            <path d="M5 19 19 5M8 5h11v11"/>
        </svg>
    </button>;
}
