import { describe, expect, test } from 'bun:test';
import { buildFocusModel, buildMapModel, buildVicinityModel, describeLocation, formatAge, formatClock, formatDuration, formatNumber, totalLevel } from './public/view-model.js';

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

    test('projects a bounded, prioritized vicinity around Momobot', () => {
        const vicinity = buildVicinityModel({
            ...snapshot,
            nearby: {
                ...snapshot.nearby,
                npcs: [
                    { name: 'Goblin', x: 102, z: 199, distance: 2, combatLevel: 2, healthPercent: 50, inCombat: true },
                    { name: 'Guard', x: 120, z: 200, distance: 20, combatLevel: 21, inCombat: false }
                ]
            }
        }, 8);

        expect(vicinity.radius).toBe(8);
        expect(vicinity.total).toBe(4);
        expect(vicinity.summary).toBe('4 nearby · Goblin 2 tiles away');
        expect(vicinity.markers[0]).toEqual({
            kind: 'npc', label: 'Goblin', detail: 'Lvl 2', distance: 2,
            x: 60.5, y: 55.25, active: true, primary: true
        });
        expect(vicinity.markers.map(marker => marker.kind)).toEqual(['npc', 'player', 'item', 'loc']);
        expect(vicinity.markers.some(marker => marker.label === 'Guard')).toBe(false);
    });

    test('describes spectator context without exposing controller intent', () => {
        expect(describeLocation(2591, 3336, 0)).toEqual({ name: 'East Ardougne', detail: 'Ground floor · 2591, 3336' });
        expect(describeLocation(2680, 3417, 0)).toEqual({ name: 'Ranging Guild', detail: 'Ground floor · 2680, 3417' });
        expect(describeLocation(2934, 3218, 0)).toEqual({ name: 'Rimmington', detail: 'Ground floor · 2934, 3218' });
        expect(describeLocation(3039, 9775, 0)).toEqual({ name: 'Underground', detail: '3039, 9775' });
        expect(formatDuration(3_661_000)).toBe('1h 1m');
        expect(buildFocusModel({
            activity: 'In dialogue',
            player: { worldX: 2591, worldZ: 3336, level: 0 },
            nearby: { npcs: [{ name: 'Elena', distance: 1 }] }
        })).toEqual({
            title: 'In dialogue',
            context: 'Near Elena · East Ardougne',
            location: 'East Ardougne',
            locationDetail: 'Ground floor · 2591, 3336'
        });
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
