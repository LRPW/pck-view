import {createSlice, type PayloadAction} from '@reduxjs/toolkit';
import type {Tab} from '../app/ide-types';
import type {IdeHit} from '../features/search/IdeSearchWindow';

export type OperationProgress = { stage: string; completed: number; total: number };
type WorkspaceState = {
    tabs: Tab[];
    active: string;
    busy: boolean;
    status: string;
    error: string;
    opening?: string;
    openProgress?: OperationProgress;
    textExport?: OperationProgress & { operation: string };
    exportRevision: number;
    fileRevisions: Record<string, number>;
    savedArchives: Record<number, boolean>;
};

const initialState: WorkspaceState = {
    tabs: [], active: '', busy: false, status: '', error: '',
    exportRevision: 0, fileRevisions: {}, savedArchives: {},
};

export const workspaceSlice = createSlice({
    name: 'workspace',
    initialState,
    reducers: {
        tabOpened(state, {payload}: PayloadAction<Tab>) {
            if (!state.tabs.some(tab => tab.key === payload.key)) state.tabs.push(payload);
            state.active = payload.key;
        },
        setActive(state, {payload}: PayloadAction<string>) {
            if (state.tabs.some(tab => tab.key === payload)) state.active = payload;
        },
        tabClosed(state, {payload}: PayloadAction<string>) {
            const index = state.tabs.findIndex(tab => tab.key === payload);
            if (index < 0) return;
            state.tabs.splice(index, 1);
            if (state.active === payload) state.active = state.tabs[Math.max(0, index - 1)]?.key ?? '';
            delete state.fileRevisions[payload];
        },
        tabDirtyChanged(state, {payload}: PayloadAction<{ key: string; dirty: boolean }>) {
            const tab = state.tabs.find(tab => tab.key === payload.key);
            if (tab) tab.dirty = payload.dirty;
        },
        tabSearchJumpChanged(state, {payload}: PayloadAction<{ key: string; hit: IdeHit['hit'] }>) {
            const tab = state.tabs.find(tab => tab.key === payload.key);
            if (tab) tab.jump = payload.hit;
        },
        tabItemJumpChanged(state, {payload}: PayloadAction<{ key: string; id: number; npc?: boolean }>) {
            const tab = state.tabs.find(tab => tab.key === payload.key);
            if (tab) tab.itemJump = {id: payload.id, npc: payload.npc};
        },
        archiveDirtyChanged(state, {payload}: PayloadAction<{ id: number; dirty: boolean }>) {
            state.savedArchives[payload.id] = payload.dirty;
        },
        filesChanged(state, {payload}: PayloadAction<{ scope: number; indices: number[] }>) {
            for (const index of payload.indices) {
                const key = payload.scope + ':' + index;
                state.fileRevisions[key] = (state.fileRevisions[key] ?? 0) + 1;
            }
        },
        exportRevisionChanged(state) {
            state.exportRevision++;
        },
        setBusy(state, {payload}: PayloadAction<boolean>) {
            state.busy = payload;
        },
        setStatus(state, {payload}: PayloadAction<string>) {
            state.status = payload;
        },
        setError(state, {payload}: PayloadAction<string>) {
            state.error = payload;
        },
        setOpening(state, {payload}: PayloadAction<string | undefined>) {
            state.opening = payload;
        },
        setOpenProgress(state, {payload}: PayloadAction<OperationProgress | undefined>) {
            state.openProgress = payload;
        },
        setTextExport(state, {payload}: PayloadAction<WorkspaceState['textExport']>) {
            state.textExport = payload;
        },
        textExportProgressChanged(state, {payload}: PayloadAction<NonNullable<WorkspaceState['textExport']>>) {
            if (state.textExport) state.textExport = payload;
        },
    },
});

export const workspaceActions = workspaceSlice.actions;
