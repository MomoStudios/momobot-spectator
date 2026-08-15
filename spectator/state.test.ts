import { describe, expect, test } from 'bun:test';
import { deriveEvents, sanitizeState, summarizeActivity } from './state';

function baseState() {
    return {
        tick: 100,
        revision: 7,
        inGame: true,
        player: {
            name: 'Momobot', combatLevel: 12, hp: 10, maxHp: 14,
            worldX: 3222, worldZ: 3218, level: 0, runEnergy: 100,
            combat: { inCombat: false, targetIndex: -1, targetType: 'none' },
            isDead: false, respawnCount: 0
        },
        skills: [
            { name: 'Strength', level: 2, baseLevel: 2, experience: 120 },
            { name: 'Attack', level: 16, baseLevel: 16, experience: 4000 },
            { name: 'Stat18', level: 1, baseLevel: 1, experience: 0 }
        ],
        inventory: [{ slot: 0, id: 995, name: 'Coins', count: 10, optionsWithIndex: [{ text: 'Drop', opIndex: 4 }] }],
        equipment: [{ slot: 3, id: 1203, name: 'Iron dagger', count: 1, optionsWithIndex: [] }],
        nearbyNpcs: [{ kind: 'npc', id: 100, index: 9, name: 'Goblin', combatLevel: 2, x: 3223, z: 3218, distance: 1, hp: 5, maxHp: 7, healthPercent: 71, inCombat: false, targetIndex: -1, reachable: true, options: ['Attack'], optionsWithIndex: [] }],
        nearbyPlayers: [{ kind: 'player', index: 2, name: 'FriendBot', combatLevel: 8, x: 3225, z: 3218, distance: 3, reachable: true }],
        nearbyLocs: [{ id: 1, name: 'Door', x: 3221, z: 3218, level: 0, distance: 1, reachable: true, options: ['Open'], optionsWithIndex: [] }],
        groundItems: [{ id: 995, name: 'Coins', count: 3, x: 3224, z: 3218, distance: 2, reachable: true }],
        gameMessages: [
            { type: 0, text: 'You open the door.', sender: '', tick: 99, observationId: 3, fromSelf: false },
            { type: 2, text: 'hello', sender: 'FriendBot', tick: 98, observationId: 2, fromSelf: false },
            { type: 3, text: 'secret pm', sender: 'PrivateFriend', tick: 97, observationId: 1, fromSelf: false }
        ],
        recentDialogs: [{ interfaceId: 10, text: ['Hello there'], tick: 99, observationId: 4 }],
        dialog: { isOpen: false, isWaiting: false, options: [] },
        modalOpen: false,
        prayers: { prayerLevel: 1, prayerPoints: 1, activePrayers: [] },
        password: 'must-never-leak'
    } as any;
}

describe('sanitizeState', () => {
    test('publishes a bounded read-only snapshot and removes private chat', () => {
        const publicState = sanitizeState(baseState(), 123456);

        expect(publicState.connected).toBe(true);
        expect(publicState.observedAt).toBe(123456);
        expect(publicState.player.name).toBe('Momobot');
        expect(publicState.skills.map(skill => skill.name)).not.toContain('Stat18');
        expect(publicState.inventory[0]).toEqual({ slot: 0, name: 'Coins', count: 10 });
        expect(publicState.nearby.npcs[0].name).toBe('Goblin');
        expect(publicState.gameMessages.map(message => ({ text: message.text, at: message.at }))).toEqual([
            { text: 'You open the door.', at: 123156 }
        ]);
        expect(publicState.chatMessages.map(message => ({ text: message.text, at: message.at }))).toEqual([
            { text: 'hello', at: 122856 }
        ]);
        expect(JSON.stringify(publicState)).not.toContain('secret pm');
        expect(JSON.stringify(publicState)).not.toContain('must-never-leak');
        expect(JSON.stringify(publicState)).not.toContain('optionsWithIndex');
    });
});

describe('deriveEvents', () => {
    test('reports meaningful progress without emitting movement noise', () => {
        const previous = baseState();
        const next = baseState();
        next.tick = 101;
        next.player.worldX = 3223;
        next.skills[0] = { name: 'Strength', level: 3, baseLevel: 3, experience: 250 };
        next.inventory[0].count = 35;
        next.player.combat = { inCombat: true, targetIndex: 9, targetType: 'npc' };
        next.nearbyNpcs[0].inCombat = true;

        expect(deriveEvents(previous, next, 123456).map(event => event.text)).toEqual([
            'Strength reached level 3',
            'Gained 130 Strength XP',
            'Picked up 25 × Coins',
            'Entered combat with Goblin'
        ]);
    });
});

describe('summarizeActivity', () => {
    test('identifies the current combat target', () => {
        const state = baseState();
        state.player.combat = { inCombat: true, targetIndex: 9, targetType: 'npc' };
        expect(summarizeActivity(state)).toBe('Fighting Goblin');
    });
});
