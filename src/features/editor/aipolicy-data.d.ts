export interface Condition {
    type: string;
    param: string;
    left?: Condition;
    right?: Condition;
}

export interface Operation {
    type: string;
    target: string;
    param?: string;
    text?: string;
    appendMask?: number;
    occupationMask?: number;
}

export interface Trigger {
    version: number;
    id: number;
    active: number;
    run: number;
    battleOnly: number;
    nameGBK: string;
    condition: Condition;
    operations: Operation[];
}

export interface AiPolicy {
    version: number;
    id: number;
    triggers: Trigger[];
}

export const conditions: readonly string[];
export const operations: readonly string[];
export const targets: readonly string[];
export const gbk: TextDecoder;

export function bytes(value: string): Uint8Array;

export function hex(value: Uint8Array): string;

export function transfer(input: Uint8Array): AiPolicy[];
export function transfer(input: null, data: AiPolicy[]): Uint8Array;
