import { buildFocusModel, formatAge, formatClock, formatDuration, formatNumber, totalLevel } from './view-model.js?v=4';
import { normalizeScene, streamSocketUrl } from './scene-view.js?v=2';
import { feedTabForKey, normalizeFeedTab } from './feed-view.js?v=1';

const $ = id => document.getElementById(id);
let latestPayload = null;
let polling = false;
let mapReady = false;
let followMap = true;
let sceneMode = 'client';
let feedMode = 'messages';
let nearbyEntityCount = 0;
let streamSocket = null;
let streamReconnectTimer = null;
let streamConnection = 'idle';
let streamDrawing = false;
let queuedStreamFrame = null;
let streamFrames = 0;
let streamFps = 0;
let streamFpsStartedAt = performance.now();

function setText(id, value) {
    const node = $(id);
    if (node) node.textContent = String(value);
}

function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function renderConnection(payload) {
    const connected = payload.connection === 'connected' && payload.state;
    $('connection-pill').classList.toggle('offline', !connected);
    $('status-dot').classList.toggle('offline', !connected);
    setText('connection-label', connected ? 'Online' : payload.connection || 'Offline');
    setText('state-age', payload.state ? formatAge(payload.state.observedAt) : 'waiting for state');
}

function renderVitals(state) {
    const { player, skills } = state;
    const focus = buildFocusModel(state);
    setText('current-focus', focus.title);
    setText('current-context', focus.context);
    setText('location', focus.location);
    setText('location-detail', focus.locationDetail);
    setText('combat-level', player.combatLevel);
    setText('total-level', totalLevel(skills));
    setText('skill-count', skills.length);
    setText('total-xp', formatNumber(skills.reduce((sum, skill) => sum + skill.experience, 0)));
    setText('hp-label', `${player.hp} / ${player.maxHp}`);
    $('hp-bar').max = Math.max(1, player.maxHp);
    $('hp-bar').value = player.hp;
    setText('energy-label', `${player.runEnergy}%`);
    $('energy-bar').value = player.runEnergy;
    setText('slot-count', `${state.inventory.length} / 28 slots`);
    setText('tick-label', `tick ${state.tick} · rev ${state.revision}`);
}

function renderSession(session, state) {
    const mastered = session?.skillsMastered ?? state.skills.filter(skill => skill.baseLevel >= 99).length;
    const skillCount = session?.skillCount ?? state.skills.length;
    setText('session-duration', formatDuration(session?.durationMs ?? 0));
    setText('session-xp', formatNumber(session?.xpGained ?? 0));
    setText('session-rate', formatNumber(session?.xpPerHour ?? 0));
    setText('session-levels', formatNumber(session?.levelsGained ?? 0));
    setText('session-leading', session?.leadingSkill ? `${session.leadingSkill.name} · +${formatNumber(session.leadingSkill.xpGained)} XP` : 'No gains yet');
    setText('mission-progress', `${mastered} / ${skillCount}`);
    $('mission-bar').max = Math.max(1, skillCount);
    $('mission-bar').value = mastered;
}

function renderSkills(skills) {
    const container = $('skills');
    clear(container);
    const sorted = [...skills].sort((a, b) => b.baseLevel - a.baseLevel || a.name.localeCompare(b.name));
    for (const skill of sorted) {
        const row = element('div', 'skill-row');
        const name = element('span', 'skill-name', skill.name);
        const xp = element('span', 'skill-xp mono', `${formatNumber(skill.experience)} XP`);
        const level = element('strong', 'skill-level', skill.baseLevel);
        row.append(name, xp, level);
        container.append(row);
    }
}

function renderItems(state) {
    const equipment = $('equipment');
    const inventory = $('inventory');
    clear(equipment);
    clear(inventory);
    if (!state.equipment.length) equipment.append(element('span', 'muted', 'Nothing equipped'));
    for (const item of state.equipment) equipment.append(itemChip(item, true));
    if (!state.inventory.length) inventory.append(element('span', 'muted', 'Inventory is empty'));
    for (const item of state.inventory) inventory.append(itemChip(item, false));
}

function itemChip(item, equipped) {
    const chip = element('div', `item-chip${equipped ? ' equipped' : ''}`);
    chip.append(element('span', 'item-gem', item.name.slice(0, 1).toUpperCase()));
    chip.append(element('span', 'item-name', item.name));
    if (item.count > 1) chip.append(element('span', 'item-count mono', `×${formatNumber(item.count)}`));
    return chip;
}

function renderTimeline(events) {
    const container = $('timeline');
    clear(container);
    if (!events.length) {
        container.append(element('div', 'empty-state', 'Waiting for meaningful progress…'));
        return;
    }
    for (const event of events.slice(0, 30)) {
        const row = element('div', `timeline-row kind-${event.kind}`);
        row.append(element('div', 'timeline-icon', event.kind === 'level' ? '↑' : event.kind === 'combat' ? '⚔' : event.kind === 'inventory' ? '◆' : event.kind === 'life' ? '✦' : '·'));
        const copy = element('div', 'timeline-copy');
        copy.append(element('div', 'timeline-text', event.text));
        copy.append(element('div', 'timeline-time mono', `${formatAge(event.at)} · tick ${event.tick}`));
        row.append(copy);
        container.append(row);
    }
}

function renderMessageList(containerId, messages, emptyCopy, playerChat = false) {
    const container = $(containerId);
    clear(container);
    const recent = [...messages].reverse().slice(0, 20);
    if (!recent.length) container.append(element('div', 'empty-state', emptyCopy));
    for (const message of recent) {
        const row = element('div', 'message-row');
        const source = playerChat ? (message.sender || (message.fromSelf ? 'Momobot' : 'Player')) : 'Game';
        const timestamp = element('time', 'message-time mono', formatClock(message.at));
        if (Number.isFinite(Number(message.at))) timestamp.dateTime = new Date(message.at).toISOString();
        row.append(element('span', `message-source${playerChat ? ' player-message' : ''}`, source));
        row.append(element('span', 'message-text', message.text));
        row.append(timestamp);
        container.append(row);
    }
}

function renderGameFeed(state) {
    renderMessageList('game-messages', state.gameMessages || [], 'No recent game messages');
    renderMessageList('chat-messages', state.chatMessages || [], 'No recent public chat', true);

    const dialogCard = $('dialog-card');
    clear(dialogCard);
    if (state.dialog.isOpen || state.dialogs.length) {
        const latest = state.dialogs[state.dialogs.length - 1];
        if (latest?.text?.length) {
            dialogCard.classList.remove('hidden');
            dialogCard.append(element('div', 'dialog-label', state.dialog.isOpen ? 'ACTIVE DIALOGUE' : 'RECENT DIALOGUE'));
            dialogCard.append(element('div', 'dialog-text', latest.text.join(' ')));
            if (state.dialog.options.length) {
                const options = element('div', 'dialog-options');
                for (const option of state.dialog.options) options.append(element('span', 'dialog-option', option.text || `Option ${option.index}`));
                dialogCard.append(options);
            }
        } else dialogCard.classList.add('hidden');
    } else dialogCard.classList.add('hidden');
}

function setFeedTab(mode, focus = false) {
    feedMode = normalizeFeedTab(mode);
    for (const name of ['messages', 'chat']) {
        const selected = feedMode === name;
        const tab = $(`feed-${name}`);
        const panel = $(`feed-${name}-panel`);
        tab.classList.toggle('active', selected);
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        panel.hidden = !selected;
        if (selected && focus) tab.focus();
    }
}

function renderNearby(state) {
    const npcContainer = $('nearby-npcs');
    const locContainer = $('nearby-locs');
    clear(npcContainer);
    clear(locContainer);
    const npcGroups = groupByName(state.nearby.npcs);
    for (const [name, entries] of npcGroups.slice(0, 8)) {
        const detail = entries[0].combatLevel ? `Lvl ${entries[0].combatLevel}` : `${entries[0].distance} tiles`;
        npcContainer.append(nearbyRow(name, entries.length, detail));
    }
    const locGroups = groupByName(state.nearby.locs);
    for (const [name, entries] of locGroups.slice(0, 8)) locContainer.append(nearbyRow(name, entries.length, `${entries[0].distance} tiles`));
    if (!npcGroups.length) npcContainer.append(element('div', 'muted', 'None in view'));
    if (!locGroups.length) locContainer.append(element('div', 'muted', 'None in view'));
    nearbyEntityCount = state.nearby.npcs.length + state.nearby.players.length + state.nearby.locs.length + state.nearby.groundItems.length;
    setText('detail-nearby-count', nearbyEntityCount);
    updateSceneCaption();
}

function groupByName(items) {
    const groups = new Map();
    for (const item of items) groups.set(item.name, [...(groups.get(item.name) || []), item]);
    return [...groups.entries()].sort((a, b) => a[1][0].distance - b[1][0].distance);
}

function nearbyRow(name, count, detail) {
    const row = element('div', 'nearby-row');
    const title = element('span', 'nearby-name', name);
    if (count > 1) title.append(element('span', 'nearby-multiple mono', ` ×${count}`));
    row.append(title, element('span', 'nearby-detail mono', detail));
    return row;
}

function updateSceneCaption() {
    if (sceneMode === 'client') {
        setText('nearby-count', 'Momobot rendered client');
        const status = streamConnection === 'live'
            ? `Live client · ${streamFps.toFixed(1)} FPS`
            : streamConnection === 'connecting'
                ? 'Connecting to rendered client…'
                : streamConnection === 'reconnecting'
                    ? 'Rendered client reconnecting…'
                    : 'Rendered client paused';
        setText('map-status', status);
        return;
    }
    setText('nearby-count', `${nearbyEntityCount} entities nearby`);
    setText('map-status', mapReady
        ? `Native 2004 map · ${followMap ? 'following Momobot' : 'free pan'}`
        : 'Rendering native game map…');
}

async function drawStreamFrame(data) {
    if (streamDrawing) {
        queuedStreamFrame = data;
        return;
    }
    streamDrawing = true;
    try {
        const bitmap = await createImageBitmap(new Blob([data], { type: 'image/jpeg' }));
        const canvas = $('client-stream');
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
        }
        canvas.getContext('2d', { alpha: false }).drawImage(bitmap, 0, 0);
        bitmap.close();
        streamFrames++;
        const elapsed = (performance.now() - streamFpsStartedAt) / 1000;
        if (elapsed >= 1) {
            streamFps = streamFrames / elapsed;
            streamFrames = 0;
            streamFpsStartedAt = performance.now();
            updateSceneCaption();
        }
        $('client-loading').classList.add('hidden');
    } finally {
        streamDrawing = false;
        if (queuedStreamFrame) {
            const next = queuedStreamFrame;
            queuedStreamFrame = null;
            drawStreamFrame(next);
        }
    }
}

function stopClientStream() {
    clearTimeout(streamReconnectTimer);
    streamReconnectTimer = null;
    const socket = streamSocket;
    streamSocket = null;
    if (socket) socket.close();
    streamConnection = 'idle';
    streamFps = 0;
    updateSceneCaption();
}

function startClientStream() {
    if (sceneMode !== 'client' || streamSocket?.readyState === WebSocket.OPEN || streamSocket?.readyState === WebSocket.CONNECTING) return;
    clearTimeout(streamReconnectTimer);
    $('client-loading').classList.remove('hidden');
    streamConnection = 'connecting';
    updateSceneCaption();
    const socket = new WebSocket(streamSocketUrl(window.location));
    streamSocket = socket;
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('open', () => {
        if (streamSocket !== socket) return socket.close();
        streamConnection = 'live';
        streamFrames = 0;
        streamFpsStartedAt = performance.now();
        updateSceneCaption();
    });
    socket.addEventListener('message', event => {
        if (event.data instanceof ArrayBuffer) drawStreamFrame(event.data);
    });
    socket.addEventListener('close', () => {
        if (streamSocket !== socket) return;
        streamSocket = null;
        if (sceneMode !== 'client') return;
        streamConnection = 'reconnecting';
        updateSceneCaption();
        streamReconnectTimer = setTimeout(startClientStream, 1500);
    });
    socket.addEventListener('error', () => socket.close());
}

function ensureMapLoaded() {
    const frame = $('native-map');
    const source = frame.dataset.src;
    if (!source) return;
    frame.src = source;
    delete frame.dataset.src;
}

function setScene(mode) {
    sceneMode = normalizeScene(mode);
    const clientActive = sceneMode === 'client';
    $('map-scene').classList.toggle('hidden', clientActive);
    $('client-scene').classList.toggle('hidden', !clientActive);
    $('client-scene').setAttribute('aria-hidden', String(!clientActive));
    $('map-actions').classList.toggle('hidden', clientActive);
    for (const [id, selected] of [['view-map', !clientActive], ['view-client', clientActive]]) {
        $(id).classList.toggle('active', selected);
        $(id).setAttribute('aria-selected', String(selected));
    }
    if (clientActive) startClientStream();
    else {
        ensureMapLoaded();
        stopClientStream();
        postMapPosition(latestPayload?.state);
    }
    updateSceneCaption();
}

function postMapPosition(state) {
    if (sceneMode !== 'map' || !mapReady || !followMap || !state?.player) return;
    $('native-map').contentWindow?.postMessage({
        type: 'momobot-focus',
        position: {
            x: state.player.worldX,
            z: state.player.worldZ,
            level: state.player.level,
            name: state.player.name
        }
    }, window.location.origin);
}

function updateMapMode() {
    const button = $('follow-map');
    button.classList.toggle('active', followMap);
    button.setAttribute('aria-pressed', String(followMap));
    updateSceneCaption();
}

function render(payload) {
    latestPayload = payload;
    renderConnection(payload);
    if (!payload.state) return;
    renderVitals(payload.state);
    renderSession(payload.session, payload.state);
    renderSkills(payload.state.skills);
    renderItems(payload.state);
    renderTimeline(payload.events || []);
    renderGameFeed(payload.state);
    renderNearby(payload.state);
    postMapPosition(payload.state);
}

async function poll() {
    if (polling) return;
    polling = true;
    try {
        const response = await fetch('/api/state', { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        render(await response.json());
    } catch (error) {
        renderConnection({ connection: 'disconnected', state: null });
        setText('current-focus', 'Observer feed unavailable');
        setText('current-context', 'The public state service is reconnecting');
    } finally {
        polling = false;
    }
}

window.addEventListener('message', event => {
    if (event.origin !== window.location.origin || event.data?.type !== 'momobot-map-ready') return;
    mapReady = true;
    updateMapMode();
    postMapPosition(latestPayload?.state);
});
$('follow-map').addEventListener('click', () => {
    followMap = !followMap;
    updateMapMode();
    postMapPosition(latestPayload?.state);
});
$('view-map').addEventListener('click', () => setScene('map'));
$('view-client').addEventListener('click', () => setScene('client'));
$('fullscreen-client').addEventListener('click', async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $('map-panel').requestFullscreen();
});
document.addEventListener('fullscreenchange', () => {
    setText('fullscreen-client', document.fullscreenElement ? 'Exit theater' : 'Theater');
});
for (const name of ['messages', 'chat']) {
    const tab = $(`feed-${name}`);
    tab.addEventListener('click', () => setFeedTab(name));
    tab.addEventListener('keydown', event => {
        const next = feedTabForKey(feedMode, event.key);
        if (next === feedMode && !['Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        setFeedTab(next, true);
    });
}
setInterval(() => {
    if (latestPayload) {
        renderConnection(latestPayload);
        renderTimeline(latestPayload.events || []);
    }
}, 1000);
setInterval(poll, 750);
setFeedTab('messages');
setScene('client');
poll();
