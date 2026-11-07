import {Box, Spinner} from "@chakra-ui/react";
import {ProgressBar, ProgressRoot} from "../../components/ui/progress";

export function ResourceLoading({label, completed, total, detail}: {
    label: string;
    completed?: number;
    total?: number;
    detail?: string
}) {
    return <Box className="resource-loading" role="status" aria-live="polite">
        <Spinner size="xs" color="teal.300" flexShrink="0"/>
        <Box><span>{label}{total !== undefined ? ` · ${completed ?? 0}/${total}` : ''}</span>
            {total !== undefined && total > 0 &&
                <ProgressRoot value={completed ?? 0} max={total} aria-label={label}><ProgressBar/></ProgressRoot>}
            {detail && <small title={detail}>{detail}</small>}
        </Box>
    </Box>;
}
