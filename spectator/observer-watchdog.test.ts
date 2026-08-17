import { describe, expect, test } from 'bun:test';
import { ObserverWatchdog } from './observer-watchdog';

describe('ObserverWatchdog', () => {
    test('requests a bounded reconnect after a sustained transport outage', () => {
        const watchdog = new ObserverWatchdog(60_000, 1_000);
        expect(watchdog.transportRetryDue(60_999)).toBe(false);
        expect(watchdog.transportRetryDue(61_000)).toBe(true);
        watchdog.rearmTransport(61_000);
        expect(watchdog.transportRetryDue(120_999)).toBe(false);
        expect(watchdog.transportRetryDue(121_000)).toBe(true);
    });

    test('a connected transport starts a new outage window only after disconnect', () => {
        const watchdog = new ObserverWatchdog(60_000, 1_000);
        watchdog.update('connected', 30_000);
        watchdog.heartbeat(30_000);
        watchdog.update('disconnected', 40_000);
        expect(watchdog.transportRetryDue(99_999)).toBe(false);
        expect(watchdog.transportRetryDue(100_000)).toBe(true);
    });

    test('cached replay remains stale and never triggers a transport restart loop', () => {
        const watchdog = new ObserverWatchdog(60_000, 1_000);
        watchdog.update('connected', 2_000);
        watchdog.heartbeat(1_000);
        expect(watchdog.stateStale(11_000, 10_000)).toBe(true);
        expect(watchdog.transportRetryDue(1_000_000)).toBe(false);
        watchdog.update('connected', 1_000_000);
        expect(watchdog.stateStale(1_000_000, 10_000)).toBe(true);
    });

    test('a fresh state heartbeat clears stale status', () => {
        const watchdog = new ObserverWatchdog(60_000, 1_000);
        watchdog.update('connected', 2_000);
        watchdog.heartbeat(50_000);
        expect(watchdog.stateStale(59_999, 10_000)).toBe(false);
        expect(watchdog.stateStale(60_000, 10_000)).toBe(true);
    });
});
