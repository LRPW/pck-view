import {forwardRef, useEffect, useImperativeHandle, useRef} from 'react';
import {basicSetup} from 'codemirror';
import {Compartment, EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {xml} from '@codemirror/lang-xml';
import {json} from '@codemirror/lang-json';
import {javascript} from '@codemirror/lang-javascript';
import {StreamLanguage} from '@codemirror/language';
import {lua} from '@codemirror/legacy-modes/mode/lua';
import {properties} from '@codemirror/legacy-modes/mode/properties';
import {oneDark} from '@codemirror/theme-one-dark';

export type TextEditorHandle = { reveal: (from: number, to: number) => void };

function language(name: string) {
    const ext = name.split('.').pop()?.toLowerCase();
    if (ext === 'xml') return xml();
    if (ext === 'json') return json();
    if (['js', 'jsx', 'ts', 'tsx'].includes(ext ?? '')) return javascript({
        typescript: ext === 'ts' || ext === 'tsx',
        jsx: ext === 'jsx' || ext === 'tsx'
    });
    if (ext === 'lua') return StreamLanguage.define(lua);
    if (['ini', 'cfg', 'conf', 'properties'].includes(ext ?? '')) return StreamLanguage.define(properties);
    return [];
}

export const TextEditor = forwardRef<TextEditorHandle, {
    value: string;
    fileName: string;
    readOnly: boolean;
    onChange: (value: string) => void
}>(function TextEditor({value, fileName, readOnly, onChange}, ref) {
    const host = useRef<HTMLDivElement>(null);
    const view = useRef<EditorView | null>(null);
    const callback = useRef(onChange);
    callback.current = onChange;
    const languageSlot = useRef(new Compartment());
    const editableSlot = useRef(new Compartment());
    const externalUpdate = useRef(false);
    useImperativeHandle(ref, () => ({
        reveal(from, to) {
            const editor = view.current;
            if (!editor) return;
            const start = Math.max(0, Math.min(from, editor.state.doc.length));
            const end = Math.max(start, Math.min(to, editor.state.doc.length));
            editor.dispatch({
                selection: {anchor: start, head: end},
                effects: EditorView.scrollIntoView(start, {y: 'center'})
            });
            editor.focus();
        }
    }), []);
    useEffect(() => {
        if (!host.current) return;
        const editor = new EditorView({
            parent: host.current, state: EditorState.create({
                doc: value, extensions: [
                    basicSetup, oneDark,
                    languageSlot.current.of(language(fileName)),
                    editableSlot.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
                    EditorState.tabSize.of(4),
                    EditorView.updateListener.of(update => {
                        if (update.docChanged && !externalUpdate.current) callback.current(update.state.doc.toString());
                    }),
                    EditorView.theme({
                        '&': {height: '100%', fontSize: '14px'},
                        '.cm-scroller': {
                            overflow: 'auto',
                            fontFamily: 'Consolas, "Cascadia Mono", monospace',
                            lineHeight: '21px'
                        },
                        '.cm-content': {minHeight: '100%'}
                    })
                ]
            })
        });
        view.current = editor;
        return () => {
            view.current = null;
            editor.destroy();
        };
    }, []);
    useEffect(() => {
        const editor = view.current;
        if (!editor || editor.state.doc.toString() === value) return;
        externalUpdate.current = true;
        try {
            editor.dispatch({changes: {from: 0, to: editor.state.doc.length, insert: value}});
        } finally {
            externalUpdate.current = false;
        }
    }, [value]);
    useEffect(() => {
        view.current?.dispatch({effects: languageSlot.current.reconfigure(language(fileName))});
    }, [fileName]);
    useEffect(() => {
        view.current?.dispatch({effects: editableSlot.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)])});
    }, [readOnly]);
    return <div className="code-editor" ref={host} aria-label={`Текстовый редактор: ${fileName}`}/>;
});
