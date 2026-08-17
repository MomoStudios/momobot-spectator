const FEED_TABS = ['messages', 'chat'];

export function normalizeFeedTab(value) {
    return FEED_TABS.includes(value) ? value : 'messages';
}

export function feedMessagesForConnection(messages = [], connected = false) {
    return connected ? [...messages].reverse() : [];
}

export function feedContentForConnection(state, connected = false) {
    const online = Boolean(connected && state);
    return {
        gameMessages: online ? state.gameMessages || [] : [],
        chatMessages: online ? state.chatMessages || [] : [],
        gameEmpty: online ? 'No recent game messages' : 'Observer offline — cached messages hidden',
        chatEmpty: online ? 'No recent public chat' : 'Observer offline — cached chat hidden'
    };
}

export function feedTabForKey(current, key) {
    const active = normalizeFeedTab(current);
    if (key === 'Home') return FEED_TABS[0];
    if (key === 'End') return FEED_TABS[FEED_TABS.length - 1];
    if (key !== 'ArrowLeft' && key !== 'ArrowRight') return active;
    const direction = key === 'ArrowRight' ? 1 : -1;
    const index = FEED_TABS.indexOf(active);
    return FEED_TABS[(index + direction + FEED_TABS.length) % FEED_TABS.length];
}
