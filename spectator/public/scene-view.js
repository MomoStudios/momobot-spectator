export function normalizeScene(value) {
    return value === 'map' ? 'map' : 'client';
}

export function streamSocketUrl(locationLike) {
    const localDevelopment = (locationLike.hostname === '127.0.0.1' || locationLike.hostname === 'localhost') && locationLike.port === '3210';
    if (localDevelopment) return `ws://${locationLike.hostname}:3211/ws`;
    const protocol = locationLike.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${locationLike.host}/client/ws`;
}
