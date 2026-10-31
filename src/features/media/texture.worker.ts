import {decodeDds, decodeTga} from '../../lib/textures/texture-decode';

self.onmessage = (event: MessageEvent<{ extension: string; bytes: Uint8Array }>) => {
    try {
        const texture = (event.data.extension === 'dds' ? decodeDds : decodeTga)(event.data.bytes);
        self.postMessage(texture, {transfer: [texture.pixels.buffer]});
    } catch (error) {
        self.postMessage({error: String(error)});
    }
};
