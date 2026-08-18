import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readControllerStatus } from './controller-status';

const temporaryDirectories: string[] = [];
afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

const mission = {
    title: 'Holy Grail',
    objective: 'Recover the Grail',
    updatedAt: '2026-08-18T16:00:00.000Z',
    tasks: [
        { label: 'Reach Entrana and obtain the Holy Grail clue', status: 'active' },
        { label: 'Recover the Grail', status: 'pending' }
    ]
};

async function fixture(overrides: Record<string, unknown> = {}) {
    const root = await mkdtemp(join(tmpdir(), 'controller-status-test-'));
    temporaryDirectories.push(root);
    const procRoot = join(root, 'proc');
    const lockDir = join(root, 'locks');
    const pid = 4242;
    await mkdir(join(procRoot, String(pid)), { recursive: true });
    await mkdir(lockDir, { recursive: true });
    const fields = ['S', ...Array.from({ length: 18 }, () => '0'), '987654', '0'];
    await writeFile(join(procRoot, String(pid), 'stat'), `${pid} (bun) ${fields.join(' ')}\n`);
    await writeFile(join(lockDir, 'rs-sdk-controller-momobot.lock'), JSON.stringify({
        pid,
        token: 'kernel-owner-token',
        acquiredAt: '2026-08-18T16:05:00.000Z',
        processStartId: '987654',
        ...overrides
    }));
    await writeFile(join(lockDir, 'rs-sdk-controller-momobot.lock.guard'), '');
    return { procRoot, lockDir };
}

describe('readControllerStatus', () => {
    test('derives status only from a valid public mission while the matching kernel lock is held', async () => {
        const paths = await fixture();
        const status = await readControllerStatus({
            botName: 'momobot', mission, now: Date.parse('2026-08-18T16:07:00.000Z'),
            isGuardLocked: async () => true,
            ...paths
        });
        expect(status).toEqual({
            text: 'Running controller · Reach Entrana and obtain the Holy Grail clue',
            updatedAt: '2026-08-18T16:07:00.000Z'
        });
        expect(JSON.stringify(status)).not.toContain('kernel-owner-token');
    });

    test('fails closed when the guard is unlocked or process identity is stale', async () => {
        const paths = await fixture();
        expect(await readControllerStatus({ botName: 'momobot', mission, now: 1, isGuardLocked: async () => false, ...paths })).toBeNull();

        const stale = await fixture({ processStartId: 'different' });
        expect(await readControllerStatus({ botName: 'momobot', mission, now: 1, isGuardLocked: async () => true, ...stale })).toBeNull();
    });

    test('requires the complete public mission schema and stable process identity', async () => {
        const paths = await fixture();
        expect(await readControllerStatus({
            botName: 'momobot', mission: { tasks: [{ label: 'PRIVATE malformed mission', status: 'active' }] },
            now: 1, isGuardLocked: async () => true, ...paths
        })).toBeNull();

        let reads = 0;
        const readProcessStat = async () => {
            reads++;
            const startId = reads === 1 ? '987654' : 'changed';
            const fields = ['S', ...Array.from({ length: 18 }, () => '0'), startId, '0'];
            return `4242 (bun) ${fields.join(' ')}\n`;
        };
        expect(await readControllerStatus({
            botName: 'momobot', mission, now: 1, isGuardLocked: async () => true,
            readProcessStat, ...paths
        })).toBeNull();
    });
});
