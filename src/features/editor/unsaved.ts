import {getCurrentWindow} from '@tauri-apps/api/window';
import {confirm} from '@tauri-apps/plugin-dialog';
import {useEffect} from 'react';

const documents = new Map<string, boolean>();
let installed = false;
let prompting = false;

export function hasUnsavedEdits() {
    return [...documents.values()].some(Boolean);
}

export function useUnsavedGuard(name: string, dirty: boolean) {
    useEffect(() => {
        documents.set(name, dirty);
        return () => {
            documents.delete(name);
        };
    }, [name, dirty]);
    useEffect(() => {
        if (installed) return;
        installed = true;
        void getCurrentWindow().onCloseRequested(async event => {
            const names = [...documents].filter(([, dirty]) => dirty).map(([name]) => name);
            if (!names.length) return;
            event.preventDefault();
            if (prompting) return;
            prompting = true;
            try {
                if (await confirm("There are unsaved changes or an operation is running: " + names.join(', ') + ". Exit without saving?", {
                    title: 'PW Forge',
                    kind: 'warning'
                })) await getCurrentWindow().destroy();
            } finally {
                prompting = false;
            }
        });
    }, []);
}
