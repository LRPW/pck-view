import {useTheme} from 'next-themes';

export type ThemeMode = 'dark' | 'light' | 'system';

export function useAppTheme() {
    const {theme, setTheme} = useTheme();
    const mode: ThemeMode = theme === 'light' || theme === 'system' ? theme : 'dark';
    return [mode, setTheme] as const;
}
