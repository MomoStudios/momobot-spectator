import { resolve } from 'node:path';
import { sanitizePublicMission, writePublicMission, type PublicMission } from './mission';

interface ParsedMissionArguments {
    bot: string;
    mission: PublicMission;
}

export function parseMissionArguments(arguments_: string[]): ParsedMissionArguments {
    const values = new Map<string, string>();
    const tasks: Array<{ label: string; status: string }> = [];
    for (const argument of arguments_) {
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
    const mission = sanitizePublicMission({
        title: values.get('title'),
        objective: values.get('objective'),
        updatedAt: values.get('updated-at') || new Date().toISOString(),
        tasks
    });
    if (!mission) throw new Error('Invalid public mission');
    return { bot, mission };
}

async function main(): Promise<void> {
    const { bot, mission } = parseMissionArguments(process.argv.slice(2));
    const path = resolve(import.meta.dir, '..', 'bots', bot, 'public-mission.json');
    await writePublicMission(path, mission);
    console.log(`[spectator] Updated public mission for ${bot}: ${mission.title}`);
}

if (import.meta.main) {
    main().catch(error => {
        console.error(`[spectator] Mission update failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    });
}
