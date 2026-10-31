import {t, useLanguage} from '../../i18n/index';
import {memo, useDeferredValue, useEffect, useMemo, useRef, useState} from 'react';
import {Box, createTreeCollection, Text, TreeView} from '@chakra-ui/react';

type Entry = { name: string; size: number; changed: boolean };
type Node = { id: string; name: string; path: string; index?: number; children?: Node[] };
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
        instance.onmessage = (event: MessageEvent<typeof filtered & { id: number }>) => {
            if (event.data.id !== requestId.current) return;
            setFiltered(event.data);
            setIndexing(false);
        };
        instance.onerror = () => setIndexing(false);
        return () => {
            instance.terminate();
            worker.current = null;
        };
    }, []);
    const previousEntries = useRef<Entry[] | undefined>(undefined);
    useEffect(() => {
        const id = ++requestId.current;
        setIndexing(true);
        const timer = setTimeout(() => {
            const updated = previousEntries.current !== entries;
            worker.current?.postMessage({id, query: deferredQuery, entries: updated ? entries : undefined});
            previousEntries.current = entries;
        }, deferredQuery ? 120 : 0);
        return () => clearTimeout(timer);
    }, [entries, deferredQuery]);
    const collection = useMemo(() => {
        const collection = createTreeCollection<Node>({
            rootNode: filtered.root,
            nodeToValue: node => node.id,
            nodeToString: node => node.name
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
        const el = viewport.current;
        if (!el) return;
        const observer = new ResizeObserver(() => setHeight(el.clientHeight));
        observer.observe(el);
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        setScrollTop(0);
        if (viewport.current) viewport.current.scrollTop = 0;
    }, [filtered.root]);
    const start = Math.max(0, Math.min(Math.floor(scrollTop / ROW_HEIGHT), Math.max(0, rows.length - 1)) - 6);
    const end = Math.min(rows.length, start + Math.ceil(height / ROW_HEIGHT) + 12);
    return <>
        <Text fontSize="xs"
              color="#8393aa">{indexing ? t("Обновление дерева…") : filtered.count.toLocaleString() + " / " + entries.length.toLocaleString() + t(" файлов")}</Text>
        <TreeView.Root className="archive-tree" collection={collection} colorPalette="teal" size="sm"
                       expandedValue={expandedValue} onExpandedChange={details => {
            if (!filtered.query) setExpanded(details.expandedValue);
        }}
                       selectedValue={selected === undefined ? [] : ['file:' + selected]}
                       onSelectionChange={details => {
                           if (busy || indexing) return;
                           const id = details.selectedValue[0];
                           if (id?.startsWith('file:')) choose(Number(id.slice(5)));
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
                           onScroll={event => setScrollTop(event.currentTarget.scrollTop)}>
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

