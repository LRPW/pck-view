import {useEffect, useMemo, useRef, useState} from 'react';
import {createTreeCollection, TreeView} from '@chakra-ui/react';

type Node = { id: string; label: string; tag: string; controlName?: string; resource?: string; children?: Node[] };
const icons: Record<string, string> = {
    DIV: '▦', DIALOG: '▣', STILLIMAGEBUTTON: '▰', LABEL: 'T', TEXT: '¶', VERTICALTEXT: '↧',
    EDIT: '✎', IMAGEPICTURE: '▧', WINDOWPICTURE: '▧', RESOURCE: '▱',
    CHECK: '☑', RADIO: '◉', LIST: '☷', COMBO: '▤', TREE: '⑂',
    PROGRESS: '▰', SLIDER: '⦿', SCROLL: '↕', SUBDIALOG: '▣', CONSOLE: '⌘',
};

function Icon({tag}: { tag: string }) {
    const key = tag.toUpperCase();
    return <span className="xml-node-icon" aria-hidden="true"
                 data-kind={key === 'RESOURCE' || key.includes('IMAGE') ? 'resource' : key === 'TEXT' || key === 'LABEL' ? 'text' : 'control'}>{icons[key] ?? (key.includes('IMAGE') ? '▧' : '◇')}</span>;
}

export function XmlTree({
                            doc,
                            selection,
                            onSelect,
                            onContext,
                            onOpen,
                            hiddenElements = [],
                            onToggleVisibility,
                            onMove
                        }: {
    onMove?: (source: number, target: number, inside: boolean) => void;
    hiddenElements?: string[];
    onToggleVisibility?: (name: string) => void;
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
                controlName: (element.parentElement === doc.documentElement || element.parentElement?.tagName.toUpperCase() === 'DIV') ? element.getAttribute('Name') ?? undefined : undefined,
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
    const [dropTarget, setDropTarget] = useState<string | null>(null);
    const dragCleanup = useRef<(() => void) | null>(null);
    useEffect(() => () => dragCleanup.current?.(), []);

    function startMove(event: React.PointerEvent, source: number) {
        if (!onMove || event.button !== 0 || (event.target as HTMLElement).closest('button, input')) return;
        dragCleanup.current?.();
        const startX = event.clientX, startY = event.clientY;
        let dragging = false;
        let target: HTMLElement | null = null;
        const previousCursor = document.body.style.cursor;
        const previousSelection = document.body.style.userSelect;
        const cleanup = () => {
            document.removeEventListener('pointermove', move, true);
            document.removeEventListener('pointerup', finish, true);
            document.removeEventListener('pointercancel', cancel, true);
            document.body.style.cursor = previousCursor;
            document.body.style.userSelect = previousSelection;
            setDropTarget(null);
            dragCleanup.current = null;
        };
        const move = (e: PointerEvent) => {
            if (e.pointerId !== event.pointerId) return;
            if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) < 5) return;
            dragging = true;
            e.preventDefault();
            document.body.style.cursor = 'grabbing';
            document.body.style.userSelect = 'none';
            const row = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-xml-move-target]');
            const nodes = Array.from(doc.getElementsByTagName('*'));
            const candidate = row ? nodes[Number(row.dataset.xmlMoveTarget)] : undefined;
            const parent = candidate && ['DIV', 'DIALOG'].includes(candidate.tagName.toUpperCase()) ? candidate : candidate?.parentElement;
            target = row && candidate && parent && candidate !== nodes[source] && !nodes[source].contains(parent) && (parent === doc.documentElement || parent.tagName.toUpperCase() === 'DIV') ? row : null;
            setDropTarget(target?.dataset.xmlMoveTarget ?? null);
            const panel = row?.closest('.ui-editor-tree');
            if (panel) {
                const bounds = panel.getBoundingClientRect();
                if (e.clientY < bounds.top + 30) panel.scrollTop -= 12; else if (e.clientY > bounds.bottom - 30) panel.scrollTop += 12;
            }
        };
        const cancel = () => cleanup();
        const finish = (e: PointerEvent) => {
            if (e.pointerId !== event.pointerId) return;
            const destination = target?.dataset.xmlMoveTarget;
            cleanup();
            if (!dragging || destination === undefined) return;
            e.preventDefault();
            e.stopPropagation();
            const element = Array.from(doc.getElementsByTagName('*'))[Number(destination)];
            onMove(source, Number(destination), ['DIV', 'DIALOG'].includes(element.tagName.toUpperCase()));
        };
        document.addEventListener('pointermove', move, {capture: true, passive: false});
        document.addEventListener('pointerup', finish, true);
        document.addEventListener('pointercancel', cancel, true);
        dragCleanup.current = cleanup;
    }

    const [expanded, setExpanded] = useState<string[]>(['0']);
    useEffect(() => {
        setExpanded(old => [...new Set([...old, ...(ancestors.get(String(selection)) ?? [])])]);
    }, [selection, ancestors]);
    useEffect(() => {
        document.querySelector('.xml-tree [data-selected]')?.scrollIntoView({block: 'nearest'});
    }, [selection, expanded]);

    function render(node: Node, indexPath: number[]) {
        const element = Array.from(doc.getElementsByTagName('*'))[Number(node.id)];
        const movable = !!element && (element.parentElement === doc.documentElement || element.parentElement?.tagName.toUpperCase() === 'DIV');
        const rowProps = {
            onDragStart: (event: React.DragEvent) => event.preventDefault(),
            'data-xml-move-target': node.id,
            'data-drop-target': dropTarget === node.id ? 'true' : undefined,
            onPointerDownCapture: (event: React.PointerEvent) => {
                if (movable) startMove(event, Number(node.id));
            },
            onDoubleClick: () => onOpen?.(Number(node.id)),
            style: {paddingLeft: 8 + (indexPath.length - 1) * 18},
            onContextMenu: (event: React.MouseEvent) => {
                event.preventDefault();
                event.stopPropagation();
                onSelect(Number(node.id));
                onContext?.(Number(node.id), event.clientX, event.clientY);
            },
        };
        const eye = node.controlName && onToggleVisibility && <button className="xml-visibility"
                                                                      title={hiddenElements.includes(node.controlName) ? 'Показать элемент' : 'Скрыть элемент'}
                                                                      aria-label={hiddenElements.includes(node.controlName) ? 'Показать ' + node.controlName : 'Скрыть ' + node.controlName}
                                                                      aria-pressed={!hiddenElements.includes(node.controlName)}
                                                                      onPointerDown={e => e.stopPropagation()}
                                                                      onClick={e => {
                                                                          e.stopPropagation();
                                                                          onToggleVisibility(node.controlName!);
                                                                      }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
                 aria-hidden="true">
                <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/>
                <circle cx="12" cy="12" r="3"/>
                {hiddenElements.includes(node.controlName) && <path d="M3 3l18 18"/>}</svg>
        </button>;
        return <TreeView.NodeProvider key={node.id} node={node} indexPath={indexPath}>
            {node.children ? <TreeView.Branch>
                <TreeView.BranchControl {...rowProps} className="xml-tree-row"
                                        title={node.resource ? `Открыть в новом редакторе: ${node.resource}` : node.label}>
                    <TreeView.BranchIndicator className="xml-tree-chevron">›</TreeView.BranchIndicator>
                    <Icon tag={node.tag}/><TreeView.BranchText>{node.label}</TreeView.BranchText>{eye}
                </TreeView.BranchControl>
                <TreeView.BranchContent>{node.children.map((child, i) => render(child, [...indexPath, i]))}</TreeView.BranchContent>
            </TreeView.Branch> : <TreeView.Item {...rowProps} className="xml-tree-row"
                                                title={node.resource ? `Открыть в новом редакторе: ${node.resource}` : node.label}>
                <span className="xml-tree-chevron"/><Icon
                tag={node.tag}/><TreeView.ItemText>{node.label}</TreeView.ItemText>{eye}
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
