export type Format = 'extra_drops.sev' | 'npcgen.data' | 'path.sev' | 'wmgj.nmd';
export type Kind = 'i' | 'u' | 'f' | 'b' | 'y' | 's';
export type Field = { name: string; kind: Kind; offset: number; min?: number; max?: number };
export type Block = { label: string; offset: number; count: number; stride: number; fields: Field[] };
export type Group = { label: string; records: RecordEntry[] };
export type RecordEntry = { blocks: Block[]; idOffset?: number; nameOffset?: number };

export function structuredFormat(name: string): Format | undefined {
    const key = name.toLowerCase().split(/[\\/]/).at(-1);
    if (key === 'extra_drops.sev' || key === 'npcgen.data' || key === 'path.sev' || key === 'wmgj.nmd') return key;
}

function sizeOf(kind: Kind) {
    return kind === 's' ? 128 : kind === 'b' || kind === 'y' ? 1 : 4;
}

// A dash reserves a structural field that cannot be changed by the form.
function schema(definition: string) {
    let stride = 0;
    const fields: Field[] = [];
    for (const token of definition.split(' ')) {
        const [name, type = 'i'] = token.split(':');
        const kind = type as Kind;
        if (name !== '-') fields.push({name: name.replaceAll('_', ' '), kind, offset: stride});
        stride += sizeOf(kind);
    }
    return {stride, fields};
}

const xyz = (name: string) => ['X', 'Y', 'Z'].map(axis => name + '_' + axis + ':f').join(' ');
const areaFlags = "Initial_spawn:b Auto_respawn:b Once_only:b Generator_ID:u";
const npcArea = schema("Area_type - " + xyz("Position") + ' ' + xyz("Direction") + ' ' + xyz("Size") +
    " NPC_type Group_type " + areaFlags);
const npcAreaModern = schema("Area_type - " + xyz("Position") + ' ' + xyz("Direction") + ' ' + xyz("Size") +
    " NPC_type Group_type " + areaFlags + " Controller Lifetime Maximum");
const npcFields = "Template_ID:u Quantity:u Respawn Deaths_before_reset:u Aggression:u Water_offset:f " +
    "Terrain_offset:f Faction:u Helper_factions:u Accepted_factions:u Request_help:b " +
    "Default_faction:b Default_helpers:b Default_response:b Path_ID Loop Run Corpse_lifetime";
const npc = schema(npcFields);
const npcModern = schema(npcFields + " Minimum_respawn");
const resourceAreaFields = xyz("Position") + " Radius_X:f Radius_Z:f - " + areaFlags;
const rotation = " Direction_1:y Direction_2:y Angle:y";
const resourceAreas = [schema(resourceAreaFields), schema(resourceAreaFields + rotation),
    schema(resourceAreaFields + rotation + " Controller Maximum")];
const resources = schema("Type Template_ID Respawn:u Quantity:u Height:f");
const objectFields = "Object_ID:u " + xyz("Position") + rotation;
const objects = [schema(objectFields), schema(objectFields + " Controller:u"), schema(objectFields + " Controller:u Scale:y")];
const time = (prefix: string) => ["Year", "Month", "Weekday", "Day", "Hour", "Minute"]
    .map(name => prefix + '_' + name).join(' ');
const controllerFields = "ID:u Controller_ID Name:s Active:b Start_delay Stop_delay " +
    "Ignore_start_time:b Ignore_stop_time:b " + time("Start") + ' ' + time("Stop");
const controllers = [schema(controllerFields), schema(controllerFields + " Start_time_range")];
const points = schema(xyz("Position") + ' ' + xyz("Direction"));
const segment = schema(xyz("Start_handle") + ' ' + xyz("End_handle") + " Start_index End_index Length:f");
const probability = (name: string) => ({
    ...schema(name + ':f'),
    fields: [{name, kind: 'f' as const, offset: 0, min: 0, max: 1}]
});

export function readServerRecords(format: Format, bytes: Uint8Array): Group[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;

    function take(length: number) {
        const start = offset;
        if (!Number.isSafeInteger(length) || length < 0 || start + length > bytes.length) {
            throw Error("File truncated at byte " + start);
        }
        offset += length;
        return start;
    }

    const i32 = () => view.getInt32(take(4), true);

    function count() {
        const n = i32();
        if (n < 0 || n > Math.min(1_000_000, bytes.length / 4)) throw Error("Invalid record count");
        return n;
    }

    function block(label: string, layout: ReturnType<typeof schema>, n = 1): Block {
        return {label, ...layout, count: n, offset: take(layout.stride * n)};
    }

    function group(label: string, n: number, read: () => RecordEntry): Group {
        return {label, records: Array.from({length: n}, read)};
    }

    let groups: Group[];
    const version = i32();
    switch (format) {
        case 'extra_drops.sev':
            if (version !== 1) throw Error("Unsupported extra_drops version: " + version);
            groups = [group("Drop tables", count(), () => {
                const monsters = block("Monsters", schema("Monster_ID:u"), count());
                const items = block("Items", {
                    stride: 8, fields: [...schema("Item_ID:u").fields,
                        {name: "Probability", kind: 'f', offset: 4, min: 0, max: 1}]
                }, 256);
                const settings = block("Settings", {
                    stride: 132, fields: [schema("Name:s").fields[0], {
                        name: "Mode (1 — replace, 2 — add)",
                        kind: 'i', offset: 128, min: 1, max: 2
                    }]
                });
                return {
                    nameOffset: settings.offset, blocks: [settings, monsters, items,
                        block("Quantity probability (0–7)", probability("Probability"), 8)]
                };
            })];
            break;
        case 'npcgen.data': {
            if (version < 0 || version > 11) throw Error("Unsupported npcgen version: " + version);
            const ai = count(), res = count(), dyn = version >= 6 ? count() : 0, ctrl = version >= 7 ? count() : 0;
            groups = [
                group("NPC and monster areas", ai, () => {
                    const n = view.getInt32(offset + 4, true);
                    const area = block("Area", version >= 7 ? npcAreaModern : npcArea);
                    const spawns = block("Spawns", version >= 11 ? npcModern : npc, n);
                    return {blocks: [area, spawns], idOffset: n ? spawns.offset : undefined};
                }),
                group("Resource areas", res, () => {
                    const n = view.getInt32(offset + 20, true);
                    return {
                        blocks: [block("Area", resourceAreas[version >= 7 ? 2 : version >= 6 ? 1 : 0]),
                            block("Resources", resources, n)]
                    };
                }),
                group("Dynamic objects", dyn, () => {
                    const object = block("Object", objects[version >= 10 ? 2 : version >= 9 ? 1 : 0]);
                    return {blocks: [object], idOffset: object.offset};
                }),
                group("Controllers", ctrl, () => {
                    const control = block("Controller", controllers[version >= 8 ? 1 : 0]);
                    return {blocks: [control], idOffset: control.offset + 4, nameOffset: control.offset + 8};
                }),
            ];
            break;
        }
        case 'path.sev':
            if (version < 0 || version > 1) throw Error("Unsupported path.sev version: " + version);
            groups = [group("Bezier paths", count(), () => {
                const revision = i32();
                const header = block("Path", schema(revision >= 2 ? "ID Global_ID Next_global_ID" : 'ID'));
                const nodes = block("Points", points, count());
                const edges = block("Segments", {
                    ...segment, fields: segment.fields.map(f =>
                        f.name.endsWith("index") ? {...f, min: 0, max: nodes.count - 1} :
                            f.name === "Length" ? {...f, min: 0} : f)
                }, count());
                return {blocks: [header, nodes, edges], idOffset: header.offset};
            })];
            break;
        case 'wmgj.nmd': {
            if (version !== 0x6e6d6466 || i32() !== 1) throw Error("Unsupported NMD version");
            take(8);
            const tagSize = 'V0.2======Convex_Hull_Data_Start========='.length;
            const ascii = new TextDecoder();
            const flags = schema("Flags:u");

            function collision() {
                const binding = block("Collision binding", schema("Template_ID"));
                const n = count();
                const blocks = [binding];
                for (let i = 0; i < n; i++) {
                    const start = take(tagSize);
                    const tag = ascii.decode(bytes.subarray(start, start + tagSize));
                    if (!/^(?:==========|V0\.[12]======)Convex_Hull_Data_Start=========$/.test(tag)) {
                        throw Error("Unknown NMD convex hull format at byte " + start);
                    }
                    if (tag.startsWith('V')) blocks.push(block("Hull " + (i + 1), flags));
                    take(i32());
                }
                return {blocks, idOffset: binding.offset};
            }

            groups = [group("NPCs and resources", count(), collision), group("Dynamic objects", count(), collision)];
            break;
        }
    }
    if (offset !== bytes.length) throw Error("Trailing data after byte " + offset);
    return groups;
}
