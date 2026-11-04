export type Point = [number, number];
export type Territory = {
    name: string;
    id: number;
    type: number;
    reward: number;
    center: Point;
    vertices: Point[];
    faces: number[];
    neighbours: number[];
    nations?: { country: number; capital: number; positions: number[] };
};
export type DomainData = {
    territories: Territory[];
    header: Uint8Array;
    names: Uint8Array[];
    schedule: Uint8Array;
    nations: boolean;
    speed?: number;
};

function decodeName(raw: Uint8Array) {
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    let name = '';
    for (let i = 0; i < 32; i += 2) {
        const code = view.getUint16(i, true);
        if (!code) break;
        name += String.fromCharCode(code);
    }
    return name;
}

export function readDomain(bytes: Uint8Array, nations = false): DomainData {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;

    function take(size: number) {
        if (size > bytes.length - offset) throw new Error('Файл domain.data обрезан');
        const start = offset;
        offset += size;
        return start;
    }

    const i32 = () => view.getInt32(take(4), true);

    function count(unit: number) {
        const length = i32();
        if (length < 0 || length > Math.floor((bytes.length - offset) / unit)) {
            throw new Error('Некорректный размер блока domain.data');
        }
        return length;
    }

    const point = (): Point => [i32(), i32()];
    if (view.byteLength >= 4 && view.getUint32(0, true) === 0x42584f4d) take(4);
    let speed: number | undefined;
    if (nations) {
        take(4);
        speed = view.getFloat32(take(4), true);
        if (!Number.isFinite(speed)) throw new Error('Некорректная скорость перемещения');
    }
    const prefix = bytes.slice(0, offset);
    const names: Uint8Array[] = [];
    const territories = Array.from({length: count(nations ? 120 : 64)}, () => {
        const start = take(32);
        const raw = bytes.slice(start, start + 32);
        names.push(raw);
        const name = decodeName(raw);
        const id = i32();
        const first = i32();
        const second = i32();
        const type = nations ? second : first;
        const reward = nations ? first : second;
        const extra = nations ? {
            country: i32(), capital: i32(),
            positions: Array.from({length: 12}, () => view.getFloat32(take(4), true)),
        } : undefined;
        if (extra?.positions.some(value => !Number.isFinite(value))) throw new Error(`Некорректные координаты территории ${id}`);
        const center = point();
        const vertices = Array.from({length: count(8)}, point);
        const faces = Array.from({length: count(12) * 3}, i32);
        const neighbours = Array.from({length: count(4)}, i32);
        if (faces.some(index => index < 0 || index >= vertices.length)) {
            throw new Error(`Территория ${id} содержит неверный индекс вершины`);
        }
        return {name, id, type, reward, center, vertices, faces, neighbours, nations: extra};
    });
    const schedule = bytes.slice(offset);
    take(count(12) * 12);
    i32();
    return {territories, header: prefix, names, schedule, nations, speed};
}

export function writeDomain(document: DomainData, territories: Territory[], speed = document.speed) {
    const size = document.header.length + 4 + document.schedule.length +
        territories.reduce((sum, item) => sum + (document.nations ? 120 : 64) + item.vertices.length * 8 +
            item.faces.length * 4 + item.neighbours.length * 4, 0);
    const bytes = new Uint8Array(size);
    const view = new DataView(bytes.buffer);
    let offset = 0;

    function raw(data: Uint8Array) {
        bytes.set(data, offset);
        offset += data.length;
    }

    function i32(value: number) {
        view.setInt32(offset, value, true);
        offset += 4;
    }

    raw(document.header);
    if (document.nations && speed !== undefined && !Object.is(speed, document.speed)) {
        view.setFloat32(offset - 4, speed, true);
    }
    i32(territories.length);
    territories.forEach((item, index) => {
        const originalName = document.names[index];
        if (originalName && decodeName(originalName) === item.name) raw(originalName);
        else {
            for (let i = 0; i < item.name.length; i++) view.setUint16(offset + i * 2, item.name.charCodeAt(i), true);
            offset += 32;
        }
        i32(item.id);
        if (document.nations) {
            if (!item.nations) throw new Error('Нет параметров территории Войны наций');
            [item.reward, item.type, item.nations.country, item.nations.capital].forEach(i32);
            for (const value of item.nations.positions) {
                view.setFloat32(offset, value, true);
                offset += 4;
            }
        } else {
            [item.type, item.reward].forEach(i32);
        }
        [...item.center, item.vertices.length].forEach(i32);
        item.vertices.forEach(vertex => vertex.forEach(i32));
        i32(item.faces.length / 3);
        item.faces.forEach(i32);
        i32(item.neighbours.length);
        item.neighbours.forEach(i32);
    });
    raw(document.schedule);
    return bytes;
}
