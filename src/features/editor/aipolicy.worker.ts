import type {AiPolicy} from './aipolicy-data';
import {transfer} from './aipolicy-data';

self.onmessage = ({data}: MessageEvent<ArrayBuffer | AiPolicy[]>) => {
    try {
        if (data instanceof ArrayBuffer) self.postMessage({policies: transfer(new Uint8Array(data))});
        else {
            const encoded = transfer(null, data);
            self.postMessage({encoded}, {transfer: [encoded.buffer]});
        }
    } catch (error) {
        self.postMessage({error: String(error)});
    }
};
