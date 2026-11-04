import {useEffect, useState} from 'react';
import {invoke} from '@tauri-apps/api/core';

type Atlas = {
    width: number;
    height: number;
    columns: number;
    cells: Record<number, number>;
};
type DecodedAtlas = Atlas & { url: string; imageWidth: number; imageHeight: number };

export function useInventoryIcons(scopeId?: number) {
    const [atlas, setAtlas] = useState<DecodedAtlas>();
    useEffect(() => {
        setAtlas(undefined);
        if (scopeId === undefined) return;
        let stopped = false;
        let url: string | undefined;
        let worker: Worker | undefined;
        void invoke<ArrayBuffer>('gshop_inventory_atlas', {id: scopeId}).then(payload => {
            if (stopped) return;
            const headerSize = new DataView(payload).getUint32(0, true);
            const atlas: Atlas = JSON.parse(new TextDecoder().decode(new Uint8Array(payload, 4, headerSize)));
            const bytes = new Uint8Array(payload, 4 + headerSize);
            worker = new Worker(new URL('../media/texture.worker.ts', import.meta.url), {type: 'module'});
            worker.onmessage = ({data}: MessageEvent<{
                width: number;
                height: number;
                pixels: Uint8ClampedArray;
                error?: string
            }>) => {
                worker?.terminate();
                if (stopped || data.error) return;
                const canvas = document.createElement('canvas');
                canvas.width = data.width;
                canvas.height = data.height;
                const context = canvas.getContext('2d');
                if (!context) return;
                const image = context.createImageData(data.width, data.height);
                image.data.set(data.pixels);
                context.putImageData(image, 0, 0);
                canvas.toBlob(blob => {
                    if (stopped || !blob) return;
                    url = URL.createObjectURL(blob);
                    setAtlas({...atlas, url, imageWidth: data.width, imageHeight: data.height});
                });
            };
            worker.onerror = () => worker?.terminate();
            worker.postMessage({extension: 'dds', bytes}, [bytes.buffer]);
        }).catch(() => {
        });
        return () => {
            stopped = true;
            worker?.terminate();
            if (url) URL.revokeObjectURL(url);
        };
    }, [scopeId]);
    return atlas;
}

export function InventoryIcon({atlas, id}: { atlas?: DecodedAtlas; id: number }) {
    const cell = atlas?.cells[id];
    if (!atlas || cell === undefined) return <span className="shop-inventory-icon" aria-hidden="true"/>;
    const x = cell % atlas.columns * atlas.width;
    const y = Math.floor(cell / atlas.columns) * atlas.height;
    if (x + atlas.width > atlas.imageWidth || y + atlas.height > atlas.imageHeight) {
        return <span className="shop-inventory-icon" aria-hidden="true"/>;
    }
    const scale = 24 / Math.max(atlas.width, atlas.height);
    return <span className="shop-inventory-icon" aria-hidden="true" style={{
        width: atlas.width * scale,
        height: atlas.height * scale,
        backgroundImage: `url("${atlas.url}")`,
        backgroundSize: `${atlas.imageWidth * scale}px ${atlas.imageHeight * scale}px`,
        backgroundPosition: `${-x * scale}px ${-y * scale}px`,
    }}/>;
}
