type Node = { id: string; name: string; path: string; index?: number; children?: Node[]; childCount?: number };
type Request = { entries?: string[]; query: string; expanded: string[]; id: number };

const collator = new Intl.Collator();
const makeRoot = (): Node => ({id: 'root', name: 'Ресурсы', path: '', children: []});
let source = makeRoot();
let folders = new Map<string, Node>();
let entries: string[] = [];
let indexed = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let request: Request;
let lastPublish = 0;
const dirty = new Set<Node>();

function insert(entry: string, index: number) {
    const parts = entry.replaceAll('\\', '/').split('/').filter(Boolean);
    let parent = source;
    let path = '';
    parts.forEach((part, depth) => {
        path += (path ? '/' : '') + part;
        if (depth === parts.length - 1) {
            parent.children!.push({id: 'file:' + index, name: part, path, index});
            dirty.add(parent);
        } else {
            const key = path.toLowerCase();
            let folder = folders.get(key);
            if (!folder) {
                folder = {id: 'folder:' + key, name: part, path, children: []};
                folders.set(key, folder);
                parent.children!.push(folder);
                dirty.add(parent);
            }
            parent = folder;
        }
    });
}

function prepare() {
    timer = undefined;
    const end = Math.min(entries.length, indexed + (indexed === 0 ? 500 : 4000));
    for (; indexed < end; indexed++) insert(entries[indexed], indexed);
    if (lastPublish === 0 || performance.now() - lastPublish >= 100 || indexed === entries.length) {
        publish();
    }
    if (indexed < entries.length) timer = setTimeout(prepare, 0);
}

self.onmessage = (event: MessageEvent<Request>) => {
    request = event.data;
    if (request.entries) {
        clearTimeout(timer);
        const append = entries.length <= request.entries.length &&
            entries.every((name, index) => name === request.entries![index]);
        if (!append) {
            source = makeRoot();
            folders = new Map();
            dirty.clear();
            indexed = 0;
        }
        entries = request.entries;
        lastPublish = 0;
        prepare();
    } else {
        publish();
    }
};

function publish() {
    lastPublish = performance.now();
    for (const folder of dirty) {
        folder.children!.sort((a, b) => Number(!!b.children) - Number(!!a.children) || collator.compare(a.name, b.name));
    }
    dirty.clear();
    const {id, query, expanded} = request;
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

    const open = new Set(expanded);

    function visible(node: Node): Node {
        if (!node.children) return node;
        if (node.id !== 'root' && !open.has(node.id)) {
            return {...node, childCount: node.children.length, children: []};
        }
        return {...node, children: node.children.map(visible)};
    }

    const root = q ? filter(source)! : visible(source);
    self.postMessage({id, root, count: q ? count : indexed, branches, query, done: indexed === entries.length});
}

export {};
