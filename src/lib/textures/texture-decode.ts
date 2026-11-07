export type Texture = { width: number; height: number; pixels: Uint8ClampedArray };

function allocate(width: number, height: number): Texture {
    if (!width || !height || width > 16384 || height > 16384 || width * height > 32 * 1024 * 1024) throw Error("Invalid texture size");
    return {width, height, pixels: new Uint8ClampedArray(width * height * 4)};
}

export function decodeTga(b: Uint8Array): Texture {
    if (b.length < 18) throw Error("Truncated TGA header");
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength), type = b[2], rle = type >= 9,
        kind = rle ? type - 8 : type;
    if (![1, 2, 3].includes(kind)) throw Error("Unsupported TGA type");
    const out = allocate(v.getUint16(12, true), v.getUint16(14, true));
    const depth = b[16], descriptor = b[17];
    let pos = 18 + b[0];
    if (descriptor & 192) throw Error("Interlaced TGA is unsupported");

    function read(n: number) {
        if (pos + n > b.length) throw Error("Truncated TGA data");
        const s = b.subarray(pos, pos + n);
        pos += n;
        return s;
    }

    function color(bits: number, gray = false): number[] {
        const p = read(Math.ceil(bits / 8));
        if (gray) {
            if (bits !== 8 && bits !== 16) throw Error("Unsupported TGA depth");
            return [p[0], p[0], p[0], bits === 16 ? p[1] : 255];
        }
        if (bits === 15 || bits === 16) {
            const n = p[0] | p[1] << 8;
            return [Math.round(((n >> 10) & 31) * 255 / 31), Math.round(((n >> 5) & 31) * 255 / 31), Math.round((n & 31) * 255 / 31), bits === 16 && (descriptor & 15) ? (n & 32768 ? 255 : 0) : 255];
        }
        if (bits !== 24 && bits !== 32) throw Error("Unsupported TGA depth");
        return [p[2], p[1], p[0], bits === 32 ? p[3] : 255];
    }

    const palette = new Map<number, number[]>();
    if (b[1] === 1) {
        const start = v.getUint16(3, true), count = v.getUint16(5, true);
        for (let i = 0; i < count; i++) palette.set(start + i, color(b[7]));
    } else if (b[1] !== 0 || kind === 1) throw Error("Invalid TGA palette");

    function pixel() {
        if (kind !== 1) return color(depth, kind === 3);
        if (depth !== 8 && depth !== 16) throw Error("Unsupported TGA index");
        const p = read(depth / 8), c = palette.get(p[0] | (depth === 16 ? p[1] << 8 : 0));
        if (!c) throw Error("Index outside palette");
        return c;
    }

    let count = 0;
    const total = out.width * out.height;

    function put(c: number[]) {
        const x = count % out.width, y = Math.floor(count / out.width), dx = descriptor & 16 ? out.width - 1 - x : x,
            dy = descriptor & 32 ? y : out.height - 1 - y;
        out.pixels.set(c, (dy * out.width + dx) * 4);
        count++;
    }

    while (count < total) {
        const header = rle ? read(1)[0] : 0, n = rle ? (header & 127) + 1 : 1;
        if (count + n > total) throw Error("Invalid TGA RLE");
        if (rle && (header & 128)) {
            const c = pixel();
            for (let i = 0; i < n; i++) put(c);
        } else for (let i = 0; i < n; i++) put(pixel());
    }
    return out;
}

export function decodeDds(b: Uint8Array): Texture {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (b.length < 128 || v.getUint32(0, true) !== 0x20534444 || v.getUint32(4, true) !== 124 || v.getUint32(76, true) !== 32) throw Error("Invalid DDS header");
    const out = allocate(v.getUint32(16, true), v.getUint32(12, true)), flags = v.getUint32(80, true),
        four = String.fromCharCode(...b.subarray(84, 88));
    let pos = 128, format = four;
    if (four === 'DX10') {
        if (b.length < 148) throw Error("Truncated DX10 header");
        const dxgi = v.getUint32(128, true);
        pos = 148;
        format = ({
            71: 'DXT1',
            72: 'DXT1',
            74: 'DXT3',
            75: 'DXT3',
            77: 'DXT5',
            78: 'DXT5'
        } as Record<number, string>)[dxgi];
        if (!format) throw Error("Unsupported DDS DXGI format: " + dxgi);
    }

    function require(n: number) {
        if (pos + n > b.length) throw Error("Truncated DDS data");
    }

    const rgb = (n: number) => [Math.round((n >> 11) * 255 / 31), Math.round(((n >> 5) & 63) * 255 / 63), Math.round((n & 31) * 255 / 31), 255];
    if (flags & 4) {
        if (!['DXT1', 'DXT3', 'DXT5'].includes(format)) throw Error("Unsupported DDS format: " + four);
        const blockSize = format === 'DXT1' ? 8 : 16;
        for (let y = 0; y < out.height; y += 4) for (let x = 0; x < out.width; x += 4) {
            require(blockSize);
            const base = pos + (blockSize === 16 ? 8 : 0), c0 = v.getUint16(base, true),
                c1 = v.getUint16(base + 2, true), a = rgb(c0), c = rgb(c1), colors = [a, c];
            if (c0 > c1 || format !== 'DXT1') {
                colors.push(a.map((n, i) => i === 3 ? 255 : Math.floor((2 * n + c[i]) / 3)), a.map((n, i) => i === 3 ? 255 : Math.floor((n + 2 * c[i]) / 3)));
            } else colors.push(a.map((n, i) => i === 3 ? 255 : Math.floor((n + c[i]) / 2)), [0, 0, 0, 0]);
            const indices = v.getUint32(base + 4, true), alpha = [b[pos], b[pos + 1]];
            if (format === 'DXT5') {
                if (alpha[0] > alpha[1]) for (let i = 1; i <= 6; i++) alpha.push(Math.floor(((7 - i) * alpha[0] + i * alpha[1]) / 7)); else {
                    for (let i = 1; i <= 4; i++) alpha.push(Math.floor(((5 - i) * alpha[0] + i * alpha[1]) / 5));
                    alpha.push(0, 255);
                }
            }
            for (let i = 0; i < 16; i++) {
                const dx = x + i % 4, dy = y + Math.floor(i / 4);
                if (dx >= out.width || dy >= out.height) continue;
                const color = [...colors[(indices >>> (i * 2)) & 3]];
                if (format === 'DXT3') color[3] = ((b[pos + Math.floor(i / 2)] >> ((i % 2) * 4)) & 15) * 17;
                if (format === 'DXT5') {
                    const bit = i * 3, byte = pos + 2 + Math.floor(bit / 8),
                        n = b[byte] | ((byte + 1 < pos + 8 ? b[byte + 1] : 0) << 8);
                    color[3] = alpha[(n >>> (bit % 8)) & 7];
                }
                out.pixels.set(color, (dy * out.width + dx) * 4);
            }
            pos += blockSize;
        }
    } else {
        const bits = v.getUint32(88, true), step = bits / 8;
        if (![8, 16, 24, 32].includes(bits)) throw Error("Unsupported DDS depth");
        const masks = [92, 96, 100, 104].map(o => v.getUint32(o, true));
        const channel = (n: number, mask: number, fallback: number) => {
            if (!mask) return fallback;
            let shift = 0;
            while (((mask >>> shift) & 1) === 0) shift++;
            return Math.round(((n & mask) >>> shift) / (mask >>> shift) * 255);
        };
        const pitch = (v.getUint32(8, true) & 8) ? v.getUint32(20, true) : out.width * step;
        if (pitch < out.width * step || pos + pitch * out.height > b.length) throw Error("Truncated DDS rows");
        for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
            const o = pos + y * pitch + x * step;
            let n = 0;
            for (let k = 0; k < step; k++) n = (n | (b[o + k] << (k * 8))) >>> 0;
            let color = masks.map((m, i) => channel(n, m, i === 3 ? 255 : 0));
            if (flags & 0x20000) {
                const l = channel(n, masks[0], b[o]);
                color = [l, l, l, channel(n, masks[3], 255)];
            } else if (flags & 2) color = [255, 255, 255, channel(n, masks[3] || ((2 ** bits - 1) >>> 0), 255)];
            else if (!(flags & 64)) throw Error("Unsupported DDS pixel format");
            out.pixels.set(color, (y * out.width + x) * 4);
        }
    }
    return out;
}
