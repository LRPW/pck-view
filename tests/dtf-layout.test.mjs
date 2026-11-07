import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

const source = readFileSync(new URL('../src/features/editor/dtf-layout.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext}}).outputText;
const {dtfLayout, DTF_TYPES} = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
test('every creatable DTF type has a complete native token layout', () => {
    for (const version of [0, 1, 2, 3, 4, 5, 6]) for (const type of DTF_TYPES) {
        const layout = dtfLayout(type, version);
        const positions = [...Object.values(layout.attributes), ...Object.values(layout.resources), layout.font, layout.text, layout.size].filter(v => v !== undefined);
        for (const position of positions) assert.ok(position < layout.defaults.length, `${type} v${version}: token ${position}`);
    }
});
test('button resources and text positions follow DTF version', () => {
    assert.equal(dtfLayout('STILLIMAGEBUTTON', 0).text, 20);
    assert.equal(dtfLayout('STILLIMAGEBUTTON', 2).text, 21);
    assert.equal(dtfLayout('STILLIMAGEBUTTON', 4).text, 22);
    assert.equal(dtfLayout('IMAGEPICTURE', 0).resources.Gfx, undefined);
    assert.equal(dtfLayout('IMAGEPICTURE', 3).resources.Gfx, 11);
});
test('old and extended list layouts preserve their distinct offsets', () => {
    assert.equal(dtfLayout('LIST', 0, 22).attributes.MultiSel, 20);
    assert.equal(dtfLayout('LIST', 1, 27).attributes.MultiSel, 24);
    assert.equal(dtfLayout('DIALOG', 0).attributes.Alpha, 22);
});
