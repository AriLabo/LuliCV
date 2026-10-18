import { expect, it, vi } from 'vitest';
import { WorkspaceRenderer } from './renderer';
import { createResumeRecord } from '../../src/core/defaults';
import { normalizeDocument } from '../../src/core/document';
import type { ResumeService } from '../../src/core/service';
it('shutdown finishes the active render and rejects queued and new jobs', async () => {
  const document = normalizeDocument(createResumeRecord());
  const service = { get: async () => document } as unknown as ResumeService;
  const renderer = new WorkspaceRenderer(service, {
    pid: process.pid,
    origin: 'http://127.0.0.1:1',
    token: 'a'.repeat(64),
    workspaceId: 'fixture',
  });
  let release!: () => void;
  const active = new Promise<void>((resolve) => {
    release = resolve;
  });
  const render = vi
    .spyOn(renderer as unknown as { render: () => Promise<unknown> }, 'render')
    .mockImplementation(async () => {
      await active;
      return { report: { id: document.id, revision: 1, pageCount: 1 } };
    });
  const first = renderer.inspect(document.id, 1);
  const queued = renderer.inspect(document.id, 1);
  const queuedFailure = expect(queued).rejects.toMatchObject({ code: 'STORAGE_FAILED' });
  await expect.poll(() => render.mock.calls.length).toBe(1);
  renderer.beginShutdown();
  const closing = renderer.close();
  await expect(renderer.inspect(document.id, 1)).rejects.toMatchObject({ code: 'STORAGE_FAILED' });
  release();
  await expect(first).resolves.toMatchObject({ pageCount: 1 });
  await queuedFailure;
  await closing;
  expect(render).toHaveBeenCalledTimes(1);
});
