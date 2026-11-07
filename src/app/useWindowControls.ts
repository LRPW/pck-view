import {getCurrentWindow} from '@tauri-apps/api/window';
import {isTauri} from '@tauri-apps/api/core';
import {useCallback, useEffect, useState} from 'react';
import {message, t} from '../i18n';
import {notifications} from './notifications';

function reportWindowError(error: unknown) {
    notifications.create({
        type: 'error',
        title: t('Window action failed'),
        description: message(String(error)),
    });
}

export function useWindowControls() {
    const available = isTauri();
    const [maximized, setMaximized] = useState(false);

    useEffect(() => {
        if (!available) return;
        const window = getCurrentWindow();
        let disposed = false;
        const refresh = async () => {
            try {
                const value = await window.isMaximized();
                if (!disposed) setMaximized(value);
            } catch (error) {
                if (!disposed) reportWindowError(error);
            }
        };
        void refresh();
        const listener = window.onResized(refresh);
        void listener.catch(reportWindowError);
        return () => {
            disposed = true;
            void listener.then(unlisten => unlisten()).catch(() => {
            });
        };
    }, [available]);

    const minimize = useCallback(() => {
        void getCurrentWindow().minimize().catch(reportWindowError);
    }, []);
    const toggleMaximize = useCallback(() => {
        void getCurrentWindow().toggleMaximize().catch(reportWindowError);
    }, []);
    const close = useCallback(() => {
        // close() emits onCloseRequested, preserving the unsaved-document guard.
        void getCurrentWindow().close().catch(reportWindowError);
    }, []);

    return {available, maximized, minimize, toggleMaximize, close};
}
