import { MapView } from '/native-map/mapview.js';

MapView.shouldDrawHistory = false;
MapView.shouldDrawPlayers = true;
MapView.shouldDrawNpcs = false;
MapView.shouldDrawItems = false;

const canvas = document.getElementById('canvas');
const loading = document.getElementById('loading');
let map = null;
let latestPosition = null;

function applyFocus() {
    if (!map || !latestPosition) return;
    map.playerPositions = [latestPosition];
    const mapZ = map.remapZ(latestPosition.z);
    map.focusX = latestPosition.x - map.mapOriginX;
    map.focusZ = map.mapOriginZ + map.mapHeight - mapZ;
    map.redraw = true;
}

function focusOn(position) {
    latestPosition = {
        x: Number(position.x),
        z: Number(position.z),
        level: Number(position.level) || 0,
        name: String(position.name || 'Momobot')
    };
    applyFocus();
}

function markReady() {
    if (map?.worldmap) {
        loading?.classList.add('ready');
        window.parent.postMessage({ type: 'momobot-map-ready' }, window.location.origin);
        return;
    }
    window.setTimeout(markReady, 100);
}

function initializeMapWhenSized() {
    const width = Math.floor(canvas.clientWidth || window.innerWidth);
    const height = Math.floor(canvas.clientHeight || window.innerHeight);
    if (width < 1 || height < 1) {
        window.requestAnimationFrame(initializeMapWhenSized);
        return;
    }

    canvas.width = width;
    canvas.height = height;
    map = new MapView();
    map.zoom = 8;
    map.targetZoom = 8;
    map.fetchPlayerPositions = () => {
        if (latestPosition) map.playerPositions = [latestPosition];
    };
    window.spectatorMap = map;
    applyFocus();
    markReady();
}

window.addEventListener('message', event => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.type === 'momobot-focus' && event.data.position) focusOn(event.data.position);
});

initializeMapWhenSized();
