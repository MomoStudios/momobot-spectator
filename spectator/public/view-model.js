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
