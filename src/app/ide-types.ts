import type {ResourceScope} from '../features/editor/resource-context';
import type {IdeHit} from '../features/search/IdeSearchWindow';

export type Tab = {
    key: string;
    scope: number;
    index?: number;
    resource?: string;
    kind: 'file' | 'server-records' | 'aipolicy' | 'elements' | 'gshop' | 'domain' | 'tasks' | 'task-npc' | 'locale' | 'source' | 'new';
    title: string;
    dirty: boolean;
    jump?: IdeHit['hit'];
    itemJump?: { id: number; npc?: boolean }
};
export type ResourcePick = {
    tab: string;
    scope: ResourceScope;
    field: string;
    imageOnly: boolean;
    choose: (path: string) => void
};
