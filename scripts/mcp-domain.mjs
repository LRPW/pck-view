import {readFileSync} from 'node:fs';
import {readDomain, writeDomain} from '../src/features/editor/domain-data';

const {name, bytes, patch, args} = JSON.parse(readFileSync(0, 'utf8'));
const document = readDomain(Buffer.from(bytes, 'base64'), name !== 'domain.data');
if (!patch) {
    process.stdout.write(JSON.stringify({territories: document.territories, speed: document.speed}));
} else {
    const {row, fields = {}, speed = document.speed} = args;
    const integer = value => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
    const vector = (value, size, predicate) => Array.isArray(value) && value.length === size && value.every(predicate);
    const point = value => vector(value, 2, integer);
    if (document.nations ? !Number.isFinite(Math.fround(speed)) || typeof speed !== 'number' : speed !== undefined) {
        throw Error('Invalid territory speed');
    }
    if (row !== undefined) {
        const territory = document.territories[row];
        if (!Number.isInteger(row) || !territory) throw Error('Invalid territory row');
        for (const [key, value] of Object.entries(fields)) {
            if (key === 'name' && typeof value === 'string' && value.length <= 16 && !value.includes('\0')) territory.name = value;
            else if (['id', 'type', 'reward'].includes(key) && integer(value)) territory[key] = value;
            else if (key === 'center' && point(value)) territory.center = value;
            else if (key === 'vertices' && Array.isArray(value) && value.every(point)) territory.vertices = value;
            else if (key === 'faces' && Array.isArray(value) && value.length % 3 === 0 && value.every(integer)) territory.faces = value;
            else if (key === 'neighbours' && Array.isArray(value) && value.every(integer)) territory.neighbours = value;
            else if (key === 'nations' && document.nations && value && integer(value.country) && integer(value.capital) &&
                vector(value.positions, 12, part => typeof part === 'number' && Number.isFinite(Math.fround(part)))) territory.nations = value;
            else throw Error('Invalid territory field: ' + key);
        }
    } else if (Object.keys(fields).length) {
        throw Error('Select a territory row to patch fields');
    }
    const output = writeDomain(document, document.territories, speed);
    readDomain(output, document.nations);
    process.stdout.write(Buffer.from(output).toString('base64'));
}
