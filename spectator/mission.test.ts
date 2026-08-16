import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPublicMission, sanitizePublicMission, writePublicMission } from './mission';
import { parseMissionArguments } from './set-public-mission';

const tempDirs: string[] = [];
afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

const validMission = {
    title: 'Complete Family Crest',
    objective: 'Recover the remaining crest pieces and return the completed crest to Dimintheis.',
    updatedAt: '2026-08-15T18:30:00.000Z',
    tasks: [
        { label: 'Complete Avan’s perfect-gold branch', status: 'active' },
        { label: 'Cure the wizard and defeat Chronozon', status: 'pending' },
        { label: 'Reassemble and return the family crest', status: 'pending' }
    ]
};

describe('sanitizePublicMission', () => {
    test('publishes only bounded allowlisted mission fields', () => {
        const raw = {
            ...validMission,
            privateReasoning: 'never publish this',
            tasks: [
                ...validMission.tasks,
                { label: 'Choose the next dependency quest', status: 'pending', secret: 'hidden' },
                { label: 'fifth', status: 'done' },
                { label: 'sixth', status: 'done' },
                { label: 'seventh is dropped', status: 'pending' }
            ]
        };

        expect(sanitizePublicMission(raw)).toEqual({
            ...validMission,
            tasks: [
                ...validMission.tasks,
                { label: 'Choose the next dependency quest', status: 'pending' },
                { label: 'fifth', status: 'done' },
                { label: 'sixth', status: 'done' }
            ]
        });
    });

    test('rejects malformed or oversized public mission values', () => {
        expect(sanitizePublicMission({ ...validMission, title: '' })).toBeNull();
        expect(sanitizePublicMission({ ...validMission, objective: 'x'.repeat(241) })).toBeNull();
        expect(sanitizePublicMission({ ...validMission, tasks: [{ label: 'Nope', status: 'blocked' }] })).toBeNull();
        expect(sanitizePublicMission({ ...validMission, updatedAt: 'not-a-date' })).toBeNull();
    });
});

describe('public mission updater', () => {
    test('parses a bounded public mission from repeated task flags', () => {
        const parsed = parseMissionArguments([
            '--bot=momobot',
            '--title=Complete Family Crest',
            '--objective=Recover and return the family crest.',
            '--task=done:Complete Caleb’s branch',
            '--task=active:Complete Avan’s branch',
            '--task=pending:Defeat Chronozon',
            '--updated-at=2026-08-15T18:30:00.000Z'
        ]);
        expect(parsed).toEqual({
            bot: 'momobot',
            mission: {
                title: 'Complete Family Crest',
                objective: 'Recover and return the family crest.',
                updatedAt: '2026-08-15T18:30:00.000Z',
                tasks: [
                    { label: 'Complete Caleb’s branch', status: 'done' },
                    { label: 'Complete Avan’s branch', status: 'active' },
                    { label: 'Defeat Chronozon', status: 'pending' }
                ]
            }
        });
    });

    test('rejects unsafe bot names and invalid task statuses', () => {
        expect(() => parseMissionArguments(['--bot=../momobot', '--title=x', '--objective=y', '--task=active:z'])).toThrow('Invalid bot name');
        expect(() => parseMissionArguments(['--bot=momobot', '--title=x', '--objective=y', '--task=blocked:z'])).toThrow('Invalid public mission');
    });
});

describe('public mission file', () => {
    test('fails closed for missing or malformed files', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'momobot-mission-'));
        tempDirs.push(dir);
        expect(await loadPublicMission(join(dir, 'missing.json'))).toBeNull();
        const malformed = join(dir, 'malformed.json');
        await Bun.write(malformed, '{not json');
        expect(await loadPublicMission(malformed)).toBeNull();
    });

    test('writes an atomic sanitized mission readable by the spectator', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'momobot-mission-'));
        tempDirs.push(dir);
        const path = join(dir, 'public-mission.json');
        await writePublicMission(path, { ...validMission, ignored: 'private' });

        expect(await loadPublicMission(path)).toEqual(validMission);
        expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(validMission);
        expect((await stat(path)).mode & 0o777).toBe(0o644);
        expect((await Array.fromAsync(new Bun.Glob('.public-mission.json.*.tmp').scan({ cwd: dir }))).length).toBe(0);
    });
});
