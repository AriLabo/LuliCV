import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { initializeWorkspace } from '../bridge/workspace';
import { errorResult } from '../runtime/guidance';
import { runtimeAt } from './client';

it('reports a missing or stopped Bridge as not running, so writes are not treated as unknown', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'resume-client-'));
  await initializeWorkspace(root);
  try {
    const missing = await runtimeAt(root).catch((error: unknown) => error);
    expect(missing).toMatchObject({ code: 'BRIDGE_NOT_RUNNING' });
    const result = errorResult(missing, 'write');
    expect(result.nextAction).toContain('直接重试');
    expect(result.nextAction).not.toContain('未知');
    // A Bridge that died without cleaning up leaves runtime.json pointing at a port nobody listens on.
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server missing');
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const { workspaceId } = JSON.parse(await readFile(path.join(root, 'lulicv.json'), 'utf8'));
    await writeFile(
      path.join(root, '.lulicv/runtime.json'),
      JSON.stringify({
        pid: process.pid,
        token: 'a'.repeat(64),
        workspaceId,
        origin: `http://127.0.0.1:${address.port}`,
      }),
    );
    await expect(runtimeAt(root)).rejects.toMatchObject({ code: 'BRIDGE_NOT_RUNNING' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
