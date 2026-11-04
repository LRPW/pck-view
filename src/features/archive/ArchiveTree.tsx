import {t, useLanguage} from '../../i18n/index';
import {memo, useDeferredValue, useEffect, useMemo, useRef, useState} from 'react';
import {Box, createTreeCollection, Text, TreeView} from '@chakra-ui/react';

type Entry = { name: string; size: number; changed: boolean };
type Node = { id: string; name: string; path: string; index?: number; children?: Node[]; childCount?: number };
type Row = { node: Node; indexPath: number[] };
const ROW_HEIGHT = 36;

export const ArchiveTree = memo(function ArchiveTree({entries, query, selected, busy, choose}: {
    entries: Entry[]; query: string; selected?: number; busy: boolean; choose: (index: number) => void;
}) {
    useLanguage();
    const viewport = useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [height, setHeight] = useState(500);
    const [expanded, setExpanded] = useState<string[]>([]);
    const deferredQuery = useDeferredValue(query);

    const worker = useRef<Worker | null>(null);
    const requestId = useRef(0);
    const [filtered, setFiltered] = useState<{
        root: Node;
        count: number;
        branches: string[];
        query: string
    }>({root: {id: 'root', name: t('Ресурсы'), path: '', children: []}, count: 0, branches: [], query: ''});
    const [indexing, setIndexing] = useState(false);
    useEffect(() => {
        const instance = new Worker(new URL('./archive-tree.worker.ts', import.meta.url), {type: 'module'});
        worker.current = instance;
        instance.onmessage = (event: MessageEvent<typeof filtered & { id: number; done: boolean }>) => {
            if (event.data.id !== requestId.current) return;
            setFiltered(event.data);
            setIndexing(!event.data.done);
        };
        instance.onerror = () => setIndexing(false);
        return () => {
            instance.terminate();
            worker.current = null;
        };
    }, []);
    const previousEntries = useRef<Entry[] | undefined>(undefined);
    const previousQuery = useRef<string | undefined>(undefined);
    const previousExpansion = useRef<string[] | undefined>(undefined);
    useEffect(() => {
        const timer = setTimeout(() => {
            const previous = previousEntries.current;
            const updated = !previous || previous.length !== entries.length ||
                entries.some((entry, index) => previous[index].name !== entry.name);
            if (!updated && previousQuery.current === deferredQuery &&
                (deferredQuery || previousExpansion.current === expanded)) {
                previousEntries.current = entries;
                return;
            }
            const id = ++requestId.current;
            setIndexing(true);
            worker.current?.postMessage({
                id,
                query: deferredQuery,
                expanded,
                entries: updated ? entries.map(entry => entry.name) : undefined
            });
            previousEntries.current = entries;
            previousQuery.current = deferredQuery;
            previousExpansion.current = expanded;
        }, deferredQuery ? 120 : 0);
        return () => clearTimeout(timer);
    }, [entries, deferredQuery, expanded]);
    const collection = useMemo(() => {
        const collection = createTreeCollection<Node>({
            rootNode: filtered.root,
            nodeToValue: node => node.id,
            nodeToString: node => node.name,
            nodeToChildrenCount: node => node.childCount,
        });
        const byId = new Map<string, Node>();
        const paths = new Map<string, number[]>();

        function index(node: Node, path: number[]) {
            byId.set(node.id, node);
            paths.set(node.id, path);
            node.children?.forEach((child, i) => index(child, [...path, i]));
        }

        index(filtered.root, []);
        const originalFind = collection.findNode;
        collection.findNode = (value, root) => root && root !== filtered.root ? originalFind(value, root) : byId.get(value);
        const originalFindMany = collection.findNodes;
        collection.findNodes = (values, root) => root && root !== filtered.root ? originalFindMany(values, root) : values.map(value => byId.get(value)).filter((node): node is Node => !!node);
        const originalIndexPath = collection.getIndexPath.bind(collection);
        collection.getIndexPath = ((value: string | string[]) => typeof value === 'string' ? paths.get(value) : originalIndexPath(value)) as typeof collection.getIndexPath;
        return collection;
    }, [filtered.root]);
    const expandedValue = filtered.query ? filtered.branches : expanded;
    const selectedPath = selected === undefined ? undefined : entries[selected]?.name;
    useEffect(() => {
        if (!selectedPath) return;
        const parts = selectedPath.replaceAll('\\', '/').split('/').filter(Boolean);
        const parents = parts.slice(0, -1).map((_, index) =>
            'folder:' + parts.slice(0, index + 1).join('/').toLowerCase());
        setExpanded(old => parents.every(id => old.includes(id)) ? old : [...new Set([...old, ...parents])]);
    }, [selectedPath]);
    const rows = useMemo(() => {
        const open = new Set(expandedValue);
        const result: Row[] = [];

        function visit(node: Node, indexPath: number[]) {
            result.push({node, indexPath});
            if (node.children && open.has(node.id)) node.children.forEach((child, i) => visit(child, [...indexPath, i]));
        }

        filtered.root.children?.forEach((node, i) => visit(node, [i]));
        return result;
    }, [filtered.root, expandedValue]);
    const rowIndices = useMemo(() => new Map(rows.map((row, index) => [row.node.id, index])), [rows]);
    useEffect(() => {
        if (selected === undefined) return;
        const index = rowIndices.get('file:' + selected);
        const el = viewport.current;
        if (index === undefined || !el) return;
        const top = index * ROW_HEIGHT;
        if (top < el.scrollTop || top + ROW_HEIGHT > el.scrollTop + el.clientHeight) {
            el.scrollTop = Math.max(0, top - el.clientHeight / 3);
        }
    }, [selected, rowIndices]);
    useEffect(() => {
        const el = viewport.current;
        if (!el) return;
        const observer = new ResizeObserver(() => setHeight(el.clientHeight));
        observer.observe(el);
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        setScrollTop(0);
        if (viewport.current) viewport.current.scrollTop = 0;
    }, [filtered.query]);
    const start = Math.max(0, Math.min(Math.floor(scrollTop / ROW_HEIGHT), Math.max(0, rows.length - 1)) - 6);
    const end = Math.min(rows.length, start + Math.ceil(height / ROW_HEIGHT) + 12);
    return <>
        <Text fontSize="xs"
              color="#8393aa"
              aria-busy={indexing}>{filtered.count.toLocaleString() + " / " + entries.length.toLocaleString() + t(" файлов")}</Text>
        <TreeView.Root className="archive-tree" collection={collection} colorPalette="teal" size="sm"
                       expandedValue={expandedValue} onExpandedChange={details => {
            if (!filtered.query) setExpanded(details.expandedValue);
        }}
                       selectedValue={selected === undefined ? [] : ['file:' + selected]}
                       onSelectionChange={details => {
                           if (busy) return;
                           const id = details.selectedValue[0];
                           const node = id ? collection.findNode(id) : undefined;
                           if (node?.index === undefined) return;
                           const path = entries[node.index]?.name.replaceAll('\\', '/').split('/').filter(Boolean).join('/');
                           if (path === node.path) choose(node.index);
                       }}
                       scrollToIndexFn={({node}) => {
                           const index = rowIndices.get(node.id) ?? -1;
                           const el = viewport.current;
                           if (index < 0 || !el) return;
                           const top = index * ROW_HEIGHT;
                           if (top < el.scrollTop) el.scrollTop = top;
                           else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_HEIGHT - el.clientHeight;
                       }}>
            <TreeView.Label srOnly>{t("Файлы архива")}</TreeView.Label>
            <TreeView.Tree ref={viewport} className="tree-viewport" aria-busy={indexing || deferredQuery !== query}
                           onScroll={event => setScrollTop(Math.floor(event.currentTarget.scrollTop / ROW_HEIGHT) * ROW_HEIGHT)}>
                <Box position="relative" height={`${rows.length * ROW_HEIGHT}px`} flexShrink={0}>
                    {rows.slice(start, end).map(({node, indexPath}, offset) => (
                        <TreeView.NodeProvider key={node.id} node={node} indexPath={indexPath}>
                            <Box position="absolute" top={`${(start + offset) * ROW_HEIGHT}px`}
                                 height={`${ROW_HEIGHT}px`} width="100%">
                                {node.children ? <TreeView.Branch>
                                    <TreeView.BranchControl className="tree-row"
                                                            style={{paddingLeft: 8 + (indexPath.length - 1) * 16}}
                                                            title={node.path}>
                                        <TreeView.BranchIndicator>›</TreeView.BranchIndicator>
                                        <span aria-hidden>▱</span><TreeView.BranchText
                                        truncate>{node.name}</TreeView.BranchText>
                                    </TreeView.BranchControl>
                                </TreeView.Branch> : <TreeView.Item className="tree-row"
                                                                    style={{paddingLeft: 28 + (indexPath.length - 1) * 16}}
                                                                    title={node.path}>
                                    <TreeView.ItemText
                                        truncate>{entries[node.index!]?.changed ? '● ' : ''}{node.name}</TreeView.ItemText>
                                    <Text as="span" fontSize="xs" color="#8393aa" ml="auto"
                                          flexShrink="0">{entries[node.index!]?.size.toLocaleString()} B</Text>
                                </TreeView.Item>}
                            </Box>
                        </TreeView.NodeProvider>
                    ))}
                </Box>
            </TreeView.Tree>
        </TreeView.Root>
    </>;
});

