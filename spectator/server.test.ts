import { describe, expect, test } from 'bun:test';
import { createObserverConfig, createRequestHandler, loadAssets, parseEnvFile } from './server';

describe('parseEnvFile', () => {
    test('parses bot configuration without treating comments as values', () => {
        expect(parseEnvFile('BOT_USERNAME=momobot\nPASSWORD="sword fish"\nSERVER=example.com # comment\n')).toEqual({
            BOT_USERNAME: 'momobot',
            PASSWORD: 'sword fish',
            SERVER: 'example.com'
        });
    });
});

describe('spectator static assets', () => {
    test('includes the overview scene and game-feed modules', async () => {
        const assets = await loadAssets();
        expect(String(assets['/scene-view.js']?.body)).toContain('streamSocketUrl');
        expect(String(assets['/feed-view.js']?.body)).toContain('normalizeFeedTab');
        const html = String(assets['/']?.body);
        expect(html).toContain('>Messages</button>');
        expect(html).toContain('>Chat</button>');
        expect(html).not.toContain('>Game Messages</button>');
        expect(html).not.toContain('>Game Chat</button>');
    });
});

describe('spectator observer configuration', () => {
    test('receives player chat so the sanitizer can publish only public types', () => {
        const config = createObserverConfig({ username: 'momobot', password: 'secret', gatewayUrl: 'wss://example.test/gateway' });
        expect(config.connectionMode).toBe('observe');
        expect(config.showChat).toBe(true);
    });
});

describe('spectator HTTP handler', () => {
    const payload = {
        connection: 'connected',
        state: { player: { name: 'Momobot' } },
        events: []
    };
    const handler = createRequestHandler({
        getPayload: () => payload,
        assets: {
            '/': { body: '<h1>Momobot</h1>', type: 'text/html; charset=utf-8' },
            '/app.js': { body: 'console.log("ok")', type: 'text/javascript; charset=utf-8' },
            '/native-map/': { body: '<canvas id="canvas"></canvas>', type: 'text/html; charset=utf-8', embeddable: true }
        }
    });

    test('serves the dashboard with restrictive browser headers', async () => {
        const response = await handler(new Request('http://localhost/'));
        expect(response.status).toBe(200);
        expect(await response.text()).toContain('Momobot');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
        expect(response.headers.get('content-security-policy')).toContain("frame-src 'self'");
    });

    test('allows only the native map page to be embedded by the dashboard', async () => {
        const response = await handler(new Request('http://localhost/native-map/'));
        expect(response.status).toBe(200);
        expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
        expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
        expect(response.headers.get('content-security-policy')).toContain("worker-src 'self' blob:");
    });

    test('serves live state as uncached JSON', async () => {
        const response = await handler(new Request('http://localhost/api/state'));
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await response.json()).toEqual(payload);
    });

    test('rejects writes and unknown routes', async () => {
        expect((await handler(new Request('http://localhost/api/state', { method: 'POST' }))).status).toBe(405);
        expect((await handler(new Request('http://localhost/nope'))).status).toBe(404);
    });
});
