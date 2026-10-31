import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

const source = readFileSync(new URL('../src/features/media/font-names.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext}}).outputText;
const {fontNames} = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
test('font names preserve localized family aliases from SFNT name records', () => {
    const name = '方正细黑一简体';
    const bytes = new ArrayBuffer(46 + name.length * 2), v = new DataView(bytes);
    v.setUint32(0, 0x00010000);
    v.setUint16(4, 1);
    v.setUint32(12, 0x6e616d65);
    v.setUint32(20, 28);
    v.setUint32(24, bytes.byteLength - 28);
    v.setUint16(30, 1);
    v.setUint16(32, 18);
    v.setUint16(34, 3);
    v.setUint16(36, 1);
    v.setUint16(38, 0x804);
    v.setUint16(40, 1);
    v.setUint16(42, name.length * 2);
    for (let i = 0; i < name.length; i++) v.setUint16(46 + i * 2, name.charCodeAt(i));
    assert.deepEqual(fontNames(bytes), [name]);
    v.setUint32(20, 0xfffffff0);
    assert.throws(() => fontNames(bytes), /Invalid font name table/);
});
test('truncated fonts fail before parsing arbitrary offsets', () => {
    assert.throws(() => fontNames(new ArrayBuffer(4)), /Truncated/);
});
