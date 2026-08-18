import { closeSync, openSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { userInfo } from 'node:os';
import { dlopen, FFIType } from 'bun:ffi';
import { sanitizePublicMission } from './mission';

export interface PublicControllerStatus {
    text: string;
    updatedAt: string;
}

interface ControllerLockMetadata {
    pid: number;
    token: string;
    acquiredAt: string;
    processStartId: string;
}

export interface ControllerStatusOptions {
    botName: string;
    mission: unknown;
    now?: number;
    lockDir?: string;
    procRoot?: string;
    readProcessStat?: (pid: number) => Promise<string>;
    isGuardLocked?: (path: string) => Promise<boolean>;
}

const LOCK_EX = 2;
const LOCK_NB = 4;
const flockLibrary = process.platform === 'linux'
    ? dlopen('libc.so.6', { flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } })
    : null;

function defaultLockDir(): string {
    const identity = typeof process.getuid === 'function'
        ? String(process.getuid())
        : userInfo().username.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
    return process.platform === 'linux' && typeof process.getuid === 'function'
        ? join('/run/user', identity, `rs-sdk-${identity}`)
        : '';
}

function sanitizeMetadata(value: unknown): ControllerLockMetadata | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const source = value as Record<string, unknown>;
    if (!Number.isInteger(source.pid) || Number(source.pid) <= 0) return null;
    if (typeof source.token !== 'string' || source.token.length < 1 || source.token.length > 80) return null;
    if (typeof source.processStartId !== 'string' || !/^\d{1,32}$/.test(source.processStartId)) return null;
    if (typeof source.acquiredAt !== 'string' || !Number.isFinite(Date.parse(source.acquiredAt))) return null;
    return {
        pid: Number(source.pid),
        token: source.token,
        acquiredAt: source.acquiredAt,
        processStartId: source.processStartId
    };
}

function sameOwner(left: ControllerLockMetadata, right: ControllerLockMetadata): boolean {
    return left.pid === right.pid
        && left.token === right.token
        && left.processStartId === right.processStartId
        && left.acquiredAt === right.acquiredAt;
}

function processStartId(stat: string): string | null {
    const commandEnd = stat.lastIndexOf(')');
    if (commandEnd < 0) return null;
    const fieldsAfterCommand = stat.slice(commandEnd + 2).trim().split(/\s+/);
    return fieldsAfterCommand[19] || null;
}

async function kernelGuardIsLocked(path: string): Promise<boolean> {
    if (!flockLibrary) return false;
    let fd: number | null = null;
    try {
        fd = openSync(path, 'r+');
        return flockLibrary.symbols.flock(fd, LOCK_EX | LOCK_NB) !== 0;
    } catch {
        return false;
    } finally {
        if (fd !== null) closeSync(fd);
    }
}

async function readMetadata(path: string): Promise<ControllerLockMetadata | null> {
    try {
        return sanitizeMetadata(JSON.parse(await readFile(path, 'utf8')));
    } catch {
        return null;
    }
}

export async function readControllerStatus(options: ControllerStatusOptions): Promise<PublicControllerStatus | null> {
    const { botName, now = Date.now() } = options;
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(botName) || !Number.isFinite(now)) return null;
    const mission = sanitizePublicMission(options.mission);
    if (!mission) return null;
    const activeTasks = mission.tasks.filter(task => task.status === 'active');
    if (activeTasks.length !== 1) return null;

    const lockDir = options.lockDir ?? defaultLockDir();
    if (!lockDir) return null;
    const safeBotName = botName.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const metadataPath = join(lockDir, `rs-sdk-controller-${safeBotName}.lock`);
    const guardPath = `${metadataPath}.guard`;
    const lockCheck = options.isGuardLocked ?? kernelGuardIsLocked;
    const procRoot = options.procRoot ?? '/proc';
    const readStat = options.readProcessStat
        ?? ((pid: number) => readFile(join(procRoot, String(pid), 'stat'), 'utf8'));

    const firstOwner = await readMetadata(metadataPath);
    if (!firstOwner || !(await lockCheck(guardPath))) return null;
    try {
        const before = processStartId(await readStat(firstOwner.pid));
        const after = processStartId(await readStat(firstOwner.pid));
        if (!before || before !== after || before !== firstOwner.processStartId) return null;
    } catch {
        return null;
    }
    const secondOwner = await readMetadata(metadataPath);
    if (!secondOwner || !sameOwner(firstOwner, secondOwner) || !(await lockCheck(guardPath))) return null;

    return {
        text: `Running controller · ${activeTasks[0].label}`,
        updatedAt: new Date(now).toISOString()
    };
}
