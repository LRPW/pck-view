import {useCallback, useMemo} from 'react';
import {ElementsEditor} from '../features/editor/ElementsEditor';
import {type ResourceScope} from '../features/editor/resource-context';
import '../styles/ide.css';
import type {ResourcePick, Tab} from "./ide-types";

export function ElementsTab({
                                scope,
                                tab,
                                active,
                                onDirty,
                                onSaved,
                                onOpen,
                                readFieldImage,
                                openFieldResource,
                                openElementsRecord,
                                onResourcePick,
                                onCancelResourcePick
                            }: {
    scope: ResourceScope;
    tab: Tab;
    active: boolean;
    onDirty: (key: string, dirty: boolean) => void;
    onSaved: () => void;
    onOpen: () => void;
    readFieldImage: (scope: ResourceScope, path: string) => Promise<number[]>;
    openFieldResource: (scope: ResourceScope, path: string) => void;
    openElementsRecord: (scope: ResourceScope, id: number, npc?: boolean) => Promise<void>;
    onResourcePick: (pick: ResourcePick) => void;
    onCancelResourcePick: (tab: string) => void
}) {
    const gshopVersion = tab.kind === 'gshop' ? scope.gshopVersion ?? null : null;
    const elementsVersion = tab.kind === 'elements' ? scope.elementsProfile?.version : undefined;
    const elementsVariant = tab.kind === 'elements' ? scope.elementsProfile?.variant : undefined;
    const request = useMemo(() => ({
        id: scope.id,
        index: tab.index!,
        gshopVersion, elementsVersion, elementsVariant
    }), [scope.id, tab.index, gshopVersion, elementsVersion, elementsVariant]);
    const dirty = useCallback((value: boolean) => onDirty(tab.key, value), [onDirty, tab.key]);
    const readImage = useCallback((path: string) => readFieldImage(scope, path), [scope, readFieldImage]);
    const cancelPick = useCallback(() => onCancelResourcePick(tab.key), [onCancelResourcePick, tab.key]);
    return <ElementsEditor itemJump={tab.itemJump} openItem={(id, npc) => void openElementsRecord(scope, id, npc)}
                           openResource={path => openFieldResource(scope, path)} readImage={readImage}
                           cancelResourcePick={cancelPick} pickResource={(field, imageOnly, choose) => onResourcePick({
        tab: tab.key,
        scope,
        field,
        imageOnly,
        choose
    })} embedded shop={tab.kind === 'gshop'} visible={active} onOpen={onOpen} onBack={() => {
    }} requestedIde={request} onDirty={dirty} onSaved={onSaved}/>;
}
