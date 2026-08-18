import { describe, expect, test } from 'bun:test';
import { createObserverConfig, createRequestHandler, effectiveObserverConnection, loadAssets, parseEnvFile } from './server';

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
    test('includes required dashboard modules and authentic skill icons', async () => {
        const assets = await loadAssets();
        expect(String(assets['/scene-view.js']?.body)).toContain('streamSocketUrl');
        expect(String(assets['/feed-view.js']?.body)).toContain('normalizeFeedTab');
        expect(String(assets['/skill-icons.js']?.body)).toContain('skillIconIndex');
        const skillIcons = new Uint8Array(await new Response(assets['/skill-icons.png']?.body).arrayBuffer());
        expect(skillIcons.slice(0, 8)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
        const iconView = new DataView(skillIcons.buffer, skillIcons.byteOffset, skillIcons.byteLength);
        expect(iconView.getUint32(16)).toBe(25);
        expect(iconView.getUint32(20)).toBe(475);
        expect(skillIcons[25]).toBe(6);
        const html = String(assets['/']?.body);
        const app = String(assets['/app.js']?.body);
        const styles = String(assets['/styles.css']?.body);
        expect(app).toContain('renderGameFeed(null, false)');
        expect(app).toContain('latestPayload = offlinePayload');
        expect(app).toContain('visibleOperationalStatus');
        expect(app).toContain('payload.controllerStatus');
        expect(app).toContain('effectivePayloadConnection');
        expect(app).toContain('new AbortController()');
        expect(app).toContain('updateAttribute');
        expect(app).toContain("setText('now-checking-label'");
        expect(app).toContain("setText('now-checking-text'");
        expect(html).toContain('id="now-checking"');
        expect(html).toContain('id="now-checking-label"');
        expect(html).toContain('id="now-checking-text" aria-live="polite" aria-atomic="true"');
        expect(html).toContain('id="now-checking-age" aria-hidden="true"');
        expect(html).toContain('>NOW CHECKING<');
        expect(styles).toContain('.now-checking-bubble');
        expect(app).not.toContain('buildVicinityModel');
        expect(app).not.toContain('renderVicinity');
        expect(html).toContain('>Messages</button>');
        expect(html).toContain('>Chat</button>');
        expect(html).not.toContain('>Game Messages</button>');
        expect(html).not.toContain('>Game Chat</button>');
        expect(html).toContain('id="live-objective"');
        expect(html).toContain('>LIVE OBJECTIVE</div>');
        expect(html).not.toContain('id="current-focus"');
        expect(html).not.toContain('id="current-context"');
        expect(html).not.toContain('class="live-action"');
        expect(html).not.toContain('activity-orb');
        expect(app).not.toContain("setText('current-focus'");
        expect(app).not.toContain("setText('current-context'");
        expect(styles).not.toContain('.live-action');
        expect(styles).not.toContain('.activity-orb');
        expect(html).not.toContain('id="vicinity-field"');
        expect(html).not.toContain('id="vicinity-markers"');
        expect(html).not.toContain('id="vicinity-summary"');
        expect(html).toContain('id="session-xp"');
        expect(html).toContain('id="mission-progress"');
        expect(html).toContain('id="short-term-mission"');
        expect(html).toContain('id="mission-tasks"');
        expect(html).toContain('id="mission-updated"');
        expect(html).toContain('id="long-term-progress"');
        expect(html).not.toContain('>SHORT-TERM MISSION</div>');
        expect(html.indexOf('id="live-objective"')).toBeLessThan(html.indexOf('id="map-panel"'));
        expect(html).toContain('id="fullscreen-client"');
        expect(html).toContain('<details class="detail-panel');
        expect(html).not.toContain('Watching <span');
    });
});

describe('spectator observer configuration', () => {
    test('receives player chat so the sanitizer can publish only public types', () => {
        const config = createObserverConfig({ username: 'momobot', password: 'secret', gatewayUrl: 'wss://example.test/gateway' });
        expect(config.connectionMode).toBe('observe');
        expect(config.showChat).toBe(true);
    });

    test('uses the gateway state timestamp and retries without process restart storms', async () => {
        const source = await Bun.file(new URL('./server.ts', import.meta.url)).text();
        expect(source).toContain('sdk.getStateReceivedAt()');
        expect(source).toContain('observerWatchdog.transportRetryDue()');
        expect(source).not.toContain('exiting for managed restart');
    });
});

describe('effectiveObserverConnection', () => {
    test('never reports an old gateway replay as connected', () => {
        expect(effectiveObserverConnection('connected', { observedAt: 1_000 }, 20_000)).toBe('stale');
    });

    test('returns connected only for fresh authoritative state', () => {
        expect(effectiveObserverConnection('connected', { observedAt: 15_000 }, 20_000)).toBe('connected');
        expect(effectiveObserverConnection('disconnected', { observedAt: 20_000 }, 20_000)).toBe('disconnected');
    });
});

describe('spectator HTTP handler', () => {
    const payload = {
        connection: 'connected',
        state: { observedAt: Date.now(), player: { name: 'Momobot' } },
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

    test('accepts fresh connected observer state in health checks', async () => {
        expect((await handler(new Request('http://localhost/healthz'))).status).toBe(200);
    });

    test('rejects stale observer state from health checks', async () => {
        const staleHandler = createRequestHandler({
            getPayload: () => ({ connection: 'connected', state: { observedAt: Date.now() - 30_000 } }),
            assets: {}
        });
        expect((await staleHandler(new Request('http://localhost/healthz'))).status).toBe(503);
    });

    test('rejects writes and unknown routes', async () => {
        expect((await handler(new Request('http://localhost/api/state', { method: 'POST' }))).status).toBe(405);
        expect((await handler(new Request('http://localhost/nope'))).status).toBe(404);
    });
});
