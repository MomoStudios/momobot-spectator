import { afterEach, describe, expect, test } from 'bun:test';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { advancePublicMission, loadPublicMission, sanitizePublicMission, writePublicMission } from './mission';
import { parseMissionArguments, parseMissionCommand } from './set-public-mission';

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
    test('parses a one-command milestone advance without accepting replacement fields', () => {
        expect(parseMissionCommand(['--bot=momobot', '--advance'])).toEqual({ kind: 'advance', bot: 'momobot' });
        expect(() => parseMissionCommand(['--bot=momobot', '--advance', '--title=Wrong mode'])).toThrow('Invalid argument');
    });

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

describe('advancePublicMission', () => {
    test('completes the active task and activates the next pending task', () => {
        expect(advancePublicMission(validMission, '2026-08-16T08:00:00.000Z')).toEqual({
            ...validMission,
            updatedAt: '2026-08-16T08:00:00.000Z',
            tasks: [
                { label: 'Complete Avan’s perfect-gold branch', status: 'done' },
                { label: 'Cure the wizard and defeat Chronozon', status: 'active' },
                { label: 'Reassemble and return the family crest', status: 'pending' }
            ]
        });
    });

    test('finishes cleanly when the active task is last', () => {
        const final = advancePublicMission({
            ...validMission,
            tasks: validMission.tasks.map((task, index) => ({ ...task, status: index < 2 ? 'done' : 'active' }))
        }, '2026-08-16T08:05:00.000Z');
        expect(final.updatedAt).toBe('2026-08-16T08:05:00.000Z');
        expect(final.tasks.every(task => task.status === 'done')).toBe(true);
    });

    test('rejects missing or ambiguous active tasks', () => {
        expect(() => advancePublicMission({ ...validMission, tasks: validMission.tasks.map(task => ({ ...task, status: 'pending' })) })).toThrow('exactly one active task');
        expect(() => advancePublicMission({ ...validMission, tasks: validMission.tasks.map((task, index) => ({ ...task, status: index < 2 ? 'active' : 'pending' })) })).toThrow('exactly one active task');
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

    test('serializes concurrent CLI advances without losing a milestone', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'momobot-mission-cli-'));
        tempDirs.push(dir);
        const spectatorDir = join(dir, 'spectator');
        const botDir = join(dir, 'bots', 'momobot');
        await mkdir(spectatorDir, { recursive: true });
        await mkdir(botDir, { recursive: true });
        await Promise.all([
            copyFile(join(import.meta.dir, 'mission.ts'), join(spectatorDir, 'mission.ts')),
            copyFile(join(import.meta.dir, 'set-public-mission.ts'), join(spectatorDir, 'set-public-mission.ts'))
        ]);
        await writePublicMission(join(botDir, 'public-mission.json'), validMission);

        const runAdvance = async () => {
            const child = Bun.spawn([
                process.execPath,
                join(spectatorDir, 'set-public-mission.ts'),
                '--bot=momobot',
                '--advance'
            ], {
                env: {
                    ...process.env,
                    MOMOBOT_PUBLIC_MISSION_LOCK_HELD: join(botDir, 'public-mission.json.lock')
                },
                stdout: 'pipe',
                stderr: 'pipe'
            });
            const exitCode = await child.exited;
            return {
                exitCode,
                stdout: await new Response(child.stdout).text(),
                stderr: await new Response(child.stderr).text()
            };
        };
        const results = await Promise.all([runAdvance(), runAdvance()]);
        expect(results).toEqual(results.map(result => ({ ...result, exitCode: 0, stderr: '' })));
        expect((await loadPublicMission(join(botDir, 'public-mission.json')))?.tasks).toEqual([
            { label: 'Complete Avan’s perfect-gold branch', status: 'done' },
            { label: 'Cure the wizard and defeat Chronozon', status: 'done' },
            { label: 'Reassemble and return the family crest', status: 'active' }
        ]);
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
