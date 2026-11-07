import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rmdir, unlink, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {createInterface} from 'node:readline';

async function session(executable, source, output, test) {
    const child = spawn(executable, ['--mcp', ...(source ? [source] : []), ...(output ? [output] : [])], {
        stdio: ['pipe', 'pipe', 'inherit'],
    });
    const closed = once(child, 'close');
    const lines = createInterface({input: child.stdout})[Symbol.asyncIterator]();
    let id = 0;
    const send = (message) => child.stdin.write(JSON.stringify({jsonrpc: '2.0', ...message}) + '\n');

    async function request(method, params) {
        send({id: ++id, method, params});
        const line = await lines.next();
        assert.ok(!line.done, 'No response to ' + method);
        const response = JSON.parse(line.value);
        assert.equal(response.id, id);
        assert.ok(!response.error, JSON.stringify(response.error));
        return response.result;
    }

    async function call(name, args = {}) {
        const result = await request('tools/call', {name, arguments: args});
        assert.ok(!result.isError, JSON.stringify(result.content));
        return result.structuredContent ?? result.content;
    }

    try {
        await request('initialize', {
            protocolVersion: '2025-11-25', capabilities: {},
            clientInfo: {name: 'pckview-smoke', version: '1'},
        });
        send({method: 'notifications/initialized'});
        assert.ok((await request('tools/list')).tools.some(tool => tool.name === 'preview_ui'));
        await test(call);
    } finally {
        child.stdin.end();
        assert.equal((await closed)[0], 0);
    }
}

async function verifyData(executable, source, parent) {
    let manifest;
    await session(resolve(executable), null, null, async call => {
        const created = await call('create_project', {
            source: resolve(source), parent: resolve(parent), name: 'mcp-data-smoke-' + Date.now(), archives: [],
        });
        assert.equal(created.project.status, 'ready');
        manifest = created.manifest;
        const {entries} = await call('list_data', {query: '.data'});
        for (const name of ['elements.data', 'gshop2.data', 'tasks.data', 'dyn_tasks.data', 'task_npc.data', 'domain.data']) {
            const entry = 'data/' + name;
            assert.ok(entries.includes(entry), entry);
            const result = await call('inspect_data', {entry, selection: {}});
            assert.ok(result.record);
        }
        const entry = 'data/domain.data';
        const inspected = await call('inspect_data', {entry, selection: {}});
        await call('patch_data', {entry, revision: inspected.revision, patch: {row: 0, fields: {name: 'MCP test'}}});
        const raw = await call('read_data', {entry: 'data/opaque.bin'});
        assert.equal(raw.data, 'AAE=');
        await call('replace_data', {entry: raw.entry, revision: raw.revision, data: 'AgM='});
        await call('save');

        const exported = await call('export_texts');
        const catalog = JSON.parse(await readFile(exported.path, 'utf8'));
        const row = catalog.entries.find(row => row.file === entry && row.segments.length === 1);
        assert.ok(row);
        const provider = createServer((request, response) => {
            request.resume();
            request.on('end', () => {
                response.setHeader('content-type', 'application/json');
                response.end(JSON.stringify({choices: [{message: {content: '["Translated"]'}}]}));
            });
        });
        provider.listen(0, '127.0.0.1');
        await once(provider, 'listening');
        try {
            const translated = await call('translate_texts', {
                settings: {
                    provider: 'compatible',
                    endpoint: 'http://127.0.0.1:' + provider.address().port,
                    model: 'smoke',
                    useStoredCredential: false
                },
                texts: [row.segments[0].text], target: 'ru',
            });
            assert.deepEqual(translated.texts, ['Translated']);
        } finally {
            provider.close();
        }
        await call('save_translations', {
            language: 'ru', changes: {
                entries: [
                    {file: row.file, path: row.path, texts: ['Translated']},
                ]
            }
        });
        const applied = await call('apply_translations', {language: 'ru'});
        assert.deepEqual(applied.errors, []);
        const build = await call('build_archive');
        assert.equal(build.loose_files, 2);
        assert.deepEqual(await readFile(join(build.directory, 'data', 'opaque.bin')), Buffer.from([2, 3]));
    });
    await session(resolve(executable), null, null, async call => {
        await call('open_project', {manifest});
        assert.equal((await call('read_data', {entry: 'data/opaque.bin'})).data, 'AgM=');
        const {record} = await call('inspect_data', {entry: 'data/domain.data', selection: {}});
        assert.ok(record.territories.some(territory => territory.name === 'Translated'));
    });
    console.log('Project creation, structured data, raw replacement, locale import/apply, build and reopen verified');
}

const [executable, source, query, parent] = process.argv.slice(2);
if (query === '--data') {
    await verifyData(executable, source, parent);
    process.exit(0);
}
assert.ok(query, 'Usage: node scripts/mcp-smoke.mjs EXE INPUT.pck SEARCH');
const digest = async () => createHash('sha256').update(await readFile(source)).digest('hex');
const original = await digest();
const project = source.toLowerCase().endsWith('.pwforge');
const directory = await mkdtemp(resolve('pckview-mcp-'));
const output = join(directory, 'interfaces-edited.pck');
try {
    let entry, node, oldWidth, newPreview, build;
    await session(resolve(executable), resolve(source), project ? null : output, async (call) => {
        const result = await call('search_ui', {query});
        [entry] = result.entries;
        assert.ok(entry, 'No matching window');
        const dialog = await call('inspect_ui', {entry});
        const candidates = dialog.nodes.slice(1).map(node => ({
            index: node.index,
            attributes: Object.fromEntries(node.attributes.map(([key, value]) => [key.toLowerCase(), value])),
        }));
        node = candidates.find(({attributes}) =>
            Number(attributes.width) > 0 && Number(attributes.width) < 9900 &&
            Number(attributes.height) > 0 && attributes.name);
        assert.ok(node, 'No editable named control');
        oldWidth = Number(node.attributes.width);
        const [beforeReport, beforeImage] = await call('preview_ui', {entry});
        const before = beforeImage.data;
        console.log('Before:', beforeReport.text);
        await call('patch_ui', {
            entry, node: node.index, revision: dialog.revision,
            attribute: 'Width', value: oldWidth + 11
        });
        const [afterReport, afterImage] = await call('preview_ui', {entry});
        newPreview = afterImage.data;
        console.log('After:', afterReport.text);
        if (process.env.PCKVIEW_MCP_SMOKE_IMAGES) {
            const assets = JSON.parse(afterReport.text);
            assert.ok(assets.textures > 0 && assets.fonts > 0, 'Expected real textures and fonts');
            await writeFile(join(process.env.PCKVIEW_MCP_SMOKE_IMAGES, 'inventory-before.png'), Buffer.from(before, 'base64'));
            await writeFile(join(process.env.PCKVIEW_MCP_SMOKE_IMAGES, 'inventory-after.png'), Buffer.from(newPreview, 'base64'));
        }
        assert.equal(Buffer.from(newPreview, 'base64').subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        assert.notEqual(before, newPreview);
        await call('save');
        build = await call('build_archive');
    });

    async function verify(call, path, comparePreview = true) {
        const reopened = (await call('inspect_ui', {entry: path})).nodes[node.index];
        assert.equal(Object.fromEntries(reopened.attributes).Width, String(oldWidth + 11));
        if (comparePreview) assert.equal((await call('preview_ui', {entry: path}))[1].data, newPreview);
    }

    if (project) {
        await session(resolve(executable), resolve(source), null, call => verify(call, entry));
        assert.equal(build.archives.length, 1, 'Use a disposable project with no preexisting edits');
        const [archive] = build.archives;
        const prefix = 'archives/' + archive + '/';
        assert.ok(entry.startsWith(prefix));
        const built = join(build.directory, archive);
        await session(resolve(executable), built, join(directory, 'unused.pck'),
            call => verify(call, entry.slice(prefix.length), false));
    } else {
        await session(resolve(executable), output, join(directory, 'unused.pck'),
            call => verify(call, entry));
    }
    assert.equal(await digest(), original);
    console.log(entry + ' / ' + node.attributes.name + ': Width ' + oldWidth + ' -> ' +
        (oldWidth + 11) + '; PNG and reopened PCK verified');
} finally {
    await unlink(output).catch(error => {
        if (error.code !== 'ENOENT') throw error;
    });
    await rmdir(directory);
}
