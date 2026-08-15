import { describe, expect, test } from 'bun:test';
import { captureIntervalMs, routeRequest } from './stream-core';

const status = { browserConnected: true, gameReady: true, frameAgeMs: 40, fps: 7.8, viewers: 1 };
const assets = {
    html: '<title>Clawdscape Live</title>',
    css: 'body{background:black}',
    js: 'console.log("viewer")'
};

describe('stream request routing', () => {
    test('serves the same viewer under a Funnel path prefix', () => {
        expect(routeRequest('GET', '/client/', status, assets).status).toBe(200);
        expect(routeRequest('GET', '/client/app.js', status, assets).body).toContain('viewer');
        expect(routeRequest('GET', '/styles.css', status, assets).contentType).toContain('text/css');
    });

    test('reports readiness and rejects writes', () => {
        const health = routeRequest('GET', '/client/healthz', status, assets);
        expect(health.status).toBe(200);
        expect(JSON.parse(health.body)).toEqual(status);
        expect(routeRequest('POST', '/client/', status, assets).status).toBe(405);
        expect(routeRequest('GET', '/favicon.ico', status, assets).status).toBe(204);
        expect(routeRequest('GET', '/client/control', status, assets).status).toBe(404);
    });

    test('returns unavailable while the rendered game is not ready', () => {
        const health = routeRequest('GET', '/healthz', { ...status, gameReady: false }, assets);
        expect(health.status).toBe(503);
        expect(routeRequest('GET', '/healthz', { ...status, frameAgeMs: 5000 }, assets).status).toBe(503);
    });
});

describe('capture scheduling', () => {
    test('runs near 8 FPS with viewers and 1 FPS while idle', () => {
        expect(captureIntervalMs(2)).toBe(125);
        expect(captureIntervalMs(0)).toBe(1000);
    });
});
