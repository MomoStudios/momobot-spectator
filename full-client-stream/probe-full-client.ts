import puppeteer from 'puppeteer';
import { readFile } from 'node:fs/promises';

function parseEnv(text: string): Record<string, string> {
    return Object.fromEntries(text.split(/\r?\n/).flatMap(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return [];
        const index = trimmed.indexOf('=');
        return [[trimmed.slice(0, index), trimmed.slice(index + 1)]];
    }));
}

const env = parseEnv(await readFile(new URL('../../bots/clawdscape/bot.env', import.meta.url), 'utf8'));
const username = env.BOT_USERNAME || 'clawdscape';
const origin = env.SERVER ? `https://${env.SERVER}` : 'http://localhost:8888';
const url = new URL('/bot', origin);
url.searchParams.set('bot', username);
url.searchParams.set('password', env.PASSWORD);

const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: 900, height: 650, deviceScaleFactor: 1 }
});

try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error instanceof Error ? error.message : String(error)));
    page.on('console', message => {
        const text = message.text().replace(env.PASSWORD, '[REDACTED]');
        if (message.type() === 'error') errors.push(text);
    });

    const response = await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForFunction(() => Boolean((window as any).gameCanvas || document.querySelector('canvas')), { timeout: 30_000 });
    await page.waitForFunction(async name => {
        try {
            const status = await fetch(`/status/${encodeURIComponent(name)}`).then(result => result.json());
            return status.status === 'active' && status.inGame === true;
        } catch { return false; }
    }, { timeout: 45_000, polling: 500 }, username);
    await page.waitForFunction(() => {
        const canvas = ((window as any).gameCanvas || document.querySelector('canvas')) as HTMLCanvasElement | null;
        const context = canvas?.getContext('2d');
        if (!canvas || !context || canvas.width < 516 || canvas.height < 338) return false;
        const pixels = context.getImageData(4, 4, 512, 334).data;
        let colored = 0;
        let sampled = 0;
        for (let index = 0; index < pixels.length; index += 32) {
            sampled++;
            if (pixels[index] + pixels[index + 1] + pixels[index + 2] > 30) colored++;
        }
        return colored / sampled > 0.1;
    }, { timeout: 60_000, polling: 500 });

    const canvas = await page.$('canvas');
    if (!canvas) throw new Error('Game canvas missing');
    const output = '/home/moltbot/clawd/media/generated/clawdscape-full-client.png';
    await canvas.screenshot({ path: output });
    const metrics = await page.evaluate(() => {
        const canvas = ((window as any).gameCanvas || document.querySelector('canvas')) as HTMLCanvasElement;
        const context = canvas.getContext('2d');
        const pixels = context?.getImageData(0, 0, canvas.width, canvas.height).data;
        let nonBlack = 0;
        if (pixels) {
            for (let index = 0; index < pixels.length; index += 4) {
                if (pixels[index] + pixels[index + 1] + pixels[index + 2] > 24) nonBlack++;
            }
        }
        return {
            width: canvas.width,
            height: canvas.height,
            nonBlackRatio: pixels ? nonBlack / (pixels.length / 4) : 0,
            dataUrlBytes: canvas.toDataURL('image/jpeg', 0.75).length
        };
    });
    console.log(JSON.stringify({ httpStatus: response?.status(), username, metrics, errors, screenshot: output }, null, 2));
    if (response?.status() !== 200 || metrics.nonBlackRatio < 0.1 || metrics.dataUrlBytes < 10_000 || errors.length) process.exitCode = 1;
} finally {
    await browser.close();
}
