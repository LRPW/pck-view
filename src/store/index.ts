import {configureStore} from '@reduxjs/toolkit';
import {useDispatch, useSelector, useStore} from 'react-redux';
import {workspaceSlice} from './workspace-slice';

export const store = configureStore({
    reducer: {workspace: workspaceSlice.reducer},
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
export const useAppStore = useStore.withTypes<typeof store>();
