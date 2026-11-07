import {message, t} from "../../i18n";
import {Alert, Box, Button} from "@chakra-ui/react";
import {invoke} from '@tauri-apps/api/core';
import {useEffect, useState} from 'react';
import {MediaPreview, mediaType} from './MediaPreview';

export function ResourceWindow() {
    const name = decodeURIComponent(window.location.hash.slice('#resource='.length));
    const [bytes, setBytes] = useState<number[]>(), [error, setError] = useState('');
    const [hex, setHex] = useState(false);
    useEffect(() => {
        void invoke<number[]>('read_surface_texture', {name}).then(setBytes).catch(e => setError(String(e)));
    }, [name]);
    let text = '';
    if (bytes) {
        const data = new Uint8Array(bytes);
        let encoding = data[0] === 255 && data[1] === 254 ? 'utf-16le' : data[0] === 254 && data[1] === 255 ? 'utf-16be' : 'utf-8';
        if (encoding === 'utf-8') try {
            new TextDecoder('utf-8', {fatal: true}).decode(data);
        } catch {
            encoding = 'gbk';
        }
        text = new TextDecoder(encoding).decode(data);
    }
    return <Box className="resource-window">
        <header><strong>surfaces.pck / {name}</strong>
            <Box>
                <Button onClick={() => setHex(false)}>{t("Text")}</Button>
                <Button onClick={() => setHex(true)}>HEX</Button>
            </Box>
        </header>
        {error ? <Alert.Root status="error" size="sm"
                             role="alert"><Alert.Indicator/><Alert.Content>{message(error)}</Alert.Content></Alert.Root> : !bytes ?
            <p>{t("Loading resource…")}</p> : mediaType(name) && !hex ?
                <MediaPreview name={name} bytes={bytes}/> :
                <pre>{hex ? bytes.slice(0, 65536).map((b, i) => (i % 16 === 0 ? '\n' + i.toString(16).padStart(8, '0') + '  ' : '') + b.toString(16).padStart(2, '0') + ' ').join('') : text}</pre>}
    </Box>;
}
