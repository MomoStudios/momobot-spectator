import puppeteer from 'puppeteer';

const url = process.env.SPECTATOR_URL || 'http://127.0.0.1:3210/';
const output = process.env.SPECTATOR_SCREENSHOT || '/home/moltbot/clawd/media/generated/momobot-dashboard.png';
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error instanceof Error ? error.message : String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const response = await page.goto(url, { waitUntil: 'networkidle0', timeout: 30_000 });
    await page.waitForFunction(() => document.querySelector('#player-name')?.textContent === 'Momobot', { timeout: 15_000 });

    // Live Client is the default scene.
    await page.waitForFunction(() => document.querySelector('#view-client')?.getAttribute('aria-selected') === 'true', { timeout: 10_000 });
    await page.waitForFunction(() => document.querySelector('#client-loading')?.classList.contains('hidden'), { timeout: 30_000 });
    await page.waitForFunction(() => /Live client · [1-9]/.test(document.querySelector('#map-status')?.textContent || ''), { timeout: 15_000 });
    await page.waitForFunction(() => document.querySelector('#feed-messages')?.getAttribute('aria-selected') === 'true', { timeout: 10_000 });

    // Game Feed defaults to messages, supports pointer switching, and implements keyboard tab navigation.
    await page.click('#feed-chat');
    const chatTabSnapshot = await page.evaluate(() => ({
        selected: document.querySelector('#feed-chat')?.getAttribute('aria-selected'),
        messagesHidden: (document.querySelector('#feed-messages-panel') as HTMLElement | null)?.hidden,
        chatHidden: (document.querySelector('#feed-chat-panel') as HTMLElement | null)?.hidden,
        gameSources: [...document.querySelectorAll('#game-messages .message-source')].map(node => node.textContent),
        chatSources: [...document.querySelectorAll('#chat-messages .message-source')].map(node => node.textContent),
        chatTimes: [...document.querySelectorAll('#chat-messages .message-time')].map(node => node.textContent),
        tabLabels: [...document.querySelectorAll('.feed-tab')].map(node => node.textContent)
    }));
    await page.focus('#feed-chat');
    await page.keyboard.press('ArrowLeft');
    const feedSnapshot = await page.evaluate(() => ({
        selected: document.querySelector('#feed-messages')?.getAttribute('aria-selected'),
        activeElement: document.activeElement?.id,
        messagesHidden: (document.querySelector('#feed-messages-panel') as HTMLElement | null)?.hidden,
        chatHidden: (document.querySelector('#feed-chat-panel') as HTMLElement | null)?.hidden,
        tabCount: document.querySelectorAll('.feed-tab').length,
        gameRowCount: document.querySelectorAll('#game-messages .message-row').length,
        gameSources: [...document.querySelectorAll('#game-messages .message-source')].map(node => node.textContent),
        gameTimes: [...document.querySelectorAll('#game-messages .message-time')].map(node => node.textContent)
    }));
    const clientSnapshot = await page.evaluate(() => {
        const canvas = document.querySelector('#client-stream') as HTMLCanvasElement;
        const bounds = canvas.getBoundingClientRect();
        const containerBounds = document.querySelector('#client-scene')?.getBoundingClientRect();
        const toggleBounds = document.querySelector('.scene-tabs')?.getBoundingClientRect();
        const scenePanelBounds = document.querySelector('.map-panel')?.getBoundingClientRect();
        const sceneViewportBounds = document.querySelector('.map-wrap')?.getBoundingClientRect();
        const timelinePanelBounds = document.querySelector('.timeline-panel')?.getBoundingClientRect();
        const timeline = document.querySelector('#timeline') as HTMLElement | null;
        const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
        let colored = 0;
        if (pixels) for (let index = 0; index < pixels.length; index += 32) if (pixels[index] + pixels[index + 1] + pixels[index + 2] > 30) colored++;
        return {
            selected: document.querySelector('#view-client')?.getAttribute('aria-selected'),
            mapHidden: document.querySelector('#map-scene')?.classList.contains('hidden'),
            toggleX: toggleBounds?.x,
            scenePanelHeight: scenePanelBounds?.height,
            sceneViewportWidth: sceneViewportBounds?.width,
            sceneViewportHeight: sceneViewportBounds?.height,
            sceneViewportAspectRatio: sceneViewportBounds ? sceneViewportBounds.width / sceneViewportBounds.height : undefined,
            timelinePanelHeight: timelinePanelBounds?.height,
            timelineClientHeight: timeline?.clientHeight,
            timelineScrollHeight: timeline?.scrollHeight,
            timelineOverflowY: timeline ? getComputedStyle(timeline).overflowY : undefined,
            width: canvas.width,
            height: canvas.height,
            objectFit: getComputedStyle(canvas).objectFit,
            fullyVisible: Boolean(containerBounds && bounds.left >= containerBounds.left - 1 && bounds.right <= containerBounds.right + 1 && bounds.top >= containerBounds.top - 1 && bounds.bottom <= containerBounds.bottom + 1),
            sampledNonBlackRatio: pixels ? colored / (pixels.length / 32) : 0,
            status: document.querySelector('#map-status')?.textContent
        };
    });
    await page.screenshot({ path: output, fullPage: true });

    // Switching to the map must not move the segmented control.
    await page.click('#view-map');
    await page.waitForFunction(() => document.querySelector('#map-status')?.textContent?.includes('following Momobot'), { timeout: 30_000 });
    await page.waitForFunction(() => {
        const frame = document.querySelector('#native-map') as HTMLIFrameElement | null;
        const map = (frame?.contentWindow as any)?.spectatorMap;
        const player = map?.playerPositions?.[0];
        if (!map || !player) return false;
        const expectedX = player.x - map.mapOriginX;
        const expectedZ = map.mapOriginZ + map.mapHeight - map.remapZ(player.z);
        return Math.abs(map.focusX - expectedX) < 2 && Math.abs(map.focusZ - expectedZ) < 2;
    }, { timeout: 15_000 });
    const mapSnapshot = await page.evaluate(() => {
        const frame = document.querySelector('#native-map') as HTMLIFrameElement | null;
        const map = (frame?.contentWindow as any)?.spectatorMap;
        const mapPlayer = map?.playerPositions?.[0];
        const expectedX = mapPlayer ? mapPlayer.x - map.mapOriginX : NaN;
        const expectedZ = mapPlayer ? map.mapOriginZ + map.mapHeight - map.remapZ(mapPlayer.z) : NaN;
        return {
            title: document.title,
            player: document.querySelector('#player-name')?.textContent,
            connection: document.querySelector('#connection-label')?.textContent,
            activity: document.querySelector('#activity')?.textContent,
            cards: document.querySelectorAll('.panel').length,
            selected: document.querySelector('#view-map')?.getAttribute('aria-selected'),
            toggleX: document.querySelector('.scene-tabs')?.getBoundingClientRect().x,
            mapStatus: document.querySelector('#map-status')?.textContent,
            mapCanvasWidth: frame?.contentDocument?.querySelector('canvas')?.width ?? 0,
            mapZoom: map?.zoom,
            mapCentered: Boolean(mapPlayer && Math.abs(map.focusX - expectedX) < 2 && Math.abs(map.focusZ - expectedZ) < 2)
        };
    });

    await page.click('#view-client');
    await page.waitForFunction(() => document.querySelector('#view-client')?.getAttribute('aria-selected') === 'true' && document.querySelector('#client-loading')?.classList.contains('hidden'), { timeout: 30_000 });
    const clientRestored = await page.evaluate(() => !document.querySelector('#client-scene')?.classList.contains('hidden') && document.querySelector('#map-scene')?.classList.contains('hidden'));
    const toggleStayedPut = Math.abs((clientSnapshot.toggleX ?? -100) - (mapSnapshot.toggleX ?? 100)) < 1;
    console.log(JSON.stringify({ status: response?.status(), clientSnapshot, chatTabSnapshot, feedSnapshot, mapSnapshot, clientRestored, toggleStayedPut, errors, screenshot: output }, null, 2));
    const feedTabsWork = chatTabSnapshot.selected === 'true'
        && chatTabSnapshot.messagesHidden === true
        && chatTabSnapshot.chatHidden === false
        && feedSnapshot.selected === 'true'
        && feedSnapshot.activeElement === 'feed-messages'
        && feedSnapshot.messagesHidden === false
        && feedSnapshot.chatHidden === true
        && feedSnapshot.tabCount === 2
        && JSON.stringify(chatTabSnapshot.tabLabels) === JSON.stringify(['Messages', 'Chat'])
        && feedSnapshot.gameRowCount > 0
        && feedSnapshot.gameTimes.length === feedSnapshot.gameRowCount
        && feedSnapshot.gameTimes.every(time => /^\d{2}:\d{2}:\d{2}$/.test(time || ''))
        && chatTabSnapshot.chatTimes.length === chatTabSnapshot.chatSources.length
        && chatTabSnapshot.chatTimes.every(time => /^\d{2}:\d{2}:\d{2}$/.test(time || ''))
        && feedSnapshot.gameSources.every(source => source === 'Game');
    if (response?.status() !== 200 || clientSnapshot.selected !== 'true' || !clientSnapshot.mapHidden || clientSnapshot.width !== 765 || clientSnapshot.height !== 503 || clientSnapshot.objectFit !== 'contain' || !clientSnapshot.fullyVisible || clientSnapshot.sampledNonBlackRatio < .2 || Math.abs((clientSnapshot.sceneViewportAspectRatio ?? 0) - 765 / 503) > .01 || (clientSnapshot.scenePanelHeight ?? Infinity) > 800 || Math.abs((clientSnapshot.scenePanelHeight ?? 0) - (clientSnapshot.timelinePanelHeight ?? Infinity)) > 2 || clientSnapshot.timelineOverflowY !== 'auto' || !feedTabsWork || mapSnapshot.connection !== 'Online' || mapSnapshot.cards < 6 || mapSnapshot.selected !== 'true' || mapSnapshot.mapCanvasWidth < 600 || mapSnapshot.mapZoom !== 8 || !mapSnapshot.mapCentered || !clientRestored || !toggleStayedPut || errors.length) process.exitCode = 1;
} finally {
    await browser.close();
}
