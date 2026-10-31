import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

const source = readFileSync(new URL('../src/features/media/gfx-animation.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext}}).outputText;
const {keys, sampleKey, random} = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
test('GFX keys interpolate position, scale, rotation and alpha across segment boundaries', () => {
    const frames = keys('InterpolateMode: 1\nTimeSpan: 1000\nPosition: 0, 0, 0\nScale: 1\nRad_2D: 0\nColor: 4294967295\nInterpolateMode: 0\nTimeSpan: 500\nPosition: 100, 20, 0\nScale: 3\nRad_2D: 2\nColor: 16777215\n');
    const mid = sampleKey(frames, 500);
    assert.equal(mid.x, 50);
    assert.equal(mid.y, 10);
    assert.equal(mid.scale, 2);
    assert.equal(mid.rotation, 1);
    assert.equal(mid.alpha, .5);
    assert.equal(sampleKey(frames, 1000).x, 100);
    assert.equal(sampleKey(frames, 99999).x, 100);
    frames[0].mode = 0;
    assert.equal(sampleKey(frames, 500).x, 0);
});
test('particle random stream is reproducible and bounded', () => {
    for (let i = 0; i < 1000; i++) {
        assert.equal(random(i), random(i));
        assert.ok(random(i) >= 0 && random(i) < 1);
    }
});
