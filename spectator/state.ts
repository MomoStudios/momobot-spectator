import type { BotWorldState, GameMessage, InventoryItem, SkillState } from '../sdk/types';

export interface PublicEvent {
    id: string;
    at: number;
    tick: number;
    kind: 'level' | 'xp' | 'inventory' | 'combat' | 'life' | 'status';
    text: string;
}

export interface PublicSnapshot {
    connected: boolean;
    observedAt: number;
    tick: number;
    revision: number;
    inGame: boolean;
    activity: string;
    player: {
        name: string;
        combatLevel: number;
        hp: number;
        maxHp: number;
        worldX: number;
        worldZ: number;
        level: number;
        runEnergy: number;
        inCombat: boolean;
        isDead: boolean;
        respawnCount: number;
    };
    skills: Array<{ name: string; level: number; baseLevel: number; experience: number }>;
    inventory: Array<{ slot: number; name: string; count: number }>;
    equipment: Array<{ slot: number; name: string; count: number }>;
    nearby: {
        npcs: Array<{ index: number; name: string; combatLevel: number; x: number; z: number; distance: number; hp: number | null; maxHp: number | null; healthPercent: number | null; inCombat: boolean; reachable?: boolean }>;
        players: Array<{ index: number; name: string; combatLevel: number; x: number; z: number; distance: number }>;
        locs: Array<{ name: string; x: number; z: number; level: number; distance: number; reachable?: boolean }>;
        groundItems: Array<{ name: string; count: number; x: number; z: number; distance: number; reachable?: boolean }>;
    };
    gameMessages: Array<{ type: number; text: string; sender: string; tick: number; at: number; fromSelf: boolean }>;
    chatMessages: Array<{ type: number; text: string; sender: string; tick: number; at: number; fromSelf: boolean }>;
    dialogs: Array<{ text: string[]; tick: number }>;
    dialog: { isOpen: boolean; isWaiting: boolean; options: Array<{ index?: number; text?: string }> };
    modalOpen: boolean;
    prayers: { prayerLevel: number; prayerPoints: number; activePrayers: number[] };
}

const GAME_TICK_MS = 300;
const GAME_MESSAGE_TYPES = new Set([0]);
const PUBLIC_CHAT_TYPES = new Set([1, 2]);
const isPublicSkill = (skill: SkillState): boolean => !/^Stat\d+$/i.test(skill.name);

function nearest<T extends { distance: number }>(items: T[] | undefined, limit: number): T[] {
    return [...(items ?? [])].sort((a, b) => a.distance - b.distance).slice(0, limit);
}

function cleanMessage(message: GameMessage, currentTick: number, observedAt: number) {
    return {
        type: message.type,
        text: message.text,
        sender: message.sender,
        tick: message.tick,
        at: observedAt - Math.max(0, currentTick - message.tick) * GAME_TICK_MS,
        fromSelf: message.fromSelf
    };
}

export function summarizeActivity(state: BotWorldState | null): string {
    const player = state?.player;
    if (!state?.inGame || !player) return 'Offline';
    if (player.isDead) return 'Respawning';
    if (player.combat?.inCombat) {
        const target = player.combat.targetType === 'npc'
            ? state.nearbyNpcs?.find(npc => npc.index === player.combat.targetIndex)
            : state.nearbyPlayers?.find(nearbyPlayer => nearbyPlayer.index === player.combat.targetIndex);
        return target ? `Fighting ${target.name}` : 'In combat';
    }
    if (state.dialog?.isOpen) return 'In dialogue';
    if (state.modalOpen) return 'Using an interface';
    if (player.animId >= 0) return 'Performing an action';
    return 'Exploring';
}

export function sanitizeState(state: BotWorldState, observedAt: number = Date.now()): PublicSnapshot {
    const player = state.player;
    if (!player) throw new Error('Cannot publish spectator state without a player');
    return {
        connected: true,
        observedAt,
        tick: state.tick,
        revision: state.revision ?? 0,
        inGame: state.inGame,
        activity: summarizeActivity(state),
        player: {
            name: player.name,
            combatLevel: player.combatLevel,
            hp: player.hp,
            maxHp: player.maxHp,
            worldX: player.worldX,
            worldZ: player.worldZ,
            level: player.level,
            runEnergy: player.runEnergy,
            inCombat: player.combat?.inCombat ?? false,
            isDead: player.isDead,
            respawnCount: player.respawnCount
        },
        skills: (state.skills ?? []).filter(isPublicSkill).map(skill => ({
            name: skill.name,
            level: skill.level,
            baseLevel: skill.baseLevel,
            experience: skill.experience
        })),
        inventory: (state.inventory ?? []).map(item => ({ slot: item.slot, name: item.name, count: item.count })),
        equipment: (state.equipment ?? []).map(item => ({ slot: item.slot, name: item.name, count: item.count })),
        nearby: {
            npcs: nearest(state.nearbyNpcs, 30).map(npc => ({
                index: npc.index,
                name: npc.name,
                combatLevel: npc.combatLevel,
                x: npc.x,
                z: npc.z,
                distance: npc.distance,
                hp: npc.hp,
                maxHp: npc.maxHp,
                healthPercent: npc.healthPercent,
                inCombat: npc.inCombat,
                reachable: npc.reachable
            })),
            players: nearest(state.nearbyPlayers, 20).map(nearbyPlayer => ({
                index: nearbyPlayer.index,
                name: nearbyPlayer.name,
                combatLevel: nearbyPlayer.combatLevel,
                x: nearbyPlayer.x,
                z: nearbyPlayer.z,
                distance: nearbyPlayer.distance
            })),
            locs: nearest(state.nearbyLocs, 40).map(loc => ({
                name: loc.name,
                x: loc.x,
                z: loc.z,
                level: loc.level,
                distance: loc.distance,
                reachable: loc.reachable
            })),
            groundItems: nearest(state.groundItems, 20).map(item => ({
                name: item.name,
                count: item.count,
                x: item.x,
                z: item.z,
                distance: item.distance,
                reachable: item.reachable
            }))
        },
        gameMessages: (state.gameMessages ?? []).filter(message => GAME_MESSAGE_TYPES.has(message.type)).slice(-30).map(message => cleanMessage(message, state.tick, observedAt)),
        chatMessages: (state.gameMessages ?? []).filter(message => PUBLIC_CHAT_TYPES.has(message.type)).slice(-30).map(message => cleanMessage(message, state.tick, observedAt)),
        dialogs: (state.recentDialogs ?? []).slice(-12).map(dialog => ({ text: dialog.text, tick: dialog.tick })),
        dialog: {
            isOpen: state.dialog?.isOpen ?? false,
            isWaiting: state.dialog?.isWaiting ?? false,
            options: (state.dialog?.options ?? []).map(option => ({ index: option.index, text: option.text }))
        },
        modalOpen: state.modalOpen,
        prayers: {
            prayerLevel: state.prayers?.prayerLevel ?? 0,
            prayerPoints: state.prayers?.prayerPoints ?? 0,
            activePrayers: (state.prayers?.activePrayers ?? [])
                .map((active, index) => active ? index : -1)
                .filter(index => index >= 0)
        }
    };
}

function skillMap(skills: SkillState[] | undefined): Map<string, SkillState> {
    return new Map((skills ?? []).map(skill => [skill.name, skill]));
}

function itemCounts(items: InventoryItem[] | undefined): Map<string, number> {
    const counts = new Map<string, number>();
    for (const item of items ?? []) counts.set(item.name, (counts.get(item.name) ?? 0) + item.count);
    return counts;
}

function event(at: number, tick: number, sequence: number, kind: PublicEvent['kind'], text: string): PublicEvent {
    return { id: `${tick}-${sequence}-${kind}`, at, tick, kind, text };
}

export function deriveEvents(previous: BotWorldState | null, next: BotWorldState, at: number = Date.now()): PublicEvent[] {
    const nextPlayer = next.player;
    if (!nextPlayer) return [];
    const previousPlayer = previous?.player;
    if (!previous || !previousPlayer) return [event(at, next.tick, 0, 'status', `${nextPlayer.name} connected`)];

    const events: PublicEvent[] = [];
    const previousSkills = skillMap(previous.skills);
    let sequence = 0;

    for (const skill of (next.skills ?? []).filter(isPublicSkill)) {
        const before = previousSkills.get(skill.name);
        if (!before) continue;
        if (skill.baseLevel > before.baseLevel) {
            events.push(event(at, next.tick, sequence++, 'level', `${skill.name} reached level ${skill.baseLevel}`));
        }
        if (skill.experience > before.experience) {
            events.push(event(at, next.tick, sequence++, 'xp', `Gained ${skill.experience - before.experience} ${skill.name} XP`));
        }
    }

    const beforeItems = itemCounts(previous.inventory);
    const afterItems = itemCounts(next.inventory);
    for (const [name, count] of afterItems) {
        const delta = count - (beforeItems.get(name) ?? 0);
        if (delta > 0) events.push(event(at, next.tick, sequence++, 'inventory', `Picked up ${delta} × ${name}`));
    }
    for (const [name, count] of beforeItems) {
        const delta = count - (afterItems.get(name) ?? 0);
        if (delta > 0) events.push(event(at, next.tick, sequence++, 'inventory', `Used or lost ${delta} × ${name}`));
    }

    if (!previousPlayer.combat?.inCombat && nextPlayer.combat?.inCombat) {
        const target = nextPlayer.combat.targetType === 'npc'
            ? next.nearbyNpcs?.find(npc => npc.index === nextPlayer.combat.targetIndex)
            : next.nearbyPlayers?.find(player => player.index === nextPlayer.combat.targetIndex);
        events.push(event(at, next.tick, sequence++, 'combat', target ? `Entered combat with ${target.name}` : 'Entered combat'));
    } else if (previousPlayer.combat?.inCombat && !nextPlayer.combat?.inCombat) {
        events.push(event(at, next.tick, sequence++, 'combat', 'Combat ended'));
    }

    if (!previousPlayer.isDead && nextPlayer.isDead) {
        events.push(event(at, next.tick, sequence++, 'life', 'Momobot was defeated'));
    } else if (previousPlayer.lifeId !== nextPlayer.lifeId && !nextPlayer.isDead) {
        events.push(event(at, next.tick, sequence++, 'life', 'Momobot respawned'));
    }

    return events;
}
