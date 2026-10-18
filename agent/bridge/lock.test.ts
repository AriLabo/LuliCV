import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { clearStaleLock, initializeWorkspace, lockOwner } from './workspace';
import { doctor } from '../runtime/environment';
import { startBridge } from './server';

it('recognises and clears a lock left by a Bridge that exited, never one whose owner is alive', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'resume-lock-'));
  await initializeWorkspace(root);
  try {
    expect(await lockOwner(root)).toBeUndefined();
    const lock = path.join(root, '.cvslate/lock');
    await mkdir(lock);
    // A live owner (this test process) is left alone.
    await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid }));
    expect(await lockOwner(root)).toEqual({ pid: process.pid, alive: true });
    expect(await clearStaleLock(root)).toBeUndefined();
    // A pid that cannot exist stands in for a Bridge that has exited.
    const dead = 2 ** 22 + 12345;
    await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: dead }));
    await writeFile(path.join(root, '.cvslate/runtime.json'), JSON.stringify({ pid: dead }));
    const report = await doctor({ directory: root, source: 'option' });
    expect(report.checks).toContainEqual(
      expect.objectContaining({ name: 'lock', status: 'warning', message: expect.stringContaining(String(dead)) }),
    );
    expect(await clearStaleLock(root)).toBe(dead);
    expect(await lockOwner(root)).toBeUndefined();
    await expect(readFile(path.join(root, '.cvslate/runtime.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);

it('doctor puts the restart first when a Bridge lost file access and resources also look missing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'resume-doctor-'));
  await initializeWorkspace(root);
  const dist = path.join(root, 'web');
  await mkdir(dist);
  await writeFile(path.join(dist, 'index.html'), '<html><head></head></html>');
  const bridge = await startBridge({ workspace: root, dist });
  try {
    await rm(dist, { recursive: true });
    const report = await doctor({ directory: root, source: 'option' }, path.join(root, 'missing-install'));
    expect(report.checks).toContainEqual(expect.objectContaining({ name: 'bridge-files', status: 'error' }));
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: 'resources',
        status: 'warning',
        nextAction: expect.stringContaining('stop，让下一条命令重新启动 Bridge'),
      }),
    );
  } finally {
    await bridge.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
