export interface StreamStatus {
    browserConnected: boolean;
    gameReady: boolean;
    frameAgeMs: number | null;
    fps: number;
    viewers: number;
}

export interface StreamAssets {
    html: string;
    css: string;
    js: string;
}

export interface RoutedResponse {
    status: number;
    body: string;
    contentType: string;
    cacheControl: string;
}

export class RenderedClientWatchdog {
    private failures = 0;

    constructor(private readonly failureThreshold: number) {
        if (!Number.isInteger(failureThreshold) || failureThreshold < 1) {
            throw new Error('failureThreshold must be a positive integer');
        }
    }

    record(inGame: boolean): boolean {
        if (inGame) {
            this.failures = 0;
            return false;
        }
        this.failures++;
        return this.failures >= this.failureThreshold;
    }
}

export function captureIntervalMs(viewers: number): number {
    return viewers > 0 ? 125 : 1000;
}

export function redactSecret(value: unknown, secret: string): string {
    let text = value instanceof Error ? value.message : String(value);
    if (!secret) return text;
    const componentEncoded = encodeURIComponent(secret);
    const formEncoded = new URLSearchParams({ secret }).toString().slice('secret='.length);
    const variants = [...new Set([
        secret,
        componentEncoded,
        componentEncoded.toLowerCase(),
        formEncoded,
        formEncoded.toLowerCase()
    ])].filter(Boolean).sort((left, right) => right.length - left.length);
    for (const variant of variants) text = text.replaceAll(variant, '[REDACTED]');
    return text;
}

export function routeRequest(method: string, url: string, status: StreamStatus, assets: StreamAssets): RoutedResponse {
    if (method !== 'GET' && method !== 'HEAD') {
        return { status: 405, body: 'Method not allowed', contentType: 'text/plain; charset=utf-8', cacheControl: 'no-store' };
    }

    const path = new URL(url, 'http://localhost').pathname.replace(/\/+$/, '') || '/';
    if (path.endsWith('/healthz') || path === '/healthz') {
        const freshFrame = status.frameAgeMs !== null && status.frameAgeMs < 5000;
        return {
            status: status.browserConnected && status.gameReady && freshFrame ? 200 : 503,
            body: JSON.stringify(status),
            contentType: 'application/json; charset=utf-8',
            cacheControl: 'no-store'
        };
    }
    if (path === '/' || path.endsWith('/client')) {
        return { status: 200, body: assets.html, contentType: 'text/html; charset=utf-8', cacheControl: 'no-cache' };
    }
    if (path.endsWith('/app.js')) {
        return { status: 200, body: assets.js, contentType: 'text/javascript; charset=utf-8', cacheControl: 'no-cache' };
    }
    if (path.endsWith('/styles.css')) {
        return { status: 200, body: assets.css, contentType: 'text/css; charset=utf-8', cacheControl: 'no-cache' };
    }
    if (path.endsWith('/favicon.ico')) {
        return { status: 204, body: '', contentType: 'image/x-icon', cacheControl: 'public, max-age=86400' };
    }
    return { status: 404, body: 'Not found', contentType: 'text/plain; charset=utf-8', cacheControl: 'no-store' };
}
