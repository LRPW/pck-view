import {getShortcuts, shortcutFromEvent} from '../../app/shortcuts';
import {
    findNext,
    findPrevious,
    gotoLine,
    openSearchPanel,
    replaceAll,
    replaceNext,
    search,
    selectMatches,
    selectNextOccurrence
} from '@codemirror/search';
import {redo, undo} from '@codemirror/commands';
import {foldCode, StreamLanguage, unfoldCode} from '@codemirror/language';
import {t} from "../../i18n";
import {createPortal} from 'react-dom';
import {EditorSearchPanel} from './EditorSearchPanel';
import {Box} from "@chakra-ui/react";
import {javascript} from '@codemirror/lang-javascript';
import {json} from '@codemirror/lang-json';
import {xml} from '@codemirror/lang-xml';
import {lua} from '@codemirror/legacy-modes/mode/lua';
import {properties} from '@codemirror/legacy-modes/mode/properties';
import {Compartment, EditorState, Prec} from '@codemirror/state';
import {oneDark} from '@codemirror/theme-one-dark';
import {EditorView} from '@codemirror/view';
import {basicSetup} from 'codemirror';
import {forwardRef, useEffect, useImperativeHandle, useRef, useState} from 'react';

export type TextEditorHandle = { reveal: (from: number, to: number, focus?: boolean) => void };

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
    const [panel, setPanel] = useState<{ dom: HTMLElement; editor: EditorView; revision: number } | null>(null);
    const host = useRef<HTMLDivElement>(null);
    const view = useRef<EditorView | null>(null);
    const callback = useRef(onChange);
    callback.current = onChange;
    const languageSlot = useRef(new Compartment());
    const editableSlot = useRef(new Compartment());
    const externalUpdate = useRef(false);
    useImperativeHandle(ref, () => ({
        reveal(from, to, focus = true) {
            const editor = view.current;
            if (!editor) return;
            const start = Math.max(0, Math.min(from, editor.state.doc.length));
            const end = Math.max(start, Math.min(to, editor.state.doc.length));
            editor.dispatch({
                selection: {anchor: start, head: end},
                effects: EditorView.scrollIntoView(start, {y: 'center'})
            });
            if (focus) editor.focus();
        }
    }), []);
    useEffect(() => {
        if (!host.current) return;
        const editor = new EditorView({
            parent: host.current, state: EditorState.create({
                doc: value, extensions: [
                    search({
                        top: true, createPanel: editor => {
                            const dom = document.createElement('div');
                            return {
                                dom, mount() {
                                    setPanel({dom, editor, revision: 0});
                                },
                                update() {
                                    setPanel(current => current ? {
                                        ...current,
                                        revision: current.revision + 1
                                    } : current);
                                },
                                destroy() {
                                    setPanel(null);
                                }
                            };
                        }
                    }),
                    basicSetup, oneDark,
                    Prec.highest(EditorView.domEventHandlers({
                        keydown(event, editor) {
                            const commands = {
                                find: openSearchPanel,
                                replace: openSearchPanel,
                                next: findNext,
                                previous: findPrevious,
                                replaceNext,
                                replaceAll,
                                gotoLine,
                                selectMatches,
                                selectNext: selectNextOccurrence,
                                undo,
                                redo,
                                fold: foldCode,
                                unfold: unfoldCode
                            };
                            const bindings = getShortcuts(), pressed = shortcutFromEvent(event);
                            for (const [action, command] of Object.entries(commands)) {
                                if (bindings[action as keyof typeof bindings] === pressed) {
                                    event.preventDefault();
                                    command(editor);
                                    return true;
                                }
                            }
                            // Suppress the old configurable CodeMirror bindings after reassignment.
                            return ['Ctrl+F', 'Ctrl+H', 'Ctrl+G', 'Ctrl+D', 'Ctrl+Shift+L', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+Shift+Z', 'F3', 'Shift+F3', 'Ctrl+Alt+BracketLeft', 'Ctrl+Alt+BracketRight'].includes(pressed);
                        }
                    })),
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
    return <><Box className="code-editor" ref={host}
                  aria-label={t("Text editor: {value0}", {value0: fileName})}/>{panel && createPortal(<EditorSearchPanel
        editor={panel.editor}/>, panel.dom)}</>;
});
