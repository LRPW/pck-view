import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

const js = ts.transpileModule(readFileSync(new URL('../src/features/editor/dcf.ts', import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext}}).outputText;
const {
    parseDcf,
    updateDcf,
    appendDcfRow,
    deleteDcfRow,
    dcfFileKey,
    validateDcf
} = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
test('preserves comments, BOM, whitespace and CRLF when editing', () => {
    const text = '\uFEFF# windows\r\nlogin.xml\t-10  20\t0 // hidden\r\nother.xml 0 0 1\r\n';
    const p = parseDcf(text);
    assert.equal(p.rows.length, 2);
    assert.deepEqual(p.invalid, []);
    assert.equal(updateDcf(text, p.rows[0], 1, '15'), text.replace('-10', '15'));
    assert.equal(updateDcf(text, p.rows[0], 3, '1'), text.replace('0 // hidden', '1 // hidden'));
});
test('malformed rows remain unchanged and nonzero visibility is supported', () => {
    const text = '// comment\nbad.xml nope 1 0\nokay.xml 4 -5 2\n';
    const p = parseDcf(text);
    assert.deepEqual(p.invalid, [2]);
    assert.equal(p.rows[0].visible, true);
    assert.equal(updateDcf(text, p.rows[0], 2, '9'), text.replace('4 -5 2', '4 9 2'));
});

test('adding and deleting rows preserve comments and line endings', () => {
    const original = '# layout\r\nold.xml 1 2 1';
    const added = appendDcfRow(original, 'faces/new.xml');
    assert.equal(added, original + '\r\nfaces/new.xml 0 0 0\r\n');
    const rows = parseDcf(added).rows;
    assert.equal(deleteDcfRow(added, rows[0]), '# layout\r\nfaces/new.xml 0 0 0\r\n');
});

test('detects missing and duplicate interfaces with normalized paths', () => {
    const rows = parseDcf('faces/a.xml 0 0 1\nInterfaces\\Faces\\A.XML 1 2 0\nmissing.xml 0 0 0').rows;
    const result = validateDcf(rows, ['archives/interfaces.pck/interfaces/faces/a.xml']);
    assert.deepEqual(result.get(0), {missing: false, duplicate: true});
    assert.deepEqual(result.get(1), {missing: false, duplicate: true});
    assert.deepEqual(result.get(2), {missing: true, duplicate: false});
    assert.equal(dcfFileKey('./faces/../faces/A.xml'), 'faces/a.xml');
});
