import { describe, expect, test } from 'bun:test';
import { feedTabForKey, normalizeFeedTab } from './public/feed-view.js';

describe('normalizeFeedTab', () => {
    test('defaults unknown feed tabs to game messages', () => {
        expect(normalizeFeedTab()).toBe('messages');
        expect(normalizeFeedTab('unknown')).toBe('messages');
        expect(normalizeFeedTab('chat')).toBe('chat');
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
