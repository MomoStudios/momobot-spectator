export type ObserverConnection = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export class ObserverWatchdog {
    #connection: ObserverConnection = 'disconnected';
    #transportUnhealthySince: number;
    #lastStateAt = 0;

    constructor(private readonly retryIntervalMs: number, startedAt: number = Date.now()) {
        if (!Number.isFinite(retryIntervalMs) || retryIntervalMs <= 0) throw new Error('Observer retry interval must be positive');
        this.#transportUnhealthySince = startedAt;
    }

    update(connection: ObserverConnection, now: number = Date.now()): void {
        if (connection === 'disconnected' && this.#connection !== 'disconnected') {
            this.#transportUnhealthySince = now;
        }
        this.#connection = connection;
    }

    heartbeat(authoritativeStateAt: number): void {
        this.#lastStateAt = Number.isFinite(authoritativeStateAt) ? authoritativeStateAt : 0;
    }

    stateStale(now: number = Date.now(), freshnessMs: number = 10_000): boolean {
        return this.#lastStateAt <= 0 || now - this.#lastStateAt >= freshnessMs;
    }

    transportRetryDue(now: number = Date.now()): boolean {
        return this.#connection === 'disconnected' && now - this.#transportUnhealthySince >= this.retryIntervalMs;
    }

    rearmTransport(now: number = Date.now()): void {
        this.#transportUnhealthySince = now;
    }
}
