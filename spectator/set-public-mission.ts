import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { advancePublicMission, loadPublicMission, sanitizePublicMission, updateNowChecking, writePublicMission, type PublicMission } from './mission';

interface ParsedMissionArguments {
    bot: string;
    mission: PublicMission;
}

export type ParsedMissionCommand =
    | { kind: 'replace'; bot: string; mission: PublicMission }
    | { kind: 'advance'; bot: string }
    | { kind: 'status'; bot: string; text: string | null };

export function parseMissionCommand(arguments_: string[]): ParsedMissionCommand {
    const values = new Map<string, string>();
    const tasks: Array<{ label: string; status: string }> = [];
    let advance = false;
    let clearNowChecking = false;
    for (const argument of arguments_) {
        if (argument === '--advance') {
            if (advance) throw new Error(`Invalid argument: ${argument}`);
            advance = true;
            continue;
        }
        if (argument === '--clear-now-checking') {
            if (clearNowChecking) throw new Error(`Invalid argument: ${argument}`);
            clearNowChecking = true;
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
        if (!['bot', 'title', 'objective', 'updated-at', 'now-checking'].includes(key) || values.has(key)) {
            throw new Error(`Invalid argument: ${argument}`);
        }
        values.set(key, value);
    }

    const bot = values.get('bot') || 'momobot';
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(bot)) throw new Error('Invalid bot name');
    const nowChecking = values.get('now-checking');
    const replacementFields = [...values.keys()].filter(key => key !== 'bot' && key !== 'now-checking');
    if (advance) {
        if (tasks.length > 0 || replacementFields.length > 0 || nowChecking !== undefined || clearNowChecking) {
            throw new Error('Invalid argument: --advance cannot be combined with replacement or status fields');
        }
        return { kind: 'advance', bot };
    }
    if (nowChecking !== undefined || clearNowChecking) {
        if (tasks.length > 0 || replacementFields.length > 0 || (nowChecking !== undefined && clearNowChecking)) {
            throw new Error('Invalid argument: now-checking updates cannot be combined with replacement fields');
        }
        const text = nowChecking?.trim();
        if (nowChecking !== undefined && (!text || text.length > 180)) throw new Error('Invalid public now-checking status');
        return { kind: 'status', bot, text: clearNowChecking ? null : text! };
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
    const current = await loadPublicMission(path);
    const mission = command.kind === 'advance'
        ? advancePublicMission(current)
        : command.kind === 'status'
            ? updateNowChecking(current, command.text)
            : command.mission;
    await writePublicMission(path, mission);
    const active = mission.tasks.find(task => task.status === 'active');
    const action = command.kind === 'advance' ? 'Advanced'
        : command.kind === 'status' ? (command.text === null ? 'Cleared now-checking status for' : 'Updated now-checking status for')
        : 'Updated public mission for';
    console.log(`[spectator] ${action} ${command.bot}: ${mission.title}${active ? ` · ${active.label}` : ' · complete'}`);
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
