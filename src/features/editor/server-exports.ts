export function serverExportName(source: string) {
    switch (source.toLowerCase().split(/[\\/]/).at(-1)) {
        case 'world_targets.txt':
            return 'world_targets.sev';
        case 'serverlist.txt':
            return 'serverlist.sev';
    }
}

function integer(text: string) {
    const value = Number(text);
    if (!/^[+-]?\d+$/.test(text) || !Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
        throw Error("Invalid integer: " + text);
    }
    return value;
}

export function writeWorldTargets(text: string) {
    // Keep quoted tokens intact while stripping the client script's comments.
    const source = text.replace(/"[^"\r\n]*"|\([^\r\n)]*\)|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
        token => token.startsWith('/') ? token.replace(/[^\r\n]/g, ' ') : token);
    const targets = source.split(/\r?\n/).flatMap((line, i) => {
        if (!line.trim()) return [];
        const tokens = line.match(/"[^"]*"|\([^)]*\)|[^\s;,]+/g) ?? [];
        if (tokens.length !== 5) throw Error("Invalid teleport target on line " + (i + 1));
        const [id, , world, xyz, domain] = tokens;
        const coords = xyz.replace(/^["(]|[")]$/g, '').split(',').map(value =>
            value.trim() ? Math.fround(Number(value)) : NaN);
        if (coords.length !== 3 || coords.some(value => !Number.isFinite(value))) {
            throw Error("Invalid coordinates on line " + (i + 1));
        }
        return [{id: integer(id), world: integer(world), coords, domain: integer(domain)}];
    });
    if (!targets.length) throw Error("The teleport target list is empty");
    const data = new Uint8Array(4 + 24 * targets.length);
    const view = new DataView(data.buffer);
    view.setInt32(0, targets.length, true);
    targets.forEach(({id, world, coords, domain}, i) => {
        const offset = 4 + i * 24;
        view.setInt32(offset, id, true);
        view.setInt32(offset + 4, world, true);
        coords.forEach((value, axis) => view.setFloat32(offset + 8 + 4 * axis, value, true));
        view.setInt32(offset + 20, domain, true);
    });
    return data;
}

export function writeServerList(text: string) {
    const ids = new Set<number>();
    const names = new Set<string>();
    const servers = text.split(/\r?\n/).flatMap(line => {
        const [rawName, address, zoneId, ...flags] = line.split('\t');
        if (!address?.includes(':') || !zoneId || flags.includes('&2') || zoneId === '&2') return [];
        const id = Number(zoneId);
        const name = rawName.replace(/\s+/gu, '');
        if (!Number.isInteger(id) || id <= 0 || id > 2147483647 || ids.has(id) || !name || names.has(name)) return [];
        if (name.length > 32) throw Error("Zone name exceeds 32 UTF-16 code units: " + name);
        ids.add(id);
        names.add(name);
        return [{id, name}];
    });
    if (!servers.length) throw Error("No ordinary servers with zone IDs were found");
    const data = new Uint8Array(servers.reduce((size, server) => size + 8 + server.name.length * 2, 0));
    const view = new DataView(data.buffer);
    let offset = 0;
    for (const {id, name} of servers) {
        view.setInt32(offset, id, true);
        view.setInt32(offset + 4, name.length, true);
        offset += 8;
        for (let i = 0; i < name.length; i++, offset += 2) view.setUint16(offset, name.charCodeAt(i), true);
    }
    return data;
}
