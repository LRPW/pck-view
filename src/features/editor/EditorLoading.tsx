import {Progress, Skeleton, Stack} from '@chakra-ui/react';

export function EditorProgress({label}: { label: string }) {
    return <Progress.Root className="editor-progress" size="xs" colorPalette="teal" value={null} aria-label={label}>
        <Progress.Track><Progress.Range/></Progress.Track>
    </Progress.Root>;
}

export function EditorSkeleton({rows = 6}: { rows?: number }) {
    return <Stack className="editor-skeleton" gap="2" p="2" aria-hidden="true">
        {Array.from({length: rows}, (_, i) => <Skeleton key={i} height="7"/>)}
    </Stack>;
}
