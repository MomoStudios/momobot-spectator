import WebSocket from 'ws';

const url = process.env.STREAM_WS || 'ws://127.0.0.1:3211/ws';
const durationMs = Number(process.env.MEASURE_MS || 10000);
const socket = new WebSocket(url);
let frames = 0;
let bytes = 0;
let firstAt = 0;
let lastAt = 0;

socket.on('message', data => {
    const now = performance.now();
    if (!firstAt) firstAt = now;
    lastAt = now;
    frames++;
    bytes += data.length;
});
socket.on('open', () => setTimeout(() => socket.close(), durationMs));
socket.on('close', () => {
    const measuredMs = Math.max(1, lastAt - firstAt);
    console.log(JSON.stringify({
        url: new URL(url).origin,
        requestedSeconds: durationMs / 1000,
        measuredSeconds: Number((measuredMs / 1000).toFixed(2)),
        frames,
        fps: Number((((frames - 1) * 1000) / measuredMs).toFixed(2)),
        averageFrameBytes: Math.round(bytes / Math.max(frames, 1)),
        megabitsPerSecond: Number(((bytes * 8 / 1_000_000) / (durationMs / 1000)).toFixed(2))
    }, null, 2));
});
socket.on('error', error => { console.error(error.message); process.exitCode = 1; });
