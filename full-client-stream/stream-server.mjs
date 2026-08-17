import http from 'node:http';
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';
import { WebSocket, WebSocketServer } from 'ws';
import { RenderedClientWatchdog, captureIntervalMs, redactSecret, routeRequest } from './stream-core.ts';

const ROOT = new URL('.', import.meta.url);
const PORT = Number(process.env.STREAM_PORT || 3211);
const HOST = process.env.STREAM_HOST || '127.0.0.1';
const configuredBot = process.env.BOT_NAME || 'clawdscape';
if (!/^[a-z0-9]{1,12}$/i.test(configuredBot)) throw new Error('BOT_NAME must be 1-12 alphanumeric characters');
const envText = await readFile(new URL(`../../bots/${configuredBot}/bot.env`, ROOT), 'utf8');
const env = Object.fromEntries(envText.split(/\r?\n/).flatMap(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return [];
    const index = trimmed.indexOf('=');
    return [[trimmed.slice(0, index), trimmed.slice(index + 1)]];
}));
const username = env.BOT_USERNAME || configuredBot;
if (!env.PASSWORD) throw new Error('bot.env is missing PASSWORD');
const redact = value => redactSecret(value, env.PASSWORD);
if (username.toLowerCase() !== configuredBot.toLowerCase()) throw new Error('BOT_NAME does not match bot.env');
const origin = env.SERVER ? `https://${env.SERVER}` : 'http://localhost:8888';
const clientUrl = new URL('/bot', origin);
clientUrl.searchParams.set('bot', username);
clientUrl.searchParams.set('password', env.PASSWORD);

const displayName = username.charAt(0).toUpperCase() + username.slice(1);
const assets = {
    html: (await readFile(new URL('public/index.html', ROOT), 'utf8'))
        .replaceAll('{{BOT_NAME}}', displayName)
        .replaceAll('{{BOT_NAME_UPPER}}', displayName.toUpperCase())
        .replaceAll('{{BOT_INITIAL}}', displayName.charAt(0)),
    css: await readFile(new URL('public/styles.css', ROOT), 'utf8'),
    js: await readFile(new URL('public/app.js', ROOT), 'utf8')
};
const clients = new Set();
let browser;
let page;
let canvas;
let browserConnected = false;
let gameReady = false;
let latestFrame = null;
let latestFrameAt = 0;
let measuredFps = 0;
let running = true;
let frameTimes = [];
const CLIENT_HEALTH_POLL_MS = 2_000;
const clientWatchdog = new RenderedClientWatchdog(5);
let nextClientHealthProbeAt = 0;

const status = () => ({
    browserConnected,
    gameReady,
    frameAgeMs: latestFrameAt ? Date.now() - latestFrameAt : null,
    fps: measuredFps,
    viewers: clients.size
});

const SECURITY_HEADERS = {
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()'
};

const server = http.createServer((request, response) => {
    const routed = routeRequest(request.method || 'GET', request.url || '/', status(), assets);
    response.writeHead(routed.status, {
        ...SECURITY_HEADERS,
        'content-type': routed.contentType,
        'cache-control': routed.cacheControl,
        ...(routed.status === 405 ? { allow: 'GET, HEAD' } : {})
    });
    response.end(request.method === 'HEAD' ? undefined : routed.body);
});
const webSockets = new WebSocketServer({ noServer: true, perMessageDeflate: false });
server.on('upgrade', (request, socket, head) => {
    const path = new URL(request.url || '/', 'http://localhost').pathname;
    if (!path.endsWith('/ws')) return socket.destroy();
    webSockets.handleUpgrade(request, socket, head, ws => webSockets.emit('connection', ws, request));
});
webSockets.on('connection', socket => {
    clients.add(socket);
    if (latestFrame) socket.send(latestFrame, { binary: true });
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));
});

async function waitForRenderedWorld() {
    await page.waitForFunction(() => Boolean(window.gameCanvas || document.querySelector('canvas')), { timeout: 30_000 });
    await page.waitForFunction(async name => {
        try {
            const result = await fetch(`/status/${encodeURIComponent(name)}`).then(response => response.json());
            return result.status === 'active' && result.inGame === true;
        } catch { return false; }
    }, { timeout: 45_000, polling: 500 }, username);
    await page.waitForFunction(() => {
        const target = window.gameCanvas || document.querySelector('canvas');
        const context = target?.getContext('2d');
        if (!target || !context || target.width < 516 || target.height < 338) return false;
        const pixels = context.getImageData(4, 4, 512, 334).data;
        let colored = 0;
        let sampled = 0;
        for (let index = 0; index < pixels.length; index += 32) {
            sampled++;
            if (pixels[index] + pixels[index + 1] + pixels[index + 2] > 30) colored++;
        }
        return colored / sampled > 0.1;
    }, { timeout: 60_000, polling: 500 });
}

async function applySpectatorPrivacy() {
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Game canvas has no visible bounds');
    // Fresh clients start with private chat On. Two clicks select Off and
    // prevent ordinary private messages from being rendered into public pixels.
    const privateChatX = box.x + (184 / 765) * box.width;
    const privateChatY = box.y + (480 / 503) * box.height;
    await page.mouse.click(privateChatX, privateChatY);
    await new Promise(resolve => setTimeout(resolve, 200));
    await page.mouse.click(privateChatX, privateChatY);
    await new Promise(resolve => setTimeout(resolve, 300));
}

async function launchClient() {
    browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
        defaultViewport: { width: 900, height: 650, deviceScaleFactor: 1 }
    });
    browserConnected = true;
    page = await browser.newPage();
    page.on('pageerror', error => console.error('[full-client] page error:', redact(error)));
    page.on('console', message => {
        if (message.type() === 'error') console.error('[full-client] console:', redact(message.text()));
    });
    await page.goto(clientUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await waitForRenderedWorld();
    canvas = await page.$('canvas');
    if (!canvas) throw new Error('Game canvas missing');
    await applySpectatorPrivacy();
    gameReady = true;
    console.log(`[full-client] ${username} rendered and SDK-connected`);
}

async function captureLoop() {
    while (running) {
        const started = Date.now();
        if (started >= nextClientHealthProbeAt) {
            let inGame = false;
            try {
                inGame = await page.evaluate(() => Boolean(window.gameClient?.ingame));
            } catch (error) {
                console.error('[stream] rendered-client probe failed:', redact(error));
            }
            gameReady = inGame;
            nextClientHealthProbeAt = started + CLIENT_HEALTH_POLL_MS;
            if (clientWatchdog.record(inGame)) {
                throw new Error('Rendered client left the game; restarting browser service');
            }
        }
        if (gameReady && canvas) {
            try {
                const dataUrl = await page.evaluate(quality => {
                    const target = window.gameCanvas || document.querySelector('canvas');
                    if (!target) throw new Error('Game canvas missing');
                    return target.toDataURL('image/jpeg', quality);
                }, 0.72);
                const frame = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
                latestFrame = frame;
                latestFrameAt = Date.now();
                frameTimes.push(latestFrameAt);
                frameTimes = frameTimes.filter(time => latestFrameAt - time <= 5000);
                measuredFps = frameTimes.length > 1
                    ? Number(((frameTimes.length - 1) * 1000 / (frameTimes.at(-1) - frameTimes[0])).toFixed(1))
                    : 0;
                for (const socket of clients) {
                    if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < frame.length * 2) {
                        socket.send(frame, { binary: true });
                    }
                }
            } catch (error) {
                gameReady = false;
                console.error('[stream] capture failed:', redact(error));
                throw error;
            }
        }
        const delay = Math.max(0, captureIntervalMs(clients.size) - (Date.now() - started));
        await new Promise(resolve => setTimeout(resolve, delay));
    }
}

async function shutdown() {
    if (!running) return;
    running = false;
    for (const socket of clients) socket.close();
    await browser?.close();
    server.close();
}
process.on('SIGINT', () => shutdown().finally(() => process.exit(0)));
process.on('SIGTERM', () => shutdown().finally(() => process.exit(0)));

server.listen(PORT, HOST, async () => {
    console.log(`[stream] viewer listening on http://${HOST}:${PORT}`);
    try {
        await launchClient();
        await captureLoop();
    } catch (error) {
        console.error('[stream] fatal:', redact(error));
        await shutdown();
        process.exit(1);
    }
});
