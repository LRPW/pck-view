import {useEffect, useMemo, useState} from 'react';
import {createTreeCollection, TreeView} from '@chakra-ui/react';

type Node = { id: string; label: string; tag: string; resource?: string; children?: Node[] };
const icons: Record<string, string> = {
    DIALOG: '▣', STILLIMAGEBUTTON: '▰', LABEL: 'T', TEXT: '¶', VERTICALTEXT: '↧',
    EDIT: '✎', IMAGEPICTURE: '▧', WINDOWPICTURE: '▧', RESOURCE: '▱',
    CHECK: '☑', RADIO: '◉', LIST: '☷', COMBO: '▤', TREE: '⑂',
    PROGRESS: '▰', SLIDER: '⦿', SCROLL: '↕', SUBDIALOG: '▣', CONSOLE: '⌘',
};

function Icon({tag}: { tag: string }) {
    const key = tag.toUpperCase();
    return <span className="xml-node-icon" aria-hidden="true"
                 data-kind={key === 'RESOURCE' || key.includes('IMAGE') ? 'resource' : key === 'TEXT' || key === 'LABEL' ? 'text' : 'control'}>{icons[key] ?? (key.includes('IMAGE') ? '▧' : '◇')}</span>;
}

export function XmlTree({doc, selection, onSelect, onContext, onOpen}: {
    doc: Document;
    selection: number;
    onSelect: (index: number) => void;
    onContext?: (index: number, x: number, y: number) => void;
    onOpen?: (index: number) => void
}) {
    const {collection, ancestors} = useMemo(() => {
        const nodes = Array.from(doc.getElementsByTagName('*'));
        const ids = new Map(nodes.map((node, index) => [node, String(index)]));
        const ancestors = new Map<string, string[]>();

        function build(element: Element, parents: string[]): Node {
            const id = ids.get(element)!;
            ancestors.set(id, parents);
            const children = Array.from(element.children).map(child => build(child, [...parents, id]));
            const resource = element.getAttribute('FileName') ?? undefined;
            return {
                id,
                resource,
                label: `${element.tagName}${element.getAttribute('Name') ? ' · ' + element.getAttribute('Name') : ''}${resource ? ' · ' + resource.split(/[\\/]/).pop() + ' ↗' : ''}`,
                tag: element.tagName,
                children: children.length ? children : undefined
            };
        }

        const root: Node = {id: 'xml-root', label: 'XML', tag: '', children: [build(doc.documentElement, [])]};
        return {
            collection: createTreeCollection<Node>({
                rootNode: root,
                nodeToValue: n => n.id,
                nodeToString: n => n.label
            }), ancestors
        };
    }, [doc]);
    const [expanded, setExpanded] = useState<string[]>(['0']);
    useEffect(() => {
        setExpanded(old => [...new Set([...old, ...(ancestors.get(String(selection)) ?? [])])]);
    }, [selection, ancestors]);
    useEffect(() => {
        document.querySelector('.xml-tree [data-selected]')?.scrollIntoView({block: 'nearest'});
    }, [selection, expanded]);

    function render(node: Node, indexPath: number[]) {
        const rowProps = {
            onDoubleClick: () => onOpen?.(Number(node.id)),
            style: {paddingLeft: 8 + (indexPath.length - 1) * 18},
            onContextMenu: (event: React.MouseEvent) => {
                event.preventDefault();
                event.stopPropagation();
                onSelect(Number(node.id));
                onContext?.(Number(node.id), event.clientX, event.clientY);
            },
        };
        return <TreeView.NodeProvider key={node.id} node={node} indexPath={indexPath}>
            {node.children ? <TreeView.Branch>
                <TreeView.BranchControl {...rowProps} className="xml-tree-row"
                                        title={node.resource ? `Открыть в новом редакторе: ${node.resource}` : node.label}>
                    <TreeView.BranchIndicator className="xml-tree-chevron">›</TreeView.BranchIndicator>
                    <Icon tag={node.tag}/><TreeView.BranchText>{node.label}</TreeView.BranchText>
                </TreeView.BranchControl>
                <TreeView.BranchContent>{node.children.map((child, i) => render(child, [...indexPath, i]))}</TreeView.BranchContent>
            </TreeView.Branch> : <TreeView.Item {...rowProps} className="xml-tree-row"
                                                title={node.resource ? `Открыть в новом редакторе: ${node.resource}` : node.label}>
                <span className="xml-tree-chevron"/><Icon
                tag={node.tag}/><TreeView.ItemText>{node.label}</TreeView.ItemText>
                {node.resource &&
                    <button className="xml-resource-open" aria-label={`Открыть ${node.resource}`} onClick={event => {
                        event.stopPropagation();
                        onOpen?.(Number(node.id));
                    }}>↗</button>}
            </TreeView.Item>}
        </TreeView.NodeProvider>;
    }

    return <TreeView.Root className="xml-tree" collection={collection} colorPalette="teal" size="sm"
                          selectedValue={[String(selection)]} expandedValue={expanded}
                          onExpandedChange={details => setExpanded(details.expandedValue)}
                          onSelectionChange={details => {
                              const id = details.selectedValue[0];
                              if (id !== undefined) onSelect(Number(id));
                          }}>
        <TreeView.Label className="xml-tree-title">Структура XML</TreeView.Label>
        <TreeView.Tree
            aria-label="Структура интерфейса">{collection.rootNode.children?.map((node, i) => render(node, [i]))}</TreeView.Tree>
    </TreeView.Root>;
}
