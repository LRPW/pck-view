import {matchesShortcut} from './shortcuts';
import {sourceText} from "../i18n";
import {Badge, Box, Button, Field, Flex, Heading, Input, Select, Text} from '@chakra-ui/react';
import {invoke} from "@tauri-apps/api/core";
import {emitTo, listen} from "@tauri-apps/api/event";
import {
    confirm as nativeConfirm,
    type ConfirmDialogOptions,
    message as showMessage,
    open,
    save,
} from "@tauri-apps/plugin-dialog";
import type {ComponentProps} from "react";
import {useCallback, useEffect, useMemo, useRef, useState,} from "react";
import {AccordionItem, AccordionItemContent, AccordionItemTrigger, AccordionRoot} from "../components/ui/accordion";
import {ProgressBar, ProgressRoot} from "../components/ui/progress";
import {SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValueText} from "../components/ui/select";
import {ElementsEditor} from '../features/editor/ElementsEditor';
import {ProjectWorkspace} from '../features/editor/ProjectWorkspace';
import {selectCollection} from '../features/editor/select-collection';
import {TextEditor, type TextEditorHandle} from '../features/editor/TextEditor';
import {useUnsavedGuard} from '../features/editor/unsaved';
import {GfxPreview} from "../features/media/GfxPreview";
import {InterfaceEditor} from "../features/media/InterfaceEditor";
import {interfaceType} from "../features/media/InterfacePreview";
import {NativeGfxPreview} from '../features/media/NativeGfxPreview';
import {normalizeUiFontNames} from '../features/media/ui-fonts';
import {message, setLanguage, t, useLanguage} from "../i18n/index";

import {getCurrentWindow} from "@tauri-apps/api/window";
import {ArchiveTree} from "../features/archive/ArchiveTree";
import {MediaPreview, mediaType} from "../features/media/MediaPreview";
import {type SearchAction, type SearchSnapshot,} from "../features/search/SearchWindow";

function confirm(text: string, options: ConfirmDialogOptions = {}) {
    return nativeConfirm(text, {
        title: "PW Forge",
        okLabel: t("Yes"),
        cancelLabel: t("Cancel"),
        ...options,
    });
}

type Entry = {
    name: string;
    size: number;
    packed: number;
    changed: boolean;
};
type Archive = {
    path: string;
    entries: Entry[];
};

type SearchHit = {
    index: number;
    line: number;
    column: number;
    start: number;
    end: number;
    before: string;
    matched: string;
    after: string;
    encoding: string;
};
const EMPTY_ENTRIES: Entry[] = [];
type OperationProgress = {
    operation: string;
    stage: string;
    completed: number;
    total: number;
};

export function App() {
    const [elementsVisible, setElementsVisible] = useState(false);
    const [projectVisible, setProjectVisible] = useState(true);
    const [elementsPath, setElementsPath] = useState<string>();
    const [elementsProject, setElementsProject] = useState<{ manifest: string; path: string }>();
    const [extractionErrors, setExtractionErrors] = useState<string[]>([]);
    const language = useLanguage();
    const [progress, setProgress] = useState<OperationProgress>();
    const [searchProgress, setSearchProgress] = useState<OperationProgress>();
    const running = useRef(false);
    const progressListener = useRef<Promise<() => void> | undefined>(undefined);
    useEffect(() => {
        let mounted = true;
        const listener = listen<OperationProgress>("pck-progress", (event) => {
            if (!mounted) return;
            if (
                sourceText(event.payload.operation) === "Content search" &&
                activeSearch.current !== undefined
            )
                setSearchProgress(event.payload);
            else if (running.current) setProgress(event.payload);
        });
        progressListener.current = listener;
        return () => {
            mounted = false;
            void listener.then((unlisten) => unlisten());
        };
    }, []);
    const [archive, setArchive] = useState<Archive>(),
        [selected, setSelected] = useState<number>(),
        [query, setQuery] = useState(""),
        [bytes, setBytes] = useState<number[]>([]),
        [text, setText] = useState(""),
        [encoding, setEncoding] = useState("utf-8"),
        [dirty, setDirty] = useState(false),
        [pending, setPending] = useState(false),
        [busy, setBusy] = useState(false),
        [status, setStatus] = useState(t("Open a PCK to get started")),
        [tab, setTab] = useState("text"),
        [newName, setNewName] = useState("");
    const [dialogTrail, setDialogTrail] = useState<number[]>([]);
    useUnsavedGuard('PCK', dirty || pending);
    const interfaceViews = useRef(new Map<string, { selection: number; zoom: number }>());
    const chooseHandler = useRef<(index: number) => void>(() => {
    });
    chooseHandler.current = choose;
    const startupRequested = useRef(false);
    const startupEntry = useRef<string | null>(null);
    useEffect(() => {
        if (startupRequested.current) return;
        startupRequested.current = true;
        void invoke<[string, string] | null>('startup_target').then(async target => {
            if (!target && (await invoke<string | null>('project_startup') || localStorage.getItem('pwforge:last-project'))) return;
            if (target) setProjectVisible(false);
            if (!target) {
                try {
                    const saved = JSON.parse(localStorage.getItem('pckview:last-document') ?? 'null');
                    if (saved && typeof saved.path === 'string' && saved.path) {
                        target = [saved.path, typeof saved.entry === 'string' ? saved.entry : ''];
                    }
                } catch { /* A missing or invalid saved session must not prevent startup. */
                }
            }
            if (!target) return;
            const [path, entryName] = target;
            await run(async () => {
                const opened = await invoke<Archive>('open_archive', {path});
                startupEntry.current = entryName;
                setArchive(opened);
            });
        }).catch(e => setStatus(String(e)));
    }, []);
    useEffect(() => {
        if (!archive || !startupEntry.current) return;
        const normalize = (s: string) => s.replace(/\\/g, '/').replace(/^(surfaces|gfx)\//i, '').toLowerCase();
        const requested = normalize(startupEntry.current);
        startupEntry.current = null;
        const index = archive.entries.findIndex(e => normalize(e.name) === requested);
        if (index < 0) setStatus("Resource not found: " + requested);
        else chooseHandler.current(index);
    }, [archive]);
    useEffect(() => {
        if (!archive || startupEntry.current) return;
        try {
            localStorage.setItem('pckview:last-document', JSON.stringify({
                path: archive.path,
                entry: selected === undefined ? null : archive.entries[selected]?.name ?? null
            }));
        } catch { /* Keep the editor usable if storage is unavailable. */
        }
    }, [archive, selected]);

    const chooseStable = useCallback(
        (index: number) => chooseHandler.current(index),
        [],
    );
    const [contentQuery, setContentQuery] = useState("");
    const [regexp, setRegexp] = useState(false),
        [caseSensitive, setCaseSensitive] = useState(false),
        [wholeWord, setWholeWord] = useState(false);
    const [searchEncoding, setSearchEncoding] = useState("auto");
    const [includeBinary, setIncludeBinary] = useState(false);
    const [matches, setMatches] = useState<SearchHit[]>();
    const [findOpen, setFindOpen] = useState(false);
    const [activeHit, setActiveHit] = useState(-1);
    const [truncated, setTruncated] = useState(false);
    const searchInput = useRef<HTMLInputElement>(null);
    const editor = useRef<TextEditorHandle>(null);
    const jump = useRef<SearchHit | undefined>(undefined);
    useEffect(() => {
        if (findOpen) {
            void invoke("open_search_window")
                .catch((e) => setStatus(String(e)))
                .finally(() => setFindOpen(false));
        }
    }, [findOpen]);
    useEffect(() => {
        const hit = jump.current,
            el = editor.current;
        if (!hit || !el || busy || selected !== hit.index) return;
        jump.current = undefined;
        el.reveal(hit.start, hit.end);
    }, [text, selected, busy, tab]);

    async function openHit(index: number) {
        const hit = matches?.[index];
        if (!hit || busy) return;
        jump.current = hit;
        setActiveHit(index);
        setTab("text");
        await choose(hit.index, hit.encoding);
        await getCurrentWindow().setFocus();
    }

    const [searchErrors, setSearchErrors] = useState<string[]>([]);
    useEffect(() => {
        setMatches(undefined);
        setSearchErrors([]);
    }, [
        archive,
        contentQuery,
        regexp,
        caseSensitive,
        wholeWord,
        searchEncoding,
        includeBinary,
    ]);
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (matchesShortcut(event, 'open')) {
                event.preventDefault();
                if (!busy && !searching && !event.repeat) void openFile();
                return;
            }
            if (elementsVisible || projectVisible) return;
            if (event.code === "Escape" && findOpen) {
                event.preventDefault();
                setFindOpen(false);
                return;
            }
            if ((matchesShortcut(event, 'next') || matchesShortcut(event, 'previous')) && matches?.length) {
                event.preventDefault();
                void openHit(
                    (activeHit + (matchesShortcut(event, 'previous') ? -1 : 1) + matches.length) %
                    matches.length,
                );
                return;
            }
            if (
                matchesShortcut(event, 'search')
            ) {
                event.preventDefault();
                setFindOpen(true);
                searchInput.current?.focus();
                searchInput.current?.select();
                return;
            }
            if (!matchesShortcut(event, 'save') && !matchesShortcut(event, 'saveAs')) return;
            const key = event.code;

            event.preventDefault();
            if (busy || searching || event.repeat) return;
            if (archive) void saveArchive(matchesShortcut(event, 'saveAs'));
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    });
    const [searching, setSearching] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const activeSearch = useRef<number | undefined>(undefined);
    const nextSearch = useRef(Date.now());
    const batchListener = useRef<Promise<() => void> | undefined>(undefined);
    useEffect(() => {
        let mounted = true;
        const listener = listen<{ search_id: number; matches: SearchHit[] }>(
            "pck-search-results",
            (event) => {
                if (mounted && activeSearch.current === event.payload.search_id)
                    setMatches((previous) => [
                        ...(previous ?? []),
                        ...event.payload.matches,
                    ]);
            },
        );
        batchListener.current = listener;
        return () => {
            mounted = false;
            void listener.then((unlisten) => unlisten());
        };
    }, []);

    async function cancelSearch() {
        if (activeSearch.current === undefined) return;
        setCancelling(true);
        try {
            await invoke("cancel_search", {searchId: activeSearch.current});
        } catch (e) {
            setCancelling(false);
            setStatus(String(e));
        }
    }

    async function searchContents() {
        if (running.current || activeSearch.current !== undefined) return;
        const searchId = ++nextSearch.current;
        activeSearch.current = searchId;
        setSearching(true);
        setCancelling(false);
        setSearchProgress(undefined);
        try {
            if (pending) await run(apply);
            await batchListener.current;

            setMatches([]);
            setSearchErrors([]);
            setActiveHit(-1);
            setTruncated(false);

            const result = await invoke<{
                matches: SearchHit[];
                errors: string[];
                truncated: boolean;
                cancelled: boolean;
            }>("search_contents", {
                searchId,
                query: contentQuery,
                regexp,
                caseSensitive,
                wholeWord,
                includeBinary,
                encoding: searchEncoding,
            });
            activeSearch.current = undefined;
            setMatches(result.matches);
            setTruncated(result.truncated);
            setSearchErrors(result.errors);
            setStatus(
                (result.cancelled ? t("Search cancelled") : t("Search complete")) +
                ": matches found: " +
                result.matches.length.toLocaleString() +
                ", read errors: " +
                result.errors.length,
            );
        } catch (error) {
            setStatus(String(error));
        } finally {
            activeSearch.current = undefined;
            setSearching(false);
            setCancelling(false);
        }
    }

    const snapshot: SearchSnapshot = {
        contentQuery,
        regexp,
        caseSensitive,
        wholeWord,
        searchEncoding,
        includeBinary,
        matches,
        searchErrors,
        activeHit,
        truncated,
        busy,
        searching,
        cancelling,
        searchProgress,
        archive: archive
            ? {
                entries: Object.fromEntries(
                    (matches ?? []).map((hit) => [
                        hit.index,
                        {name: archive.entries[hit.index]?.name ?? ""},
                    ]),
                ),
            }
            : undefined,
    };
    const latestSnapshot = useRef(snapshot);
    latestSnapshot.current = snapshot;
    const publish = () =>
        emitTo("search", "search-state", latestSnapshot.current);
    const actionHandler = useRef<(a: SearchAction) => void>(() => {
    });
    actionHandler.current = ({action, value}) => {
        if (action === "ready") {
            void publish();
            return;
        }
        if (action === "hit") {
            void openHit(Number(value));
            return;
        }
        if (action === "next" || action === "previous") {
            if (matches?.length)
                void openHit(
                    (activeHit +
                        (action === "next" ? 1 : -1) +
                        matches.length) %
                    matches.length,
                );
            return;
        }
        if (action === "cancel") {
            void cancelSearch();
            return;
        }
        if (busy || searching) return;
        if (action === "search") {
            if (archive && contentQuery) void searchContents();
            return;
        }
        if (action === "contentQuery") setContentQuery(String(value));
        if (action === "regexp") setRegexp(Boolean(value));
        if (action === "caseSensitive") setCaseSensitive(Boolean(value));
        if (action === "wholeWord") setWholeWord(Boolean(value));
        if (action === "searchEncoding") setSearchEncoding(String(value));
        if (action === "includeBinary") setIncludeBinary(Boolean(value));
    };
    useEffect(() => {
        const listener = listen<SearchAction>("search-action", (event) =>
            actionHandler.current(event.payload),
        );
        return () => {
            void listener.then((fn) => fn());
        };
    }, []);
    useEffect(() => {
        const timer = setTimeout(() => {
            void publish();
        }, 40);
        return () => clearTimeout(timer);
    }, [
        contentQuery,
        regexp,
        caseSensitive,
        wholeWord,
        searchEncoding,
        includeBinary,
        matches,
        searchErrors,
        activeHit,
        truncated,
        busy,
        searching,
        cancelling,
        searchProgress,
        archive,
    ]);
    const entry =
        selected === undefined ? undefined : archive?.entries[selected];

    async function run(fn: () => Promise<void>) {
        if (running.current) return;
        running.current = true;
        setBusy(true);
        setProgress(undefined);
        try {
            await progressListener.current;
            await new Promise<void>((resolve) =>
                requestAnimationFrame(() => resolve()),
            );
            await fn();
        } catch (e) {
            setStatus(String(e));
        } finally {
            running.current = false;
            setBusy(false);
            setProgress(undefined);
        }
    }

    async function discard() {
        return (
            !pending ||
            (await confirm(t("Discard unsaved text changes?"), {
                title: "PW Forge",
                kind: "warning",
            }))
        );
    }

    function decode(data: number[], enc: string, fileName = selected === undefined ? '' : archive?.entries[selected]?.name ?? '') {
        const decoded = new TextDecoder(enc, {ignoreBOM: true}).decode(new Uint8Array(data));
        const normalized = interfaceType(fileName) ? normalizeUiFontNames(decoded) : decoded;
        setText(normalized);
        setPending(normalized !== decoded);
    }

    async function choose(i: number, forcedEncoding?: string, trail?: number[]) {
        if (!(await discard())) return;
        await run(async () => {
            const b = await invoke<number[]>("read_entry", {index: i});
            setSelected(i);
            setBytes(b);
            let enc = encoding;
            if (b[0] === 255 && b[1] === 254) enc = "utf-16le";
            else if (b[0] === 254 && b[1] === 255) enc = "utf-16be";
            else {
                const sample = b.slice(0, 4096);
                let odd = 0,
                    even = 0;
                for (let j = 0; j < sample.length; j++)
                    if (sample[j] === 0) {
                        if (j % 2) odd++;
                        else even++;
                    }
                if (
                    sample.length >= 16 &&
                    odd > sample.length / 4 &&
                    even < sample.length / 20
                )
                    enc = "utf-16le";
                else if (
                    sample.length >= 16 &&
                    even > sample.length / 4 &&
                    odd < sample.length / 20
                )
                    enc = "utf-16be";
                else {
                    try {
                        new TextDecoder("utf-8", {fatal: true}).decode(
                            new Uint8Array(b),
                        );
                        enc = "utf-8";
                    } catch {
                        enc = "gbk";
                    }
                }
            }
            enc = forcedEncoding ?? enc;
            setEncoding(enc);
            setTab(
                !forcedEncoding && (mediaType(archive!.entries[i].name) || interfaceType(archive!.entries[i].name) || /\.(gfx|mox|ecm|smd|ski|bon)$/i.test(archive!.entries[i].name))
                    ? "preview"
                    : "text",
            );
            if (forcedEncoding || !mediaType(archive!.entries[i].name))
                decode(b, enc, archive!.entries[i].name);
            else {
                setText("");
                setPending(false);
            }
            setStatus(archive!.entries[i].name);
            setDialogTrail(trail ?? [i]);
        });
    }

    async function openArchive(selectedPath?: string) {
        if (
            (dirty || pending) &&
            !(await confirm(t("Open another archive and discard changes?")))
        )
            return;
        const path = selectedPath ?? await open({
            filters: [{name: "Perfect World Archive", extensions: ["pck"]}],
        });
        if (typeof path === "string")
            await run(async () => {
                const a = await invoke<Archive>("open_archive", {path});
                setArchive(a);
                setSelected(undefined);
                setDirty(false);
                setPending(false);
                setStatus(t("Archive opened"));
                setElementsVisible(false);
                setProjectVisible(false);
            });
    }

    async function openFile() {
        const path = await open({
            multiple: false,
            filters: [{name: 'PW Forge', extensions: ['pwforge', 'pck', 'data']}]
        });
        if (typeof path !== 'string') return;
        const name = path.replace(/\\/g, '/').split('/').pop()!.toLowerCase();
        if (name.endsWith('.pwforge')) {
            window.dispatchEvent(new CustomEvent('pwforge-open-project', {detail: path}));
            setElementsVisible(false);
            setProjectVisible(true);
        } else if (name.endsWith('.pck')) {
            await openArchive(path);
        } else if (/^elements(?:[._-].*)?\.data$/i.test(name)) {
            setElementsProject(undefined);
            setElementsPath(path);
            setElementsVisible(true);
        } else {
            await showMessage(t("No editor is available for “{value0}”.", {value0: name}), {
                title: 'PW Forge',
                kind: 'error'
            });
        }
    }

    async function apply() {
        if (selected === undefined || !entry) return;
        const encoded = await invoke<number[]>("encode_text_command", {
            text,
            encoding,
        });
        const a = await invoke<Archive>("edit_entry", {
            index: selected,
            name: entry.name,
            data: encoded,
        });
        setArchive(a);
        setBytes(encoded);
        setDirty(true);
        setPending(false);
        setStatus(t("Changes applied in memory"));
    }

    async function importEntry(replace: boolean) {
        if (!(await discard())) return;
        const path = await open();
        if (typeof path !== "string") return;
        await run(async () => {
            const data = await invoke<number[]>("import_file", {path});
            const name = replace
                ? entry!.name
                : newName.trim() || path.split(/[\\/]/).pop();
            if (!name) return;
            setArchive(
                await invoke<Archive>("edit_entry", {
                    index: replace ? selected : null,
                    name,
                    data,
                }),
            );
            setSelected(undefined);
            setDirty(true);
            setPending(false);
            setStatus(t("File imported"));
        });
    }

    async function saveArchive(saveAs = false) {
        if (!archive) return;
        const path = saveAs
            ? await save({
                defaultPath: archive.path,
                filters: [{name: "PCK", extensions: ["pck"]}],
            })
            : archive.path;
        if (path)
            await run(async () => {
                if (pending) await apply();
                setArchive(await invoke<Archive>("save_archive", {path}));
                setDirty(false);
                setStatus("Saved: " + path);
            });
    }

    async function extractArchive() {
        const directory = await open({
            directory: true,
            title: t("Extract PCK to folder"),
        });
        if (typeof directory !== "string") return;
        await run(async () => {
            if (pending) await apply();
            setExtractionErrors([]);
            const result = await invoke<{ extracted: number; errors: string[] }>("extract_archive", {
                directory,
            });
            setStatus(
                "Extracted " +
                result.extracted.toLocaleString() +
                " files to " +
                directory + "; errors: " + result.errors.length,
            );
            setExtractionErrors(result.errors);
        });
    }

    async function packFolder() {
        if (
            (dirty || pending) &&
            !(await confirm(
                t(
                    "Create an archive from a folder and discard changes in the current archive?",
                ),
            ))
        )
            return;
        const directory = await open({
            directory: true,
            title: t("Folder to pack"),
        });
        if (typeof directory !== "string") return;
        const path = await save({
            title: t("Save PCK outside the source folder"),
            filters: [{name: "PCK", extensions: ["pck"]}],
        });
        if (!path) return;
        await run(async () => {
            const result = await invoke<Archive>("pack_folder", {
                directory,
                path,
            });
            setArchive(result);
            setSelected(undefined);
            setBytes([]);
            setText("");
            setDirty(false);
            setPending(false);
            setStatus(
                "Packed " +
                result.entries.length.toLocaleString() +
                " files: " +
                path,
            );
        });
    }

    const hex = useMemo(
        () =>
            bytes
                .slice(0, 65536)
                .reduce<string[]>((rows, _, i) => {
                    if (i % 16 === 0)
                        rows.push(
                            i.toString(16).padStart(8, "0") +
                            "  " +
                            bytes
                                .slice(i, i + 16)
                                .map((x) => x.toString(16).padStart(2, "0"))
                                .join(" "),
                        );
                    return rows;
                }, [])
                .join("\n"),
        [bytes],
    );
    const handleProjectWorkspaceElements: ComponentProps<typeof ProjectWorkspace>["onElements"] = (path, context) => {
        setElementsPath(path);
        setElementsProject(context);
        setElementsVisible(true);
    };
    const handleButtonClick: ComponentProps<typeof Button>["onClick"] = () => {
        if (!entry) return;
        if (
            mediaType(entry.name) &&
            tab !== "text"
        )
            decode(bytes, encoding);
        setTab("text");
    };
    const handleSelectRootValueChange: ComponentProps<typeof Select.Root>["onValueChange"] = async ({value: [value]}) => {
        const v = value;
        if (await discard()) {
            setEncoding(v);
            decode(bytes, v);
        }
    };
    const handleInterfaceEditorOpenDialog: ComponentProps<typeof InterfaceEditor>["onOpenDialog"] = file => {
        if (busy || searching || !archive || !entry) return;
        const normalize = (path: string) => path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
        const requested = normalize(file);
        const current = normalize(entry.name);
        const directory = current.slice(0, current.lastIndexOf("/") + 1);
        const candidates = [directory + requested, requested, "interfaces/" + requested];
        let index = -1;
        for (const path of candidates) {
            index = archive.entries.findIndex(item => normalize(item.name) === path);
            if (index >= 0) break;
        }
        if (index < 0) {
            setStatus("DialogFile not found: " + file);
            return;
        }
        void choose(index, undefined, [...(dialogTrail.length ? dialogTrail : [selected!]), index]);
    };
    const handleButtonClick2: ComponentProps<typeof Button>["onClick"] = async () => {
        if (!entry) return;
        const path = await save({
            defaultPath: entry.name
                .split("\\")
                .pop(),
        });
        if (path)
            run(async () => {
                await invoke("export_entry", {
                    index: selected,
                    path,
                });
                setStatus(
                    "Exported: " + path,
                );
            });
    };
    const handleButtonClick3: ComponentProps<typeof Button>["onClick"] = async () => {
        if (!entry) return;
        if (
            await confirm(
                t("Delete ") +
                entry.name +
                t(" from the archive?"),
            )
        )
            run(async () => {
                setArchive(
                    await invoke<Archive>(
                        "edit_entry",
                        {
                            index: selected,
                            name: "",
                            data: null,
                        },
                    ),
                );
                setSelected(undefined);
                setPending(false);
                setDirty(true);
            });
    };
    return (
        <Flex direction="column" h="100vh" bg="var(--chakra-colors-bg)" color="var(--chakra-colors-fg)">
            <ProjectWorkspace visible={projectVisible && !elementsVisible} onBack={() => setProjectVisible(false)}
                              onOpen={() => void openFile()} onElements={handleProjectWorkspaceElements}/>
            <ElementsEditor visible={elementsVisible} onOpen={() => void openFile()} requestedPath={elementsPath}
                            requestedProject={elementsProject} onBack={() => setElementsVisible(false)}/>
            <Flex
                p="5"
                gap="4"
                wrap="wrap"
                align="center"
                borderBottom="1px solid var(--chakra-colors-border)"
            >
                <Box mr="auto">
                    <Heading size="xl">
                        <span style={{color: "var(--chakra-colors-teal-400)"}}>PW Forge</span>
                    </Heading>
                </Box>
                <Button onClick={() => setProjectVisible(true)}>{t("Project")}</Button>
                <Flex gap="1" role="group" aria-label="Language">
                    <Button
                        size="sm"
                        variant={language === "ru" ? "solid" : "outline"}
                        colorPalette="teal"
                        aria-pressed={language === "ru"}
                        onClick={() => setLanguage("ru")}
                    >
                        RU
                    </Button>
                    <Button
                        size="sm"
                        variant={language === "en" ? "solid" : "outline"}
                        colorPalette="teal"
                        aria-pressed={language === "en"}
                        onClick={() => setLanguage("en")}
                    >
                        EN
                    </Button>
                </Flex>
                <Button disabled={busy || searching} onClick={() => void openFile()}>
                    {t("Open")}
                </Button>
                <Button disabled={busy || searching} onClick={packFolder}>
                    {t("Pack into PCK")}
                </Button>
                <Button
                    disabled={busy || searching || !archive}
                    onClick={extractArchive}
                >
                    {t("Extract all")}
                </Button>
                <Button
                    disabled={busy || searching || !archive}
                    onClick={() => importEntry(false)}
                >
                    {t("Add file")}
                </Button>
                <Button
                    colorPalette="teal"
                    disabled={busy || searching || !archive}
                    onClick={() => saveArchive()}
                >
                    {t("Save")}
                    {dirty || pending ? " •" : ""}
                </Button>
                <Button
                    disabled={busy || searching || !archive}
                    onClick={() => saveArchive(true)}
                >
                    {t("Save as…")}
                </Button>
            </Flex>
            <Flex flex="1" overflow="hidden">
                <Flex
                    w="390px" className="archive-sidebar-resizable"
                    direction="column"
                    borderRight="1px solid var(--chakra-colors-border)"
                    p="4"
                    gap="3"
                >
                    <Text fontSize="sm" wordBreak="break-all">
                        {archive?.path || t("No archive selected")}
                    </Text>
                    <Field.Root width="auto"><Input
                        placeholder={t("New entry path: folder/file.ext")}
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                    /></Field.Root>
                    <Field.Root width="auto"><Input
                        placeholder={t("Filter by path…")}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    /></Field.Root>
                    <Button size="sm" onClick={() => setFindOpen(true)}>
                        {t("Find in Files")} · Ctrl+Shift+F
                    </Button>
                    <ArchiveTree
                        entries={archive?.entries ?? EMPTY_ENTRIES}
                        query={query}
                        selected={selected}
                        busy={busy}
                        choose={chooseStable}
                    />
                </Flex>
                <Flex flex="1" direction="column" p="5" minW="0" gap="4">
                    {entry ? (
                        <>
                            <Flex gap="3" align="center" wrap="wrap"><Heading size="md" wordBreak="break-all">
                                {entry.name}
                            </Heading><Badge>{entry.size.toLocaleString()} bytes</Badge><Badge>{entry.packed < entry.size ? "ZLIB" : "RAW"}</Badge></Flex>
                            {interfaceType(entry.name) && <Flex gap="2" align="center" wrap="wrap">
                                {dialogTrail.length > 1 &&
                                    <Button size="sm" disabled={busy || searching} onClick={() => {
                                        const path = dialogTrail.slice(0, -1);
                                        void choose(path[path.length - 1], undefined, path);
                                    }}>{t("← Back")}</Button>}
                                {dialogTrail.map((index, position) => <span key={`${position}:${index}`}><Button
                                    disabled={busy || searching || position === dialogTrail.length - 1}
                                    onClick={() => void choose(index, undefined, dialogTrail.slice(0, position + 1))}>{archive?.entries[index]?.name.split(/[\\/]/).pop()}</Button>
                                    {position < dialogTrail.length - 1 ? ' / ' : ''}</span>)}
                            </Flex>}
                            <Flex gap="3" align="center" wrap="wrap">
                                {(mediaType(entry.name) || interfaceType(entry.name) || /\.(gfx|mox|ecm|smd|ski|bon)$/i.test(entry.name)) && (
                                    <Button
                                        size="sm"
                                        onClick={() => setTab("preview")}
                                    >
                                        {t("Preview")}
                                    </Button>
                                )}
                                <Button
                                    size="sm"
                                    disabled={busy || searching}
                                    onClick={handleButtonClick}
                                >
                                    {t("Text")}
                                </Button>
                                <Button size="sm" onClick={() => setTab("hex")}>
                                    HEX
                                </Button>
                                <SelectRoot size="sm" lazyMount unmountOnExit minW="140px"
                                            collection={selectCollection(<>
                                                <option value="utf-8">UTF-8</option>
                                                <option value="gbk">GBK</option>
                                                <option value="utf-16le">UTF-16 LE</option>
                                                <option value="utf-16be">UTF-16 BE</option>
                                            </>)} value={[String(encoding)]}
                                            onValueChange={handleSelectRootValueChange}
                                            disabled={busy || searching}><SelectTrigger><SelectValueText/></SelectTrigger><SelectContent><Select.Context>{select => select.collection.items.map(item =>
                                    <SelectItem key={select.collection.getItemValue(item)}
                                                item={item}>{t(select.collection.stringifyItem(item))}</SelectItem>)}</Select.Context></SelectContent></SelectRoot>
                            </Flex>
                            {tab === "preview" && /\.(mox|ecm|smd|ski|bon)$/i.test(entry.name) ? <NativeGfxPreview
                                file={entry.name}/> : tab === "preview" && /\.gfx$/i.test(entry.name) ?
                                <GfxPreview file={entry.name} bytes={bytes}
                                            entries={archive?.entries ?? EMPTY_ENTRIES}/> : tab === "preview" && interfaceType(entry.name) ? (
                                    <InterfaceEditor fileName={entry.name} key={`${archive?.path}:${selected}`}
                                                     initialView={interfaceViews.current.get(`${archive?.path}:${entry.name}`)}
                                                     onViewChange={view => {
                                                         interfaceViews.current.set(`${archive?.path}:${entry.name}`, view);
                                                     }} onOpenDialog={handleInterfaceEditorOpenDialog} text={text}
                                                     entries={archive?.entries ?? EMPTY_ENTRIES}
                                                     disabled={busy || searching} onChange={value => {
                                        setText(value);
                                        setPending(true);
                                    }}/>
                                ) : tab === "preview" && mediaType(entry.name) ? (
                                    <MediaPreview
                                        key={selected}
                                        name={entry.name}
                                        bytes={bytes}
                                    />
                                ) : tab === "text" ? (
                                    <TextEditor
                                        key={archive?.path + ':' + selected}
                                        ref={editor}
                                        fileName={entry.name}
                                        readOnly={busy || searching}
                                        value={text}
                                        onChange={value => {
                                            setText(value);
                                            setPending(true);
                                        }}
                                    />
                                ) : (
                                    <Box
                                        as="pre"
                                        flex="1"
                                        overflow="auto"
                                        fontSize="sm"
                                    >
                                        {hex}
                                        {bytes.length > 65536
                                            ? t("\n… first 64 KiB")
                                            : ""}
                                    </Box>
                                )}
                            <Flex gap="2" wrap="wrap">
                                <Button
                                    disabled={busy || searching || !pending}
                                    onClick={() => run(apply)}
                                >
                                    {t("Apply text")}
                                </Button>
                                <Button
                                    disabled={busy || searching}
                                    onClick={() => importEntry(true)}
                                >
                                    {t("Replace from file")}
                                </Button>
                                <Button
                                    disabled={busy || searching}
                                    onClick={handleButtonClick2}
                                >
                                    {t("Export")}
                                </Button>
                                <Button
                                    colorPalette="red"
                                    variant="outline"
                                    disabled={busy || searching}
                                    onClick={handleButtonClick3}
                                >
                                    {t("Delete")}
                                </Button>
                            </Flex>
                        </>
                    ) : (
                        <Flex
                            flex="1"
                            align="center"
                            justify="center"
                            direction="column"
                            gap="3"
                        >
                            <Text color="var(--chakra-colors-fg-muted)">{t("No file selected")}</Text>
                        </Flex>
                    )}
                </Flex>
            </Flex>
            <Box
                px="5"
                py="3"
                borderTop="1px solid var(--chakra-colors-border)"
                fontSize="sm"
                role="status"
            >
                {busy ? (
                    <>
                        <Flex justify="space-between" gap="4">
                            <Text>
                                {progress
                                    ? message(progress.operation) +
                                    " · " +
                                    message(progress.stage)
                                    : t("Preparing…")}
                            </Text>
                            <Text>
                                {progress && progress.total > 0
                                    ? Math.min(
                                        100,
                                        Math.round(
                                            (progress.completed /
                                                progress.total) *
                                            100,
                                        ),
                                    ) +
                                    "% · " +
                                    progress.completed.toLocaleString() +
                                    " / " +
                                    progress.total.toLocaleString()
                                    : t("Working…")}
                            </Text>
                        </Flex>
                        <ProgressRoot className="operation-progress" aria-label={
                                                                         (progress?.stage
                                                                             ? message(progress.stage)
                                                                             : undefined) || t("Processing")
                                                                     } max={progress?.total || 1} value={
                                                                                                      progress && progress.total > 0
                                                                                                          ? progress.completed
                                                                                                          : undefined
                                                                                                  }><ProgressBar/></ProgressRoot>
                    </>
                ) : (
                    message(status)
                )}
            </Box> {extractionErrors.length > 0 && <Box px="5" pb="3">
            <AccordionRoot collapsible defaultValue={false ? ["content"] : []}><AccordionItem
                value="content"><AccordionItemTrigger>{t("Extraction errors:")}{extractionErrors.length}</AccordionItemTrigger><AccordionItemContent><Box
                maxH="160px" overflow="auto" fontSize="xs"
                wordBreak="break-all">{extractionErrors.map((error, index) => <Text
                key={index}>{message(error)}</Text>)}</Box></AccordionItemContent></AccordionItem></AccordionRoot>
        </Box>}
        </Flex>
    );
}

