import {t} from "../../i18n";
import {Box, createTreeCollection, Field, Input, Text, TreeView} from '@chakra-ui/react';
import type {ComponentProps} from "react";
import {memo, useDeferredValue, useEffect, useMemo, useRef, useState} from 'react';
import type {AiPolicy} from './aipolicy-data';
import {decodeName} from './aipolicy-fields';

interface Node {
    key: string;
    label: string;
    children?: Node[];
}

const ROW = 32;
const OVERSCAN = 6;
const branches = new WeakMap<AiPolicy, Node>();

export const AiPolicyTree = memo(function AiPolicyTree({policies, selected, select}: {
    policies: AiPolicy[];
    selected: string;
    select: (key: string) => void;
}) {
    const [query, setQuery] = useState('');
    const filter = useDeferredValue(query.trim());
    const [expanded, setExpanded] = useState(['0']);
    const [scroll, setScroll] = useState(0);
    const [height, setHeight] = useState(0);
    const viewport = useRef<HTMLDivElement>(null);
    const collection = useMemo(() => {
        const children = policies.flatMap((p, i) => {
            if (!String(p.id).includes(filter)) return [];
            let branch = branches.get(p);
            if (!branch) {
                branch = {
                    key: String(i),
                    label: "Policy " + p.id + ' · ' + p.triggers.length,
                    children: p.triggers.map((t, j) => ({
                        key: i + ':' + j,
                        label: t.id + ' · ' + decodeName(t.nameGBK)
                    }))
                };
                branches.set(p, branch);
            }
            return [branch];
        });
        const rootNode = {key: 'root', label: '', children};
        const tree = createTreeCollection<Node>({rootNode, nodeToValue: n => n.key, nodeToString: n => n.label});
        const nodes = new Map<string, Node>();
        const paths = new Map<string, number[]>();
        children.forEach((branch, i) => {
            nodes.set(branch.key, branch);
            paths.set(branch.key, [i]);
            branch.children?.forEach((child, j) => {
                nodes.set(child.key, child);
                paths.set(child.key, [i, j]);
            });
        });
        const find = tree.findNode.bind(tree);
        tree.findNode = (key, root) => root && root !== rootNode ? find(key, root) : nodes.get(key);
        const findMany = tree.findNodes.bind(tree);
        tree.findNodes = (keys, root) => root && root !== rootNode ? findMany(keys, root) :
            keys.map(key => nodes.get(key)).filter((node): node is Node => !!node);
        const getPath = tree.getIndexPath.bind(tree);
        tree.getIndexPath = (key => typeof key === 'string' ? paths.get(key) : getPath(key)) as typeof tree.getIndexPath;
        return tree;
    }, [policies, filter]);

    const rows = useMemo(() => {
        const open = new Set(expanded);
        return collection.rootNode.children?.flatMap((node, i) => [
            {node, path: [i]},
            ...(open.has(node.key) ? node.children?.map((child, j) => ({node: child, path: [i, j]})) ?? [] : [])
        ]) ?? [];
    }, [collection, expanded]);
    const rowByKey = useMemo(() => new Map(rows.map(({node}, i) => [node.key, i])), [rows]);

    useEffect(() => {
        const element = viewport.current;
        if (!element) return;
        const observer = new ResizeObserver(() => setHeight(element.clientHeight));
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        if (viewport.current) viewport.current.scrollTop = 0;
        setScroll(0);
    }, [filter]);

    const start = Math.max(0, Math.min(scroll, rows.length - 1) - OVERSCAN);
    const end = start + Math.ceil(height / ROW) + OVERSCAN * 2;

    const handleTreeViewRootscrollToIndexFn: ComponentProps<typeof TreeView.Root>["scrollToIndexFn"] = ({node}) => {
        const index = rowByKey.get(node.key);
        const element = viewport.current;
        if (index === undefined || !element) return;
        const top = index * ROW;
        if (top < element.scrollTop) element.scrollTop = top;
        else if (top + ROW > element.scrollTop + element.clientHeight) {
            element.scrollTop = top + ROW - element.clientHeight;
        }
    };
    return <aside className="ai-navigation">
        <Field.Root width="auto"><Input size="sm" aria-label={t("Find policy by ID")}
                                        placeholder={t("Search by policy ID")}
                                        value={query}
                                        onChange={e => setQuery(e.target.value)}/></Field.Root>
        <Text fontSize="xs"
              opacity={0.75}>{collection.rootNode.children?.length ?? 0} {t(" of ")}{policies.length} {t(" policies")}</Text>
        <TreeView.Root className="ai-tree" collection={collection} colorPalette="teal" size="sm" expandOnClick
                       expandedValue={expanded} onExpandedChange={e => setExpanded(e.expandedValue)}
                       selectedValue={selected ? [selected] : []}
                       onSelectionChange={e => {
                           const key = e.selectedValue[0];
                           if (key?.includes(':')) select(key);
                       }}
                       scrollToIndexFn={handleTreeViewRootscrollToIndexFn}>
            <TreeView.Label srOnly>{t("Policy and trigger tree")}</TreeView.Label>
            <TreeView.Tree className="ai-tree-viewport" ref={viewport} aria-busy={filter !== query.trim()}
                           onScroll={e => setScroll(Math.floor(e.currentTarget.scrollTop / ROW))}>
                <Box position="relative" height={rows.length * ROW + 'px'}>
                    {rows.slice(start, end).map(({node, path}, offset) =>
                        <TreeView.NodeProvider key={node.key} node={node} indexPath={path}>
                            <Box position="absolute" top={(start + offset) * ROW + 'px'} width="100%">
                                {node.children?.length ? <TreeView.Branch>
                                    <TreeView.BranchControl minH={ROW + 'px'}>
                                        <TreeView.BranchIndicator>›</TreeView.BranchIndicator>
                                        <TreeView.BranchText truncate>{node.label}</TreeView.BranchText>
                                    </TreeView.BranchControl>
                                </TreeView.Branch> : <TreeView.Item minH={ROW + 'px'} ps={path.length === 2 ? '8' : '2'}
                                                                    title={node.label}>
                                    <TreeView.ItemText truncate>{node.label}</TreeView.ItemText>
                                </TreeView.Item>}
                            </Box>
                        </TreeView.NodeProvider>)}
                </Box>
            </TreeView.Tree>
        </TreeView.Root>
    </aside>;
});
