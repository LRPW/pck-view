import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

const source = readFileSync(new URL('../src/features/media/flex-layout.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext}}).outputText;
const {measureFlex, flexLayout} = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const element = (tagName, props = {}, children = []) => ({
    tagName,
    attributes: Object.entries(props).map(([name, value]) => ({name, value: String(value)})),
    children
});
const control = (w, h) => element('LABEL', {Name: 'item', Width: w, Height: h});
test('row autosize includes gap and padding', () => {
    const box = measureFlex(element('DIV', {Padding: 4, Gap: 6}, [control(20, 10), control(30, 16)]));
    assert.deepEqual([box.width, box.height], [64, 24]);
    assert.deepEqual(box.children.map(c => [c.x, c.y]), [[4, 4], [30, 4]]);
});
test('fixed column aligns both axes', () => {
    const box = measureFlex(element('DIV', {
        Direction: 'column',
        AutoSize: 'false',
        Width: 100,
        Height: 100,
        VerticalAlign: 2,
        HorizontalAlign: 1,
        Gap: 4,
        Padding: 2
    }, [control(20, 10), control(40, 20)]));
    assert.deepEqual(box.children.map(c => [c.x, c.y]), [[40, 64], [30, 78]]);
});
test('nested containers retain source hierarchy and accumulate coordinates', () => {
    const child = control(20, 10);
    const inner = element('DIV', {Padding: 3}, [child]);
    const outer = element('DIV', {x: 10, y: 20, Padding: 2}, [inner]);
    const root = element('DIALOG', {}, [outer]);
    const layout = flexLayout(root);
    assert.deepEqual([layout.get(child).x, layout.get(child).y], [15, 25]);
    assert.equal(root.children[0], outer);
    assert.equal(inner.children[0], child);
});
test('empty containers use padding as intrinsic size', () => {
    const box = measureFlex(element('DIV', {Padding: 5}));
    assert.deepEqual([box.width, box.height], [10, 10]);
});
