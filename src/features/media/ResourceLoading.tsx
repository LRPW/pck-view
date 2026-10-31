import {Spinner} from '@chakra-ui/react';

export function ResourceLoading({label, completed, total, detail}: {
    label: string;
    completed?: number;
    total?: number;
    detail?: string
}) {
    return <div className="resource-loading" role="status" aria-live="polite">
        <Spinner size="xs" color="teal.300" flexShrink="0"/>
        <div><span>{label}{total !== undefined ? ` · ${completed ?? 0}/${total}` : ''}</span>
            {total !== undefined && total > 0 && <progress value={completed ?? 0} max={total} aria-label={label}/>}
            {detail && <small title={detail}>{detail}</small>}
        </div>
    </div>;
}
