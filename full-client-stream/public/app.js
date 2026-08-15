const canvas = document.getElementById('stream');
const context = canvas.getContext('2d', { alpha: false });
const loading = document.getElementById('loading');
const connection = document.getElementById('connection');
const dot = document.getElementById('dot');
const fpsLabel = document.getElementById('fps');
const resolution = document.getElementById('resolution');
let frames = 0;
let fpsStartedAt = performance.now();
let reconnectTimer;
let drawing = false;
let queuedFrame = null;

function websocketUrl() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const base = location.pathname.endsWith('/') ? location.pathname : `${location.pathname}/`;
    return `${protocol}//${location.host}${base}ws`;
}

async function drawFrame(data) {
    if (drawing) { queuedFrame = data; return; }
    drawing = true;
    try {
        const bitmap = await createImageBitmap(new Blob([data], { type: 'image/jpeg' }));
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            resolution.textContent = `${bitmap.width} × ${bitmap.height} · JPEG over WebSocket`;
        }
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        frames++;
        loading.classList.add('hidden');
    } finally {
        drawing = false;
        if (queuedFrame) {
            const next = queuedFrame;
            queuedFrame = null;
            drawFrame(next);
        }
    }
}

function connect() {
    clearTimeout(reconnectTimer);
    connection.textContent = 'Connecting';
    dot.classList.remove('online');
    const socket = new WebSocket(websocketUrl());
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('open', () => {
        connection.textContent = 'Live';
        dot.classList.add('online');
    });
    socket.addEventListener('message', event => {
        if (event.data instanceof ArrayBuffer) drawFrame(event.data);
    });
    socket.addEventListener('close', () => {
        connection.textContent = 'Reconnecting';
        dot.classList.remove('online');
        reconnectTimer = setTimeout(connect, 1500);
    });
    socket.addEventListener('error', () => socket.close());
}

setInterval(() => {
    const now = performance.now();
    const elapsed = (now - fpsStartedAt) / 1000;
    fpsLabel.textContent = `${(frames / Math.max(elapsed, .001)).toFixed(1)} FPS`;
    frames = 0;
    fpsStartedAt = now;
}, 2000);
connect();
