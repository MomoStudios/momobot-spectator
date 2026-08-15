import puppeteer from 'puppeteer';

const url = process.env.STREAM_URL || 'http://127.0.0.1:3211/';
const output = '/home/moltbot/clawd/media/generated/full-client-stream-viewer.png';
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'], defaultViewport: { width: 1280, height: 1000 } });
try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error instanceof Error ? error.message : String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForFunction(() => document.querySelector('#loading')?.classList.contains('hidden'), { timeout: 30_000 });
    await page.waitForFunction(() => Number.parseFloat(document.querySelector('#fps')?.textContent || '0') >= 4, { timeout: 20_000, polling: 500 });
    const result = await page.evaluate(() => {
        const canvas = document.querySelector('#stream') as HTMLCanvasElement;
        const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
        let colored = 0;
        if (pixels) for (let i = 0; i < pixels.length; i += 32) if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 30) colored++;
        return {
            title: document.title,
            connection: document.querySelector('#connection')?.textContent,
            fps: Number.parseFloat(document.querySelector('#fps')?.textContent || '0'),
            width: canvas.width,
            height: canvas.height,
            sampledNonBlackRatio: pixels ? colored / (pixels.length / 32) : 0,
            interactiveControls: document.querySelectorAll('button,input,select,textarea').length
        };
    });
    await page.screenshot({ path: output, fullPage: true });
    console.log(JSON.stringify({ httpStatus: response?.status(), result, errors, screenshot: output }, null, 2));
    if (response?.status() !== 200 || result.connection !== 'Live' || result.fps < 4 || result.sampledNonBlackRatio < .2 || result.interactiveControls !== 0 || errors.length) process.exitCode = 1;
} finally {
    await browser.close();
}
