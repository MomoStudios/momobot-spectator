import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export type PublicMissionTaskStatus = 'done' | 'active' | 'pending';

export interface PublicMissionTask {
    label: string;
    status: PublicMissionTaskStatus;
}

export interface PublicNowChecking {
    text: string;
    updatedAt: string;
}

export interface PublicMission {
    title: string;
    objective: string;
    updatedAt: string;
    tasks: PublicMissionTask[];
    nowChecking?: PublicNowChecking;
}

function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function boundedString(value: unknown, maxLength: number): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length > 0 && normalized.length <= maxLength && !/[\p{Cc}\p{Cf}]/u.test(normalized)
        ? normalized
        : null;
}

export function sanitizePublicMission(value: unknown): PublicMission | null {
    const source = record(value);
    if (!source) return null;
    const title = boundedString(source.title, 80);
    const objective = boundedString(source.objective, 240);
    const updatedAt = boundedString(source.updatedAt, 40);
    if (!title || !objective || !updatedAt || !Number.isFinite(Date.parse(updatedAt))) return null;
    let nowChecking: PublicNowChecking | undefined;
    if (source.nowChecking !== undefined) {
        const status = record(source.nowChecking);
        const text = boundedString(status?.text, 180);
        const statusUpdatedAt = boundedString(status?.updatedAt, 40);
        if (!text || !statusUpdatedAt || !Number.isFinite(Date.parse(statusUpdatedAt))) return null;
        nowChecking = { text, updatedAt: statusUpdatedAt };
    }
    if (!Array.isArray(source.tasks) || source.tasks.length < 1) return null;

    const tasks: PublicMissionTask[] = [];
    for (const value of source.tasks.slice(0, 6)) {
        const task = record(value);
        if (!task) return null;
        const label = boundedString(task.label, 120);
        const status = task.status;
        if (!label || (status !== 'done' && status !== 'active' && status !== 'pending')) return null;
        tasks.push({ label, status });
    }
    return { title, objective, updatedAt, tasks, ...(nowChecking ? { nowChecking } : {}) };
}

export function updateNowChecking(value: unknown, text: string | null, updatedAt: string = new Date().toISOString()): PublicMission {
    const mission = sanitizePublicMission(value);
    if (!mission) throw new Error('Invalid public mission');
    const updated = sanitizePublicMission(text === null
        ? { ...mission, nowChecking: undefined }
        : { ...mission, nowChecking: { text, updatedAt } });
    if (!updated) throw new Error('Invalid public now-checking status');
    return updated;
}

export function advancePublicMission(value: unknown, updatedAt: string = new Date().toISOString()): PublicMission {
    const mission = sanitizePublicMission(value);
    if (!mission) throw new Error('Invalid public mission');
    const activeIndexes = mission.tasks.flatMap((task, index) => task.status === 'active' ? [index] : []);
    if (activeIndexes.length !== 1) throw new Error('Public mission must have exactly one active task');
    const activeIndex = activeIndexes[0];
    if (
        mission.tasks.slice(0, activeIndex).some(task => task.status !== 'done') ||
        mission.tasks.slice(activeIndex + 1).some(task => task.status !== 'pending')
    ) {
        throw new Error('Public mission tasks must be ordered as done, active, pending');
    }
    const nextPendingIndex = mission.tasks.findIndex((task, index) => index > activeIndex && task.status === 'pending');
    const advanced = sanitizePublicMission({
        ...mission,
        updatedAt,
        tasks: mission.tasks.map((task, index) => ({
            ...task,
            status: index === activeIndex ? 'done' : index === nextPendingIndex ? 'active' : task.status
        }))
    });
    if (!advanced) throw new Error('Invalid public mission');
    return advanced;
}

export async function loadPublicMission(path: string): Promise<PublicMission | null> {
    try {
        return sanitizePublicMission(JSON.parse(await readFile(path, 'utf8')));
    } catch {
        return null;
    }
}

export async function writePublicMission(path: string, value: unknown): Promise<PublicMission> {
    const mission = sanitizePublicMission(value);
    if (!mission) throw new Error('Invalid public mission');
    const directory = dirname(path);
    await mkdir(directory, { recursive: true, mode: 0o755 });
    const temporary = join(directory, `.${path.split('/').at(-1)}.${process.pid}.${randomUUID()}.tmp`);
    try {
        await writeFile(temporary, `${JSON.stringify(mission, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
        await chmod(temporary, 0o644);
        await rename(temporary, path);
        await chmod(path, 0o644);
        return mission;
    } catch (error) {
        await rm(temporary, { force: true }).catch(() => {});
        throw error;
    }
}
