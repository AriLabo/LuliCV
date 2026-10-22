import { syncDirectory } from '../runtime/files';
import { mkdir, open, readFile, realpath, rename, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ResumeError } from '../../src/core/errors';
function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}
export async function atomicWrite(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n', 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, file);
    await syncDirectory(path.dirname(file));
  } finally {
    await handle?.close();
    await rm(temporary, { force: true });
  }
}
export async function initializeWorkspace(directory: string) {
  await mkdir(directory, { recursive: true });
  const root = await realpath(directory);
  for (const name of ['assets', '.lulicv', '.lulicv/trash']) {
    const target = path.join(root, name);
    await mkdir(target, { recursive: true });
    if ((await lstat(target)).isSymbolicLink()) throw new ResumeError('VALIDATION_FAILED', '工作区目录不能是符号链接');
  }
  const manifest = path.join(root, 'lulicv.json');
  try {
    const existing = JSON.parse(await readFile(manifest, 'utf8'));
    if (existing.workspaceVersion !== 1) throw new ResumeError('VALIDATION_FAILED', '未知工作区版本');
  } catch (error) {
    if (!isMissing(error)) throw error;
    const handle = await open(manifest, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify({ workspaceVersion: 1, workspaceId: randomUUID() }, null, 2) + '\n');
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  return root;
}
/** The process recorded as holding the workspace lock, and whether it is still running; undefined when unlocked. */
export async function lockOwner(directory: string): Promise<{ pid: number; alive: boolean } | undefined> {
  const root = await realpath(directory);
  let owner: { pid?: unknown };
  try {
    owner = JSON.parse(await readFile(path.join(root, '.lulicv/lock/owner.json'), 'utf8'));
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  if (!Number.isSafeInteger(owner.pid) || (owner.pid as number) <= 0)
    throw new ResumeError('WORKSPACE_LOCKED', '锁记录损坏，请人工检查');
  return { pid: owner.pid as number, alive: processAlive(owner.pid as number) };
}
export function processAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}
/** Removes a lock (and runtime file) left by a Bridge that exited without cleaning up. Returns the dead pid, if any. */
export async function clearStaleLock(directory: string): Promise<number | undefined> {
  const owner = await lockOwner(directory);
  if (!owner || owner.alive) return undefined;
  const root = await realpath(directory);
  try {
    const runtime = JSON.parse(await readFile(path.join(root, '.lulicv/runtime.json'), 'utf8'));
    if (runtime.pid === owner.pid) await rm(path.join(root, '.lulicv/runtime.json'), { force: true });
  } catch (error) {
    if (!isMissing(error) && !(error instanceof SyntaxError)) throw error;
  }
  await rm(path.join(root, '.lulicv/lock'), { recursive: true, force: true });
  return owner.pid;
}
export async function unlockWorkspace(directory: string) {
  const root = await realpath(directory);
  const lock = path.join(root, '.lulicv/lock');
  const owner = JSON.parse(await readFile(path.join(lock, 'owner.json'), 'utf8'));
  if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0)
    throw new ResumeError('WORKSPACE_LOCKED', '锁记录损坏，请人工检查');
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    await rm(lock, { recursive: true });
    return;
  }
  throw new ResumeError('WORKSPACE_LOCKED', '锁持有进程仍在运行');
}
