import type {Condition, Operation} from './aipolicy-data';
import {bytes, gbk, hex, operations} from './aipolicy-data';

const fields: Record<string, string> = {
    "c_time_come": "uID:u",
    "c_hp_less": "fPercent:f",
    "c_random": "fProbability:f",
    "c_var": "iID:i",
    "c_constant": "iValue:i",
    "c_be_hurt": "iHurtLow:i iHurtHigh:i",
    "c_reach_end": "iPathID:i",
    "c_history_value": "iValue:i",
    "c_local_var": "iID:i",
    "c_reach_end_2": "iPathID:i iPathIDType:i",
    "c_has_filter": "iID:i",
    "c_player_count_in_radius": "fRadius:f",
    "c_player_count_in_region": "zvMin:v zvMax:v",
    "o_attact": "uType:u",
    "o_use_skill": "uSkill:u uLevel:u",
    "o_run_trigger": "uID:u",
    "o_stop_trigger": "uID:u",
    "o_active_trigger": "uID:u",
    "o_create_timer": "uID:u uPeriod:u uCounter:u",
    "o_kill_timer": "uID:u",
    "o_active_controller": "uID:u bStop:b",
    "o_set_global": "iID:i iValue:i bIsValue:b",
    "o_revise_global": "iID:i iValue:i",
    "o_summon_monster": "iMonsterID:i iRange:i iLife:i iDispearCondition:i iPathID:i iMonsterNum:i",
    "o_walk_along": "iWorldID:i iPathID:i iPatrolType:i iSpeedType:i",
    "o_play_action": "szActionName:s128 iLoopCount:i iInterval:i iPlayTime:i",
    "o_revise_history": "iID:i iValue:i",
    "o_set_history": "iID:i iValue:i bIsHistoryValue:b",
    "o_deliver_faction_pvp_points": "uType:u",
    "o_calc_var": "iDst:i iDstType:i iSrc1:i iSrc1Type:i iOp:i iSrc2:i iSrc2Type:i",
    "o_summon_monster_2": "iDispearCondition:i iMonsterID:i iMonsterIDType:i iRange:i iLife:i iPathID:i iPathIDType:i iMonsterNum:i iMonsterNumType:i",
    "o_walk_along_2": "iWorldID:i iPathID:i iPathIDType:i iPatrolType:i iSpeedType:i",
    "o_use_skill_2": "uSkill:u uSkillType:u uLevel:u uLevelType:u",
    "o_active_controller_2": "uID:u uIDType:u bStop:b",
    "o_deliver_task": "uID:u uIDType:u",
    "o_summon_mine": "iLifeType:i iMineID:i iMineIDType:i iRange:i iLife:i iMineNum:i iMineNumType:i",
    "o_summon_npc": "iLifeType:i iNPCID:i iNPCIDType:i iRange:i iLife:i iPathID:i iPathIDType:i iNPCNum:i iNPCNumType:i",
    "o_deliver_random_task_in_region": "uID:u zvMin:v zvMax:v",
    "o_deliver_task_in_hate_list": "uID:u uIDType:u iRange:i iPlayerNum:i",
    "o_clear_tower_task_in_region": "zvMin:v zvMax:v",
    "o_save_player_count_in_radius_to_param": "fRadiusValue:f uRadiusType:u iTargetID:i uTargetType:u",
    "o_save_player_count_in_region_to_param": "zvMin:v zvMax:v iTargetID:i uTargetType:u",
    "c_at_history_stage": "iID:i"
};

export function availableOperations(version: number) {
    return version >= 4 ? operations : operations.slice(0, version >= 2 ? 17 : 15);
}

export function layout(type: string, version = 23) {
    let definition = fields[type] ?? '';
    if (type === 'o_active_controller' && version === 0) definition = 'uID:u';
    if (type === 'o_set_global' && version < 4) definition = 'iID:i iValue:i';
    if (type === 'o_summon_monster' && version < 7) {
        definition = 'iMonsterID:i iRange:i iLife:i bDispear:b bUsePolicyTarget:b iPathID:i iMonsterNum:i';
    }
    if (type === 'o_play_action' && version < 9) definition = 'szActionName:s128 bLoop:b iInterval:i';
    let offset = 0;
    const members = definition.split(' ').filter(Boolean).flatMap(field => {
        const [name, format] = field.split(':');
        const kind = format[0];
        if (kind !== 's' && kind !== 'b') offset = Math.ceil(offset / 4) * 4;
        const start = offset;
        const size = kind === 's' ? Number(format.slice(1)) : kind === 'b' ? 1 : kind === 'v' ? 12 : 4;
        offset += size;
        return kind === 'v' ? ['x', 'y', 'z'].map((axis, i) => ({
            name: name + '.' + axis, kind: 'f', offset: start + i * 4, size: 4
        })) : [{name, kind, offset: start, size}];
    });
    return {members, size: Math.ceil(offset / 4) * 4};
}

export const decodeName = (value: string) => gbk.decode(bytes(value)).split('\0')[0];
let gbkCharacters: Map<string, number[]> | undefined;

export function encodeName(text: string, size: number) {
    const result = new Uint8Array(size);
    let offset = 0;
    for (const char of text) {
        const code = char.codePointAt(0)!;
        let encoded: number[] | undefined;
        if (code > 0 && code < 128) encoded = [code];
        else {
            if (!gbkCharacters) {
                gbkCharacters = new Map([['€', [128]]]);
                for (let first = 0x81; first <= 0xfe; first++) {
                    for (let second = 0x40; second <= 0xfe; second++) {
                        if (second === 0x7f) continue;
                        const pair = [first, second];
                        const decoded = gbk.decode(Uint8Array.from(pair));
                        if (decoded.length === 1 && decoded !== '�' && !gbkCharacters.has(decoded)) {
                            gbkCharacters.set(decoded, pair);
                        }
                    }
                }
            }
            encoded = gbkCharacters.get(char);
        }
        if (!encoded) throw Error("Character “" + char + "” cannot be represented in GBK.");
        if (offset + encoded.length >= size) throw Error("The name is too long for the GBK field.");
        result.set(encoded, offset);
        offset += encoded.length;
    }
    return hex(result);
}

export function newCondition(type = 'c_start_attack', previous?: Condition): Condition {
    const node: Condition = {type, param: '00'.repeat(layout(type).size)};
    const expression = () => newCondition('c_constant');
    if (/^c_(plus|minus|multiply|divide|great|less|equ)$/.test(type)) {
        node.left = expression();
        node.right = expression();
    } else if (type === 'c_not' || type === 'c_and' || type === 'c_or') {
        if (type !== 'c_not') node.left = previous?.left ?? newCondition();
        node.right = previous?.right ?? newCondition();
    }
    return node;
}

export function newOperation(type: string, version: number, previous?: Operation): Operation {
    const result: Operation = {type, target: previous?.target ?? 't_self'};
    if (result.target === 't_occupation_list') result.occupationMask = previous?.occupationMask ?? 0;
    if (type === 'o_talk') {
        result.text = '\0';
        if (version >= 17) result.appendMask = 0;
    } else {
        const {size} = layout(type, version);
        if (size) result.param = '00'.repeat(size);
    }
    return result;
}
