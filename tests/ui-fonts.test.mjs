import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

const source = readFileSync(new URL('../src/features/media/ui-fonts.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext}}).outputText;
const {
    UI_FONTS,
    canonicalFontName,
    xmlFontName,
    normalizeUiFontNames
} = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
test('engine aliases map to four English roles while preserving custom fonts', () => {
    assert.equal(canonicalFontName('方正隶二简体'), 'default');
    assert.equal(canonicalFontName('方正细黑一简体'), 'text');
    assert.equal(canonicalFontName('方正隶变简体'), 'decorative');
    assert.equal(canonicalFontName('books'), 'text');
    assert.equal(canonicalFontName('mono'), 'mono');
    assert.equal(canonicalFontName('Custom Font'), 'Custom Font');
    assert.equal(canonicalFontName(''), '');
    assert.equal(xmlFontName('default'), '方正隶二简体');
    assert.equal(xmlFontName('text'), '方正细黑一简体');
    assert.equal(xmlFontName('books'), '方正细黑一简体');
    assert.equal(xmlFontName('decorative'), '方正隶变简体');
    assert.equal(xmlFontName('mono'), 'mono');
    assert.equal(xmlFontName('Custom Font'), 'Custom Font');
    assert.equal(UI_FONTS.find(f => f.name === 'mono').file, 'mono.ttf');
});
test('XML conversion changes font attributes only and is idempotent', () => {
    const xml = `<?xml version="1.0"?>\n<DIALOG><Text FontName="text" String="方正隶二简体"/><Text FontName='decorative'/><Text FontName="Custom Font"/><!-- <Text FontName="方正隶二简体"/> --><![CDATA[<Text FontName="方正隶二简体"/>]]></DIALOG>`;
    const expected = xml.replace('FontName="text"', 'FontName="方正细黑一简体"').replace("FontName='decorative'", "FontName='方正隶变简体'");
    assert.equal(normalizeUiFontNames(xml), expected);
    assert.equal(normalizeUiFontNames(expected), expected);
    assert.equal(normalizeUiFontNames(`<Text String='FontName="方正细黑一简体"' FontName="方正隶二简体"/>`), `<Text String='FontName="方正细黑一简体"' FontName="方正隶二简体"/>`);
});
