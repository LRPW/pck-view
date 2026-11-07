export const [conditions, operations, targets, sizes] = [["c_time_come", "c_hp_less", "c_start_attack", "c_random", "c_kill_player", "c_not", "c_or", "c_and", "c_died", "c_plus", "c_minus", "c_multiply", "c_divide", "c_great", "c_less", "c_equ", "c_var", "c_constant", "c_be_hurt", "c_reach_end", "c_at_history_stage", "c_history_value", "c_stop_fight", "c_local_var", "c_reach_end_2", "c_has_filter", "c_room_index", "c_player_count_in_radius", "c_player_count_in_region"], ["o_attact", "o_use_skill", "o_talk", "o_reset_hate_list", "o_run_trigger", "o_stop_trigger", "o_active_trigger", "o_create_timer", "o_kill_timer", "o_flee", "o_set_hate_to_first", "o_set_hate_to_last", "o_set_hate_fifty_percent", "o_skip_operation", "o_active_controller", "o_set_global", "o_revise_global", "o_summon_monster", "o_walk_along", "o_play_action", "o_revise_history", "o_set_history", "o_deliver_faction_pvp_points", "o_calc_var", "o_summon_monster_2", "o_walk_along_2", "o_use_skill_2", "o_active_controller_2", "o_deliver_task", "o_summon_mine", "o_summon_npc", "o_deliver_random_task_in_region", "o_deliver_task_in_hate_list", "o_clear_tower_task_in_region", "o_save_player_count_in_radius_to_param", "o_save_player_count_in_region_to_param"], ["t_hate_first", "t_hate_second", "t_hate_others", "t_most_hp", "t_most_mp", "t_least_hp", "t_occupation_list", "t_self", "t_monster_killer", "t_monster_birthplace_faction", "t_hate_random_one", "t_hate_nearest", "t_hate_farthest", "t_hate_first_redirected"], [4, 8, -1, 0, 4, 4, 4, 12, 4, 0, 0, 0, 0, 0, 8, 12, 8, 24, 16, 140, 8, 12, 4, 28, 36, 20, 16, 12, 8, 28, 36, 28, 16, 24, 16, 32]];
export const gbk = new TextDecoder("gbk");
const utf16 = new TextDecoder("utf-16le", {ignoreBOM: true});
export const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");

export function bytes(value) {
    if (typeof value !== "string" || !/^(?:[0-9a-f]{2})*$/i.test(value)) throw Error("Invalid HEX");
    return Uint8Array.from(value.match(/../g) ?? [], b => parseInt(b, 16));
}

export function transfer(input, data) {
    let offset = 0;
    const output = [];
    const view = input && new DataView(input.buffer, input.byteOffset, input.byteLength);

    function raw(length, value) {
        if (!input) {
            if (value.length !== length) throw Error("Expected bytes: " + length);
            for (const b of value) output.push(b);
            return value;
        }
        if (offset + length > input.length) throw Error("End of file at byte " + offset);
        const result = input.subarray(offset, offset + length);
        offset += length;
        return result;
    }

    function uint(value, length = 4) {
        if (input) {
            raw(length);
            return length === 1 ? input[offset - 1] : view.getUint32(offset - 4, true);
        }
        if (!Number.isInteger(value) || value < 0 || value >= 2 ** (length * 8)) throw Error("Invalid number: " + value);
        for (let i = 0; i < length; i++) output.push((value >>> (8 * i)) & 255);
        return value;
    }

    function version(value, min, max) {
        const v = uint(value);
        if (v < min || v > max) throw Error("Unsupported version: " + v);
        return v;
    }

    function list(values, item) {
        const count = uint(values?.length);
        if (count > 100000) throw Error("Invalid count: " + count);
        return Array.from({length: count}, (_, i) => item(values?.[i]));
    }

    function blob(length, value) {
        return hex(raw(length, input ? undefined : bytes(value)));
    }

    function kind(names, value) {
        const index = uint(names.indexOf(value));
        if (index >= names.length) throw Error("Unknown type " + index + " at byte " + (offset - 4));
        return index;
    }

    function condition(node, depth = 0) {
        if (depth > 128) throw Error("Condition tree is too deep");
        const type = kind(conditions, node?.type);
        const param = blob(uint(node?.param.length / 2), node?.param);
        const result = {type: conditions[type], param};
        if (input) {
            for (let flag = uint(); flag !== 3 && flag !== 4; flag = uint()) {
                const side = ["", "left", "right"][flag];
                if (!side || result[side]) throw Error("Invalid branch at byte " + (offset - 4));
                result[side] = condition(undefined, depth + 1);
            }
        } else {
            for (const [index, side] of ["left", "right"].entries()) {
                if (node[side]) {
                    uint(index + 1);
                    condition(node[side], depth + 1);
                }
            }
            uint(node.left || node.right ? 4 : 3);
        }
        return result;
    }

    function operation(op, v) {
        const type = kind(operations, op?.type);
        let size = sizes[type];
        if (v < 4 && (type > 16 || (v < 2 && type > 14))) size = 0;
        if (type === 14 && v === 0) size = 4;
        if (type === 15 && v < 4 && size) size = 8;
        if (type === 19 && v < 9 && size) size = 136;
        const result = {type: operations[type]};
        if (size === -1) {
            const value = input ? undefined : Uint8Array.from(op.text.split("").flatMap(c => {
                const n = c.charCodeAt(0);
                return [n & 255, n >>> 8];
            }));
            const length = uint(value?.length);
            if (length % 2) throw Error("Odd UTF-16 byte length");
            result.text = utf16.decode(raw(length, value));
            if (v >= 17) result.appendMask = uint(op?.appendMask);
        } else if (size) result.param = blob(size, op?.param);
        const target = kind(targets, op?.target);
        result.target = targets[target];
        if (target === 6) result.occupationMask = uint(op?.occupationMask);
        return result;
    }

    function trigger(t) {
        const v = version(t?.version, 0, 23);
        return {
            version: v, id: uint(t?.id), active: uint(t?.active, 1), run: uint(t?.run, 1),
            battleOnly: uint(t?.battleOnly, 1), nameGBK: blob(128, t?.nameGBK),
            condition: condition(t?.condition), operations: list(t?.operations, o => operation(o, v))
        };
    }

    version(1, 1, 1);
    const policies = list(data, p => ({
        version: version(p?.version, 1, 1), id: uint(p?.id), triggers: list(p?.triggers, trigger)
    }));
    if (!input) return Uint8Array.from(output);
    if (offset !== input.length) throw Error("Trailing data after byte " + offset);
    return policies;
}


