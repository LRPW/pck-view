import {createContext, useContext} from 'react';
import {invoke as rawInvoke} from '@tauri-apps/api/core';

export type ResourceEntry = { name: string; path: string; size: number; changed: boolean };
export type ResourceScope = {
    id: number;
    path: string;
    kind: 'project' | 'archive' | 'file';
    entries: ResourceEntry[]
};
type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
export const ResourceContext = createContext<{ invoke: Invoke; active: boolean } | null>(null);

export function useResourceInvoke(): Invoke {
    return useContext(ResourceContext)?.invoke ?? rawInvoke;
}

export function useResourceActive() {
    return useContext(ResourceContext)?.active ?? true;
}

export function resourceInvoke(scope: ResourceScope, onOpen: (name: string) => void): Invoke {
    return async <T, >(command: string, args: Record<string, unknown> = {}): Promise<T> => {
        if (command === 'read_entry') return rawInvoke<T>('ide_read', {id: scope.id, index: args.index});
        if (command === 'read_surface_texture') return rawInvoke<T>('ide_resource', {id: scope.id, name: args.name});
        if (command === 'list_ui_fonts') return rawInvoke<T>('ide_fonts', {id: scope.id});
        if (command === 'read_ui_font') return rawInvoke<T>('ide_font', {id: scope.id, source: args.source});
        if (command === 'open_resource_window') {
            onOpen(String(args.name));
            return undefined as T;
        }
        if (command === 'native_gfx_create') {
            const ctx = await rawInvoke<{ root: string; name: string }>('ide_native_context', {
                id: scope.id,
                name: args.name
            });
            return rawInvoke<T>(command, {...args, ...ctx});
        }
        return rawInvoke<T>(command, args);
    };
}
