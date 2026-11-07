import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

const js = ts.transpileModule(readFileSync(new URL('../src/features/editor/legacy-interface.ts', import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext}}).outputText;
const {
    legacyRows,
    replaceLegacyToken
} = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
test('string tables support multiline text, BOM, comments and preserve formatting', () => {
    const source = '\uFEFF// comment\r\n1\t"first\nsecond"\r\n2 "next"\r\n';
    const rows = legacyRows(source, 'stf');
    assert.equal(rows.length, 2);
    assert.equal(rows[0][1].value, 'first\nsecond');
    assert.equal(replaceLegacyToken(source, rows[1][1], 'changed'), source.replace('"next"', '"changed"'));
});
test('DTF keeps quoted paths, empty parameters and control rows', () => {
    const rows = legacyRows('DIALOG "Win_Test" 0 0 100 200\r\nLABEL "Text" "" "" 1 2 30 40', 'dtf');
    assert.equal(rows.length, 2);
    assert.equal(rows[1][2].value, '');
    assert.equal(rows[0][1].value, 'Win_Test');
});
test('malformed entries and unsupported embedded quotes are rejected', () => {
    assert.throws(() => legacyRows('1 "missing', 'stf'));
    assert.throws(() => legacyRows('1', 'stf'));
    const source = '1 "text"';
    assert.throws(() => replaceLegacyToken(source, legacyRows(source, 'stf')[0][1], 'a"b'));
});
