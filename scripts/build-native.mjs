import {spawnSync} from 'node:child_process';
import {copyFileSync, mkdirSync, statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync('native-gfx\\build.cmd', {cwd: root, shell: true, stdio: 'inherit'});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const files = [
    'native-gfx.exe', 'ImmWrapper.dll', 'ifc22.dll', 'zlibwapi.dll',
    'msvcp140.dll', 'vcruntime140.dll', 'd3dx9_43.dll',
];
const output = join(root, 'native-gfx', 'out');
const runtime = join(root, 'runtimes', 'native-gfx');
for (const file of files) {
    if (!statSync(join(output, file)).isFile()) throw new Error(`Missing native runtime file: ${file}`);
}
mkdirSync(runtime, {recursive: true});
for (const file of files) copyFileSync(join(output, file), join(runtime, file));
