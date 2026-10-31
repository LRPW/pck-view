import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/textures/texture-decode.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022
    }
}).outputText;
const {decodeTga, decodeDds} = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

function tga(type, width, height, depth, descriptor, payload) {
    const b = new Uint8Array(18 + payload.length);
    b[2] = type;
    b[12] = width;
    b[14] = height;
    b[16] = depth;
    b[17] = descriptor;
    b.set(payload, 18);
    return b;
}

function dds(format, payload, width = 4, height = 4) {
    const b = new Uint8Array(128 + payload.length), v = new DataView(b.buffer);
    for (const [o, n] of [[0, 0x20534444], [4, 124], [12, height], [16, width], [76, 32], [80, 4]]) v.setUint32(o, n, true);
    b.set([...format].map(c => c.charCodeAt(0)), 84);
    b.set(payload, 128);
    return b;
}

test('TGA bottom origin and BGR channels', () => {
    const t = decodeTga(tga(2, 1, 2, 24, 0, [0, 0, 255, 255, 0, 0]));
    assert.deepEqual([...t.pixels], [0, 0, 255, 255, 255, 0, 0, 255]);
});
test('TGA RLE keeps alpha and horizontal origin', () => {
    const t = decodeTga(tga(10, 2, 1, 32, 0x38, [1, 0, 0, 255, 70, 0, 255, 0, 140]));
    assert.deepEqual([...t.pixels], [0, 255, 0, 140, 255, 0, 0, 70]);
});
test('TGA repeated run and grayscale', () => {
    assert.deepEqual([...decodeTga(tga(11, 2, 1, 8, 32, [129, 42])).pixels], [42, 42, 42, 255, 42, 42, 42, 255]);
});
test('TGA palette', () => {
    const b = tga(1, 1, 1, 8, 32, [0, 0, 255, 0]);
    b[1] = 1;
    b[5] = 1;
    b[7] = 24;
    assert.deepEqual([...decodeTga(b).pixels], [255, 0, 0, 255]);
});
test('DDS DXT1 transparency and partial blocks', () => {
    const t = decodeDds(dds('DXT1', [0, 0, 255, 255, 255, 255, 255, 255], 2, 1));
    assert.equal(t.pixels.length, 8);
    assert.deepEqual([...t.pixels], [0, 0, 0, 0, 0, 0, 0, 0]);
});
test('DDS DXT3 explicit alpha', () => {
    const t = decodeDds(dds('DXT3', [0xF5, 255, 255, 255, 255, 255, 255, 255, 0, 248, 0, 0, 0, 0, 0, 0]));
    assert.deepEqual([...t.pixels.slice(0, 8)], [255, 0, 0, 85, 255, 0, 0, 255]);
});
test('DDS DXT5 interpolated alpha', () => {
    const t = decodeDds(dds('DXT5', [255, 0, 2, 0, 0, 0, 0, 0, 0, 248, 0, 0, 0, 0, 0, 0]));
    assert.deepEqual([...t.pixels.slice(0, 4)], [255, 0, 0, 218]);
});
test('DDS uncompressed BGRA', () => {
    const b = dds('    ', [3, 2, 1, 4], 1, 1), v = new DataView(b.buffer);
    for (const [o, n] of [[80, 65], [88, 32], [92, 0xff0000], [96, 0xff00], [100, 0xff], [104, 0xff000000]]) v.setUint32(o, n, true);
    assert.deepEqual([...decodeDds(b).pixels], [1, 2, 3, 4]);
});
test('Truncated and invalid textures fail', () => {
    assert.throws(() => decodeDds(new Uint8Array(5)));
    assert.throws(() => decodeDds(dds('DXT5', [])));
    assert.throws(() => decodeTga(tga(10, 1, 1, 24, 0, [255, 0, 0, 0])));
});
