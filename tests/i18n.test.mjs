import ts from 'typescript';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const root = new URL('../src/', import.meta.url), source = fs.readFileSync(new URL('i18n/index.ts', root), 'utf8');
const store = new Map(), events = {}, exports = {};
const context = {
    exports,
    require: specifier => {
        if (specifier.endsWith('.json')) {
            return {default: JSON.parse(fs.readFileSync(new URL(specifier, new URL('i18n/', root)), 'utf8'))};
        }
        assert.equal(specifier, 'react');
        return {
            useSyncExternalStore: () => {
            }
        };
    },
    document: {documentElement: {}},
    localStorage: {getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v)},
    window: {addEventListener: (name, fn) => events[name] = fn}
};
vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
    }
}).outputText, context);
test('language persistence and runtime translation', () => {
    assert.equal(exports.getLanguage(), 'en');
    exports.setLanguage('ru');
    assert.equal(exports.t('Открыть PCK'), 'Открыть PCK');
    exports.setLanguage('en');
    assert.equal(store.get('lrpw.language'), 'en');
    assert.equal(exports.t('Открыть PCK'), 'Open PCK');
    assert.equal(exports.t('Запаковать в PCK'), 'Pack into PCK');
    assert.equal(exports.message('Размер распакованного файла не совпал'), 'Uncompressed file size mismatch');
    assert.equal(exports.message('Сборка готова: 1 PCK, 2 отдельных файлов. output'), 'Build complete: 1 PCK, 2 loose files. output');
    exports.setLanguage('ru');
    assert.equal(exports.t('Файл не выбран'), 'Файл не выбран');
});
test('every static UI phrase has an English translation', () => {
    exports.setLanguage('en');
    for (const file of ['app/App.tsx', 'features/search/SearchWindow.tsx', 'features/archive/ArchiveTree.tsx', 'features/media/ImageViewer.tsx', 'features/media/MediaPreview.tsx']) {
        const sf = ts.createSourceFile(file, fs.readFileSync(new URL(file, root), 'utf8'), 99, true, ts.ScriptKind.TSX);

        function visit(n) {
            if (ts.isCallExpression(n) && n.expression.getText(sf) === 't' && ts.isStringLiteral(n.arguments[0])) {
                const text = n.arguments[0].text;
                assert.ok(!/[А-Яа-яЁё]/.test(exports.t(text)), file + ': ' + text);
            }
            ts.forEachChild(n, visit);
        }

        visit(sf);
    }
});
