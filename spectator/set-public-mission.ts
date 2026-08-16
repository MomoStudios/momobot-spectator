import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { advancePublicMission, loadPublicMission, sanitizePublicMission, writePublicMission, type PublicMission } from './mission';

interface ParsedMissionArguments {
    bot: string;
    mission: PublicMission;
}

export type ParsedMissionCommand =
    | { kind: 'replace'; bot: string; mission: PublicMission }
    | { kind: 'advance'; bot: string };

export function parseMissionCommand(arguments_: string[]): ParsedMissionCommand {
    const values = new Map<string, string>();
    const tasks: Array<{ label: string; status: string }> = [];
    let advance = false;
    for (const argument of arguments_) {
        if (argument === '--advance') {
            if (advance) throw new Error(`Invalid argument: ${argument}`);
            advance = true;
            continue;
        }
        const match = /^--([a-z-]+)=(.*)$/s.exec(argument);
        if (!match) throw new Error(`Invalid argument: ${argument}`);
        const [, key, value] = match;
        if (key === 'task') {
            const separator = value.indexOf(':');
            if (separator < 1) throw new Error('Invalid public mission');
            tasks.push({ status: value.slice(0, separator), label: value.slice(separator + 1) });
            continue;
        }
        if (!['bot', 'title', 'objective', 'updated-at'].includes(key) || values.has(key)) {
            throw new Error(`Invalid argument: ${argument}`);
        }
        values.set(key, value);
    }

    const bot = values.get('bot') || 'momobot';
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(bot)) throw new Error('Invalid bot name');
    if (advance) {
        if (tasks.length > 0 || [...values.keys()].some(key => key !== 'bot')) {
            throw new Error('Invalid argument: --advance cannot be combined with replacement fields');
        }
        return { kind: 'advance', bot };
    }

    const mission = sanitizePublicMission({
        title: values.get('title'),
        objective: values.get('objective'),
        updatedAt: values.get('updated-at') || new Date().toISOString(),
        tasks
    });
    if (!mission) throw new Error('Invalid public mission');
    return { kind: 'replace', bot, mission };
}

export function parseMissionArguments(arguments_: string[]): ParsedMissionArguments {
    const command = parseMissionCommand(arguments_);
    if (command.kind !== 'replace') throw new Error('Invalid public mission');
    return { bot: command.bot, mission: command.mission };
}

export async function applyMissionCommand(arguments_: string[]): Promise<void> {
    const command = parseMissionCommand(arguments_);
    const path = resolve(import.meta.dir, '..', 'bots', command.bot, 'public-mission.json');
    const mission = command.kind === 'advance'
        ? advancePublicMission(await loadPublicMission(path))
        : command.mission;
    await writePublicMission(path, mission);
    const active = mission.tasks.find(task => task.status === 'active');
    console.log(`[spectator] ${command.kind === 'advance' ? 'Advanced' : 'Updated'} public mission for ${command.bot}: ${mission.title}${active ? ` · ${active.label}` : ' · complete'}`);
}

export async function runMissionCommand(arguments_: string[]): Promise<number> {
    try {
        await applyMissionCommand(arguments_);
        return 0;
    } catch (error) {
        console.error(`[spectator] Mission update failed: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

async function main(): Promise<void> {
    const arguments_ = process.argv.slice(2);
    const command = parseMissionCommand(arguments_);
    const path = resolve(import.meta.dir, '..', 'bots', command.bot, 'public-mission.json');
    const lockPath = `${path}.lock`;
    await mkdir(dirname(path), { recursive: true, mode: 0o755 });
    const moduleUrl = pathToFileURL(import.meta.path).href;
    const workerSource = `const { runMissionCommand } = await import(${JSON.stringify(moduleUrl)}); process.exitCode = await runMissionCommand(${JSON.stringify(arguments_)});`;
    const child = Bun.spawn([
        'flock', '--exclusive', '--wait', '5', lockPath,
        process.execPath, '--eval', workerSource
    ], {
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit'
    });
    const exitCode = await child.exited;
    if (exitCode !== 0) process.exit(exitCode);
}

if (import.meta.main) {
    main().catch(error => {
        console.error(`[spectator] Mission update failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    });
}
