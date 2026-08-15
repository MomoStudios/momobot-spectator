import { describe, expect, test } from 'bun:test';
import { normalizeScene, streamSocketUrl } from './public/scene-view.js';

describe('overview scene switcher', () => {
    test('accepts explicit scenes and defaults to the live client', () => {
        expect(normalizeScene('client')).toBe('client');
        expect(normalizeScene('map')).toBe('map');
        expect(normalizeScene('anything-else')).toBe('client');
        expect(normalizeScene(undefined)).toBe('client');
    });

    test('uses the public Funnel client websocket path', () => {
        expect(streamSocketUrl({ protocol: 'https:', hostname: 'moltbot.story-nessie.ts.net', host: 'moltbot.story-nessie.ts.net', port: '' }))
            .toBe('wss://moltbot.story-nessie.ts.net/client/ws');
    });

    test('connects directly to the local stream service during development', () => {
        expect(streamSocketUrl({ protocol: 'http:', hostname: '127.0.0.1', host: '127.0.0.1:3210', port: '3210' }))
            .toBe('ws://127.0.0.1:3211/ws');
    });
});
