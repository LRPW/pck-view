import {ChakraProvider} from '@chakra-ui/react';
import {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {forgeSystem} from './app/theme';
import {ResourceContext} from './features/editor/resource-context';
import {GameFonts, useGameFonts} from './features/media/GameFonts';
import {InterfacePreview} from './features/media/InterfacePreview';

declare global {
    interface Window {
        previewInput: {
            text: string;
            file: string;
            dialogs: Record<string, string>;
            textures: Record<string, string>;
            fonts: Record<string, string>
        };
        previewReady?: { textures: number; fonts: number; missing: string[] };
    }
}

const input = window.previewInput;
const entries = Object.keys(input.dialogs).map(name => ({name}));
const bytes = (base64: string | undefined) => {
    if (!base64) throw Error('Resource unavailable');
    return Uint8Array.from(atob(base64), value => value.charCodeAt(0));
};
const invoke = async <T, >(command: string, args: Record<string, unknown> = {}): Promise<T> => {
    if (command === 'read_entry') return bytes(input.dialogs[entries[Number(args.index)]?.name]) as T;
    if (command === 'read_surface_texture') return bytes(input.textures[String(args.name)]) as T;
    if (command === 'read_ui_font') return bytes(input.fonts[String(args.source)]).buffer as T;
    if (command === 'list_ui_fonts') return {scope: 'mcp', sources: Object.keys(input.fonts)} as T;
    throw Error('Unsupported preview command: ' + command);
};

function Preview() {
    const {names, status} = useGameFonts(entries);
    const [report, setReport] = useState<{ textures: number; missing: string[] }>();
    useEffect(() => {
        if (!status.loading && report) {
            void document.fonts.ready.then(() => {
                window.previewReady = {
                    ...report, fonts: status.total - status.failed.length,
                    missing: [...report.missing, ...status.failed]
                };
            });
        }
    }, [status, report]);
    return <GameFonts.Provider value={names}>
        <InterfacePreview text={input.text} entries={entries} fileName={input.file} disabled capture={setReport}/>
    </GameFonts.Provider>;
}

document.documentElement.classList.add('dark');
createRoot(document.getElementById('root')!).render(
    <ChakraProvider value={forgeSystem}>
        <ResourceContext.Provider value={{invoke, active: true}}><Preview/></ResourceContext.Provider>
    </ChakraProvider>
);
