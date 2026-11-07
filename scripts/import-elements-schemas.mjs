import {readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: node scripts/import-elements-schemas.mjs <cfg-directory>');

const schemas = {};
const profiles = [];
const variants = new Map();
const files = readdirSync(directory).filter(name => /_v\d+(?:_\d+)?\.cfg$/i.test(name)).sort();
let sourceBytes = 0;
for (const file of files) {
    const match = file.match(/^PW_(.+)_v(\d+)(?:_(\d+))?\.cfg$/i);
    if (!match) throw new Error('Invalid schema filename: ' + file);
    const [, client, version, variant] = match;
    const source = readFileSync(join(directory, file), 'utf8');
    sourceBytes += Buffer.byteLength(source);
    const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const count = Number(lines.shift());
    const dialogueIndex = Number(lines.shift());
    if (lines.length !== count * 4) throw new Error('Incorrect table count in ' + file);
    const profile = {
        version: Number(version),
        client, ...(variant ? {variant} : {}),
        headerBytes: 4,
        lengthPrefixes: {},
        tables: []
    };
    let firstPrefix = true;
    for (let index = 0; index < count; index++) {
        const [label, prefix, names, types] = lines.slice(index * 4, index * 4 + 4);
        const name = label.replace(/^\d+\s*-\s*/, '');
        const fieldNames = names.split(';').filter(Boolean);
        const fieldTypes = types.split(';').filter(Boolean);
        if (fieldTypes.length === 1 && fieldTypes[0] === 'byte:AUTO') {
            if (prefix !== '0') throw new Error('Unexpected dialogue block in ' + file);
            if (index !== dialogueIndex) console.warn(file + ': using the explicit dialogue block at table ' + index);
            profile.tables.push('$dialogues');
            continue;
        }
        if (fieldNames.length !== fieldTypes.length) {
            // This profile has two extra labels without corresponding binary fields.
            if (Number(version) !== 135 || name !== 'MNFACTION_WAR_CONFIG' || fieldNames.length !== fieldTypes.length + 2) {
                throw new Error('Mismatched fields in ' + file + ': ' + name);
            }
            console.warn(file + ': ignoring two labels without binary types in ' + name);
        }
        const fields = fieldTypes.map((type, position) => {
            if (!/^(int32|float|(?:wstring|string|byte):[1-9]\d*)$/.test(type)) {
                throw new Error('Unknown field type ' + type + ' in ' + file);
            }
            const fieldName = fieldNames[position];
            return [/^(id|name)$/i.test(fieldName) ? fieldName.toLowerCase() : fieldName, type];
        });
        const key = JSON.stringify(fields);
        const definitions = variants.get(name) ?? new Map();
        variants.set(name, definitions);
        if (!definitions.has(key)) {
            const id = definitions.size ? name + '@' + (definitions.size + 1) : name;
            definitions.set(key, id);
            schemas[id] = {name, fields};
        }
        const id = definitions.get(key);
        profile.tables.push(id);
        if (prefix === '4' && index === 0) {
            profile.headerBytes += 4;
        } else if (prefix === 'AUTO') {
            profile.lengthPrefixes[id] = firstPrefix ? 4 : 0;
            firstPrefix = false;
        } else if (prefix !== '0') {
            throw new Error('Unknown table prefix in ' + file + ': ' + prefix);
        }
    }
    profiles.push(profile);
}
if (!profiles.length) throw new Error('No CFG profiles found');
profiles.sort((a, b) => a.version - b.version || Number(a.variant ?? -1) - Number(b.variant ?? -1));

// Keep each field on its own line and each profile's table order visible.
const output = JSON.stringify({format: 'pwforge-elements-schemas-v1', profiles, schemas}, null, 2)
    .replace(/\[\n\s+("[^"\n]*"),\n\s+("[^"\n]*")\n\s+\]/g, '[$1, $2]') + '\n';
writeFileSync(new URL('../src-tauri/src/elements-catalog.json', import.meta.url), output);
console.log(profiles.length + ' profiles, ' + Object.keys(schemas).length + ' unique table schemas');
console.log(sourceBytes + ' source bytes -> ' + Buffer.byteLength(output) + ' catalog bytes');
