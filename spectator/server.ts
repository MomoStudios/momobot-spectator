import { BotSDK, deriveGatewayUrl } from '../sdk/index';
import type { BotWorldState, ConnectionState, SDKConfig } from '../sdk/types';
import { deriveEvents, deriveSessionProgress, sanitizeState, type PublicEvent, type PublicSnapshot } from './state';

interface Asset {
    body: BodyInit;
    type: string;
    embeddable?: boolean;
}

interface HandlerOptions {
    getPayload: () => unknown;
    assets: Record<string, Asset>;
}

const SECURITY_HEADERS: Record<string, string> = {
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()'
};

const EMBEDDABLE_SECURITY_HEADERS: Record<string, string> = {
    ...SECURITY_HEADERS,
    'content-security-policy': "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
    'x-frame-options': 'SAMEORIGIN'
};

export function parseEnvFile(text: string): Record<string, string> {
    const values: Record<string, string> = {};
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const separator = line.indexOf('=');
        if (separator < 1) continue;
        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        } else {
            value = value.replace(/\s+#.*$/, '').trim();
        }
        values[key] = value;
    }
    return values;
}

function responseHeaders(type: string, cacheControl: string, embeddable: boolean = false): Headers {
    return new Headers({
        ...(embeddable ? EMBEDDABLE_SECURITY_HEADERS : SECURITY_HEADERS),
        'content-type': type,
        'cache-control': cacheControl
    });
}

export function createRequestHandler(options: HandlerOptions): (request: Request) => Promise<Response> {
    return async (request: Request): Promise<Response> => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            return new Response('Method not allowed', {
                status: 405,
                headers: { ...SECURITY_HEADERS, allow: 'GET, HEAD' }
            });
        }

        const url = new URL(request.url);
        if (url.pathname === '/healthz') {
            const payload = options.getPayload() as { connection?: string; state?: unknown };
            const healthy = payload.connection === 'connected' && Boolean(payload.state);
            return new Response(request.method === 'HEAD' ? null : JSON.stringify({ ok: healthy }), {
                status: healthy ? 200 : 503,
                headers: responseHeaders('application/json; charset=utf-8', 'no-store')
            });
        }

        if (url.pathname === '/api/state') {
            return new Response(request.method === 'HEAD' ? null : JSON.stringify(options.getPayload()), {
                headers: responseHeaders('application/json; charset=utf-8', 'no-store')
            });
        }

        const path = url.pathname === '/index.html' ? '/' : url.pathname;
        const asset = options.assets[path];
        if (!asset) {
            return new Response('Not found', { status: 404, headers: SECURITY_HEADERS });
        }
        return new Response(request.method === 'HEAD' ? null : asset.body, {
            headers: responseHeaders(asset.type, path === '/' ? 'no-cache' : 'public, max-age=300', asset.embeddable)
        });
    };
}

export async function loadAssets(): Promise<Record<string, Asset>> {
    const files: Array<[string, string, string, boolean?]> = [
        ['/', 'index.html', 'text/html; charset=utf-8'],
        ['/styles.css', 'styles.css', 'text/css; charset=utf-8'],
        ['/app.js', 'app.js', 'text/javascript; charset=utf-8'],
        ['/view-model.js', 'view-model.js', 'text/javascript; charset=utf-8'],
        ['/scene-view.js', 'scene-view.js', 'text/javascript; charset=utf-8'],
        ['/feed-view.js', 'feed-view.js', 'text/javascript; charset=utf-8'],
        ['/favicon.svg', 'favicon.svg', 'image/svg+xml'],
        ['/native-map', 'native-map/index.html', 'text/html; charset=utf-8', true],
        ['/native-map/', 'native-map/index.html', 'text/html; charset=utf-8', true],
        ['/native-map/native-map.css', 'native-map/native-map.css', 'text/css; charset=utf-8'],
        ['/native-map/native-map.js', 'native-map/native-map.js', 'text/javascript; charset=utf-8'],
        ['/native-map/mapview.js', 'native-map/mapview.js', 'text/javascript; charset=utf-8']
    ];
    const entries = await Promise.all(files.map(async ([route, file, type, embeddable]) => {
        const body = await Bun.file(`${import.meta.dir}/public/${file}`).text();
        return [route, { body, type, embeddable }] as const;
    }));
    const assets: Record<string, Asset> = Object.fromEntries(entries);
    assets['/worldmap.jag'] = {
        body: Bun.file(`${import.meta.dir}/public/worldmap.jag`),
        type: 'application/octet-stream'
    };
    return assets;
}

async function loadBotConfig(botName: string): Promise<{ username: string; password: string; gatewayUrl: string }> {
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(botName)) throw new Error('Invalid bot name');
    const envPath = `${import.meta.dir}/../bots/${botName}/bot.env`;
    if (!(await Bun.file(envPath).exists())) throw new Error(`Bot config not found: ${envPath}`);
    const env = parseEnvFile(await Bun.file(envPath).text());
    const username = env.BOT_USERNAME || botName;
    const password = env.PASSWORD;
    if (!password) throw new Error(`PASSWORD is missing from ${envPath}`);
    const gatewayUrl = env.GATEWAY_URL || deriveGatewayUrl(env.SERVER);
    return { username, password, gatewayUrl };
}

export function createObserverConfig(config: { username: string; password: string; gatewayUrl: string }): SDKConfig {
    return {
        botUsername: config.username,
        password: config.password,
        gatewayUrl: config.gatewayUrl,
        connectionMode: 'observe',
        autoLaunchBrowser: false,
        autoReconnect: true,
        showChat: true,
        readyTimeout: 0
    };
}

async function main(): Promise<void> {
    const args = Object.fromEntries(process.argv.slice(2).map(argument => {
        const [key, ...rest] = argument.replace(/^--/, '').split('=');
        return [key, rest.join('=') || 'true'];
    }));
    const botName = args.bot || 'momobot';
    const port = Number(args.port || process.env.SPECTATOR_PORT || 3210);
    const hostname = args.host || process.env.SPECTATOR_HOST || '127.0.0.1';
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port: ${port}`);

    const config = await loadBotConfig(botName);
    const sdk = new BotSDK(createObserverConfig(config));

    let connection: ConnectionState = 'connecting';
    let previous: BotWorldState | null = null;
    let sessionBaseline: BotWorldState | null = null;
    let sessionStartedAt = 0;
    let state: PublicSnapshot | null = null;
    let events: PublicEvent[] = [];

    sdk.onConnectionStateChange(next => { connection = next; });
    sdk.onStateUpdate(next => {
        if (!next.player) return;
        const now = Date.now();
        if (!sessionBaseline) {
            sessionBaseline = structuredClone(next);
            sessionStartedAt = now;
        }
        const freshEvents = deriveEvents(previous, next, now);
        if (freshEvents.length) events = [...freshEvents, ...events].slice(0, 100);
        state = sanitizeState(next, now);
        previous = next;
    });

    const getPayload = () => ({
        connection,
        state,
        events,
        session: sessionBaseline && previous ? deriveSessionProgress(sessionBaseline, previous, sessionStartedAt) : null,
        serverTime: Date.now()
    });
    const assets = await loadAssets();
    const server = Bun.serve({ hostname, port, fetch: createRequestHandler({ getPayload, assets }) });
    console.log(`[spectator] Dashboard listening on http://${hostname}:${server.port}`);
    console.log(`[spectator] Connecting to ${config.username} in observe mode via ${config.gatewayUrl}`);

    sdk.connect()
        .then(() => console.log(`[spectator] Live state connected for ${config.username}`))
        .catch(error => console.error(`[spectator] Initial connection failed; automatic retries remain enabled: ${error instanceof Error ? error.message : String(error)}`));

    const shutdown = () => {
        sdk.disconnect();
        server.stop();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

if (import.meta.main) {
    main().catch(error => {
        console.error(`[spectator] Fatal: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    });
}
