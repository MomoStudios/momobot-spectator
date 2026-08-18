export function totalLevel(skills = []) {
    return skills.reduce((sum, skill) => sum + (Number(skill.baseLevel) || 0), 0);
}

export function formatNumber(value) {
    return new Intl.NumberFormat('en-US').format(Number(value) || 0);
}

export function formatAge(observedAt, now = Date.now()) {
    const seconds = Math.max(0, Math.floor((now - observedAt) / 1000));
    if (seconds < 2) return 'live';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ago`;
}

export function formatClock(value, locale, timeZone) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp)) return '—';
    const options = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    if (timeZone) options.timeZone = timeZone;
    return new Intl.DateTimeFormat(locale, options).format(new Date(timestamp));
}

export function formatDuration(durationMs) {
    const minutes = Math.max(0, Math.floor((Number(durationMs) || 0) / 60_000));
    if (minutes < 1) return '<1m';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function effectivePayloadConnection(payload, now = Date.now(), maxStateAgeMs = 10_000) {
    const connection = payload?.connection || 'disconnected';
    if (connection !== 'connected') return connection;
    const observedAt = Number(payload?.state?.observedAt);
    const age = now - observedAt;
    return Number.isFinite(observedAt) && age >= -5_000 && age < maxStateAgeMs ? 'connected' : 'stale';
}

export function updateTextContent(node, value) {
    if (!node) return false;
    const text = String(value);
    if (node.textContent === text) return false;
    node.textContent = text;
    return true;
}

export function visibleNowChecking(mission, connection, now = Date.now(), maxAgeMs = 120_000) {
    const status = mission?.nowChecking;
    const updatedAt = Date.parse(status?.updatedAt);
    const age = now - updatedAt;
    if (connection !== 'connected' || typeof status?.text !== 'string' || !Number.isFinite(updatedAt)) return null;
    return age >= -5_000 && age < maxAgeMs ? status : null;
}

const LOCATION_REGIONS = [
    { name: 'Ranging Guild', minX: 2640, maxX: 2720, minZ: 3390, maxZ: 3460 },
    { name: 'Rimmington', minX: 2900, maxX: 3005, minZ: 3150, maxZ: 3279 },
    { name: 'East Ardougne', minX: 2550, maxX: 2705, minZ: 3200, maxZ: 3405 },
    { name: 'West Ardougne', minX: 2450, maxX: 2549, minZ: 3200, maxZ: 3405 },
    { name: 'Lumbridge', minX: 3170, maxX: 3265, minZ: 3150, maxZ: 3310 },
    { name: 'Draynor Village', minX: 3060, maxX: 3169, minZ: 3190, maxZ: 3305 },
    { name: 'Falador', minX: 2930, maxX: 3065, minZ: 3280, maxZ: 3405 },
    { name: 'Varrock', minX: 3160, maxX: 3315, minZ: 3360, maxZ: 3525 },
    { name: 'Seers’ Village', minX: 2680, maxX: 2815, minZ: 3430, maxZ: 3525 },
    { name: 'Wilderness', minX: 2940, maxX: 3400, minZ: 3526, maxZ: 4000 }
];

export function describeLocation(worldX, worldZ, level = 0) {
    const x = Number(worldX);
    const z = Number(worldZ);
    if (z >= 6400) return { name: 'Underground', detail: `${x}, ${z}` };
    const region = LOCATION_REGIONS.find(candidate => x >= candidate.minX && x <= candidate.maxX && z >= candidate.minZ && z <= candidate.maxZ);
    const floor = Number(level) === 0 ? 'Ground floor' : `Floor ${Number(level)}`;
    return { name: region?.name || 'Gielinor', detail: `${floor} · ${x}, ${z}` };
}

export function buildFocusModel(snapshot) {
    const location = describeLocation(snapshot?.player?.worldX, snapshot?.player?.worldZ, snapshot?.player?.level);
    const nearestNpc = [...(snapshot?.nearby?.npcs || [])].sort((a, b) => a.distance - b.distance)[0];
    return {
        title: snapshot?.activity || 'Observer feed unavailable',
        context: nearestNpc ? `Near ${nearestNpc.name} · ${location.name}` : location.name,
        location: location.name,
        locationDetail: location.detail
    };
}

export function buildMapModel(snapshot) {
    if (!snapshot?.player || !snapshot?.nearby) return [];
    const { worldX, worldZ, level } = snapshot.player;
    const relative = (entry) => ({ dx: entry.x - worldX, dz: entry.z - worldZ });
    const entities = [];

    const seenLocs = new Set();
    for (const loc of snapshot.nearby.locs ?? []) {
        if (loc.level !== level) continue;
        const key = `${loc.name}:${loc.x}:${loc.z}`;
        if (seenLocs.has(key)) continue;
        seenLocs.add(key);
        entities.push({ kind: 'loc', label: loc.name, ...relative(loc) });
        if (entities.length >= 14) break;
    }
    for (const item of snapshot.nearby.groundItems ?? []) {
        entities.push({ kind: 'item', label: `${item.count} × ${item.name}`, ...relative(item) });
    }
    for (const npc of snapshot.nearby.npcs ?? []) {
        entities.push({
            kind: 'npc',
            label: `${npc.name}${npc.combatLevel ? ` (${npc.combatLevel})` : ''}`,
            ...relative(npc),
            healthPercent: npc.healthPercent
        });
    }
    for (const player of snapshot.nearby.players ?? []) {
        entities.push({
            kind: 'player',
            label: `${player.name}${player.combatLevel ? ` (${player.combatLevel})` : ''}`,
            ...relative(player)
        });
    }
    entities.push({ kind: 'self', label: 'Momobot', dx: 0, dz: 0 });
    return entities;
}
