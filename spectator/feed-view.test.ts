import { describe, expect, test } from 'bun:test';
import { feedContentForConnection, feedMessagesForConnection, feedTabForKey, normalizeFeedTab } from './public/feed-view.js';

describe('normalizeFeedTab', () => {
    test('defaults unknown feed tabs to game messages', () => {
        expect(normalizeFeedTab()).toBe('messages');
        expect(normalizeFeedTab('unknown')).toBe('messages');
        expect(normalizeFeedTab('chat')).toBe('chat');
    });
});

describe('feedMessagesForConnection', () => {
    test('shows the complete bounded history newest-first while connected', () => {
        const messages = Array.from({ length: 25 }, (_, index) => ({ text: `line-${index}` }));
        expect(feedMessagesForConnection(messages, true).map(message => message.text)).toEqual(
            [...messages].reverse().map(message => message.text)
        );
    });

    test('hides cached rows while the observer is disconnected', () => {
        expect(feedMessagesForConnection([{ text: 'stale' }], false)).toEqual([]);
    });
});

describe('feedContentForConnection', () => {
    test('clears both cached feeds when state is absent after observer restart', () => {
        expect(feedContentForConnection(null, false)).toEqual({
            gameMessages: [],
            chatMessages: [],
            gameEmpty: 'Observer offline — cached messages hidden',
            chatEmpty: 'Observer offline — cached chat hidden'
        });
    });

    test('clears cached rows when a stale payload carries old state', () => {
        const state = {
            gameMessages: [{ type: 0, text: 'old system line', sender: '', tick: 1, at: 1, fromSelf: false }],
            chatMessages: [{ type: 2, text: 'old public line', sender: 'old', tick: 1, at: 1, fromSelf: false }]
        };
        const content = feedContentForConnection(state, false);
        expect(content.gameMessages).toEqual([]);
        expect(content.chatMessages).toEqual([]);
        expect(content.gameEmpty).toContain('cached messages hidden');
        expect(content.chatEmpty).toContain('cached chat hidden');
    });

    test('clears cached rows when a disconnected payload still carries old state', () => {
        const stale = { gameMessages: [{ text: 'old game' }], chatMessages: [{ text: 'old chat' }] };
        expect(feedContentForConnection(stale, false).gameMessages).toEqual([]);
        expect(feedContentForConnection(stale, false).chatMessages).toEqual([]);
    });
});

describe('feedTabForKey', () => {
    test('supports arrow, Home, and End tab navigation', () => {
        expect(feedTabForKey('messages', 'ArrowRight')).toBe('chat');
        expect(feedTabForKey('chat', 'ArrowLeft')).toBe('messages');
        expect(feedTabForKey('chat', 'Home')).toBe('messages');
        expect(feedTabForKey('messages', 'End')).toBe('chat');
        expect(feedTabForKey('chat', 'Enter')).toBe('chat');
    });
});
