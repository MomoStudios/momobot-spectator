import { describe, expect, test } from 'bun:test';
import { buildMapModel, formatAge, formatClock, formatNumber, totalLevel } from './public/view-model.js';

const snapshot = {
    player: { worldX: 100, worldZ: 200, level: 1 },
    nearby: {
        npcs: [{ name: 'Goblin', x: 102, z: 199, combatLevel: 2, healthPercent: 50 }],
        players: [{ name: 'Scout', x: 98, z: 201, combatLevel: 3 }],
        locs: [{ name: 'Door', x: 101, z: 200, level: 1 }],
        groundItems: [{ name: 'Coins', x: 100, z: 202, count: 4 }]
    }
};

describe('dashboard view model', () => {
    test('builds map entities relative to the player', () => {
        expect(buildMapModel(snapshot)).toEqual([
            { kind: 'loc', label: 'Door', dx: 1, dz: 0 },
            { kind: 'item', label: '4 × Coins', dx: 0, dz: 2 },
            { kind: 'npc', label: 'Goblin (2)', dx: 2, dz: -1, healthPercent: 50 },
            { kind: 'player', label: 'Scout (3)', dx: -2, dz: 1 },
            { kind: 'self', label: 'Momobot', dx: 0, dz: 0 }
        ]);
    });

    test('formats dashboard metrics', () => {
        expect(totalLevel([{ baseLevel: 3 }, { baseLevel: 7 }])).toBe(10);
        expect(formatNumber(1234567)).toBe('1,234,567');
        expect(formatAge(10_000, 10_200)).toBe('live');
        expect(formatAge(10_000, 14_900)).toBe('4s ago');
        expect(formatAge(10_000, 75_000)).toBe('1m ago');
        expect(formatClock(Date.UTC(2026, 0, 2, 13, 5, 9), 'en-GB', 'UTC')).toBe('13:05:09');
        expect(formatClock(Number.NaN)).toBe('—');
    });
});
