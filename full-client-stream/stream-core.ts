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

export function captureIntervalMs(viewers: number): number {
    return viewers > 0 ? 125 : 1000;
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
