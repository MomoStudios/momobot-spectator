import { describe, expect, test } from 'bun:test';
import { buildFocusModel, buildMapModel, describeLocation, effectivePayloadConnection, formatAge, formatClock, formatDuration, formatNumber, totalLevel, updateAttribute, updateTextContent, visibleNowChecking, visibleOperationalStatus } from './public/view-model.js';

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

    test('expires cached connection proof independently of network polling', () => {
        const payload = { connection: 'connected', state: { observedAt: 1_000 } };
        expect(effectivePayloadConnection(payload, 10_999)).toBe('connected');
        expect(effectivePayloadConnection(payload, 11_000)).toBe('stale');
        expect(effectivePayloadConnection({ ...payload, connection: 'disconnected' }, 1_000)).toBe('disconnected');
        expect(effectivePayloadConnection({ connection: 'connected', state: null }, 1_000)).toBe('stale');
        expect(effectivePayloadConnection({ connection: 'connected', state: { observedAt: 20_000 } }, 1_000)).toBe('stale');
    });

    test('does not rewrite unchanged live-region text or accessible status', () => {
        let value = 'Checking live combat.';
        let writes = 0;
        const attributes = new Map([['aria-label', 'NOW CHECKING: Checking live combat.']]);
        const node = {
            get textContent() { return value; },
            set textContent(next) { value = next; writes++; },
            getAttribute(name) { return attributes.get(name) ?? null; },
            setAttribute(name, next) { attributes.set(name, next); writes++; },
            removeAttribute(name) { attributes.delete(name); writes++; }
        };
        expect(updateTextContent(node, 'Checking live combat.')).toBe(false);
        expect(updateAttribute(node, 'aria-label', 'NOW CHECKING: Checking live combat.')).toBe(false);
        expect(writes).toBe(0);
        expect(updateTextContent(node, 'Checking the proof page.')).toBe(true);
        expect(updateAttribute(node, 'aria-label', 'NOW RUNNING: Checking the proof page.')).toBe(true);
        expect(writes).toBe(2);
        expect(value).toBe('Checking the proof page.');
        expect(updateAttribute(node, 'aria-label', null)).toBe(true);
        expect(attributes.has('aria-label')).toBe(false);
    });

    test('shows only fresh now-checking status from a live observer', () => {
        const now = Date.parse('2026-08-17T18:32:00.000Z');
        const mission = { nowChecking: { text: 'Checking live combat.', updatedAt: '2026-08-17T18:31:00.000Z' } };
        expect(visibleNowChecking(mission, 'connected', now)).toEqual(mission.nowChecking);
        expect(visibleNowChecking(mission, 'stale', now)).toBeNull();
        expect(visibleNowChecking(mission, 'connected', now + 60_000)).toBeNull();
        expect(visibleNowChecking({ nowChecking: { text: 'Future status', updatedAt: '2026-08-17T18:32:10.000Z' } }, 'connected', now)).toBeNull();
        expect(visibleNowChecking({ nowChecking: { text: 'Broken', updatedAt: 'invalid' } }, 'connected', now)).toBeNull();
    });

    test('prefers manual status and otherwise shows only a live controller fallback', () => {
        const now = Date.parse('2026-08-17T18:32:00.000Z');
        const mission = { nowChecking: { text: 'Checking Merlin dialogue.', updatedAt: '2026-08-17T18:31:30.000Z' } };
        const controllerStatus = { text: 'Running Holy Grail Start · Speak with Merlin', updatedAt: '2026-08-17T18:31:59.000Z' };
        expect(visibleOperationalStatus(mission, controllerStatus, 'connected', now)).toEqual({
            label: 'NOW CHECKING',
            ...mission.nowChecking
        });
        expect(visibleOperationalStatus({}, controllerStatus, 'connected', now)).toEqual({
            label: 'NOW RUNNING',
            ...controllerStatus
        });
        expect(visibleOperationalStatus({}, controllerStatus, 'connected', now + 10_000)).toBeNull();
        expect(visibleOperationalStatus({}, controllerStatus, 'stale', now)).toBeNull();
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
