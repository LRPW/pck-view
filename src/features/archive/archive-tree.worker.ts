type Entry = { name: string; size: number; changed: boolean };
type Node = { id: string; name: string; path: string; index?: number; children?: Node[] };

function makeTree(entries: Entry[]): Node {
    const root: Node = {id: 'root', name: 'Ресурсы', path: '', children: []};
    const folders = new Map<string, Node>([['', root]]);
    entries.forEach((entry, index) => {
        const parts = entry.name.replaceAll('\\', '/').split('/').filter(Boolean);
        let parent = root;
        let path = '';
        parts.forEach((part, depth) => {
            path += (path ? '/' : '') + part;
            if (depth === parts.length - 1) {
                parent.children!.push({id: 'file:' + index, name: part, path, index});
            } else {
                const key = path.toLowerCase();
                let folder = folders.get(key);
                if (!folder) {
                    folder = {id: 'folder:' + key, name: part, path, children: []};
                    folders.set(key, folder);
                    parent.children!.push(folder);
                }
                parent = folder;
            }
        });
    });

    function sort(node: Node) {
        node.children?.sort((a, b) => Number(!!b.children) - Number(!!a.children) || a.name.localeCompare(b.name));
        node.children?.forEach(sort);
    }

    sort(root);
    return root;
}


let source: Node = {id: 'root', name: 'Ресурсы', path: '', children: []};
let total = 0;
self.onmessage = (event: MessageEvent<{ entries?: Entry[]; query: string; id: number }>) => {
    const {entries, query, id} = event.data;
    if (entries) {
        source = makeTree(entries);
        total = entries.length;
    }
    const q = query.toLowerCase();
    let count = 0;
    const branches: string[] = [];

    function filter(node: Node): Node | undefined {
        if (!node.children) {
            if (!node.path.toLowerCase().includes(q)) return;
            count++;
            return node;
        }
        const children: Node[] = [];
        for (const child of node.children) {
            const match = filter(child);
            if (match) children.push(match);
        }
        if (!children.length && node.id !== 'root') return;
        if (node.id !== 'root') branches.push(node.id);
        return {...node, children};
    }

    const root = q ? filter(source)! : source;
    self.postMessage({id, root, count: q ? count : total, branches, query});
};
export {};
