import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { startBridge } from './server';
import { initializeWorkspace } from './workspace';
import { photoSummary } from './photo';
import { bridgeRequest } from '../cli/client';
import { browserCookie } from './testing';
import { cloneSample } from '../../src/core/fixtures';
import type { ResumeDocument } from '../../src/core/types';

// Made-up bytes; the bridge checks only that a photo is a small base64 data URL.
const photo = `data:image/jpeg;base64,${Buffer.alloc(3 * 1024, 7).toString('base64')}`;
const other = `data:image/png;base64,${Buffer.alloc(300, 9).toString('base64')}`;

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'resume-photo-'));
  await initializeWorkspace(root);
  const dist = path.join(root, 'web');
  await mkdir(dist);
  await writeFile(path.join(dist, 'index.html'), '<html><head></head><body>fixture</body></html>');
  const bridge = await startBridge({ workspace: root, dist });
  const cookie = await browserCookie(bridge.runtime);
  const agent = async (route: string, method = 'GET', value?: unknown) =>
    (await (await bridgeRequest(bridge.runtime, route, method, value)).json()) as ResumeDocument;
  const page = async (route: string) =>
    (await (await fetch(bridge.origin + route, { headers: { Cookie: cookie } })).json()) as ResumeDocument;
  const close = async () => {
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  };
  return { agent, page, close };
}

it('summarizes a photo for agents in a size and fingerprint', () => {
  expect(photoSummary(photo)).toMatch(/^照片已省略（JPEG，3 KB，#[0-9a-f]{12}；原样写回即保留原图）$/);
  expect(photoSummary(other)).toMatch(/^照片已省略（PNG，1 KB，/);
  expect(photoSummary(photo)).not.toBe(photoSummary(photo.slice(0, -4) + 'AAAA'));
});

it('gives agents the summary, the page the photo, and keeps the photo when the summary comes back', async () => {
  const { agent, page, close } = await setup();
  try {
    const data = cloneSample();
    data.basics.photo = photo;
    const { document: created } = (await agent('/api/import-resume', 'POST', {
      mutationId: 'photo-import',
      data,
    })) as unknown as { document: ResumeDocument };
    expect(created.data.basics.photo).toBe(photoSummary(photo));
    const route = `/api/resumes/${created.id}`;
    const read = await agent(route);
    expect(read.data.basics.photo).toBe(photoSummary(photo));
    expect(JSON.stringify(read)).not.toContain('base64');
    expect((await page(route)).data.basics.photo).toBe(photo);

    // A whole basics read and written back with one change keeps the photo it stood for.
    const basics = {
      baseRevision: read.revision,
      mutationId: 'photo-basics',
      operations: [{ op: 'replace', path: '/data/basics', value: { ...read.data.basics, name: '李四' } }],
    };
    const patched = await agent(route, 'PATCH', basics);
    expect(patched.data.basics).toMatchObject({ name: '李四', photo: photoSummary(photo) });
    expect((await page(route)).data.basics.photo).toBe(photo);

    // A summary of some other photo is not this resume's photo.
    await expect(
      agent(route, 'PATCH', {
        baseRevision: patched.revision,
        mutationId: 'photo-other',
        operations: [{ op: 'replace', path: '/data/basics/photo', value: photoSummary(other) }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: expect.stringContaining('照片摘要只能原样写回') });

    // A new photo goes in as a data URL.
    const replaced = await agent(route, 'PATCH', {
      baseRevision: patched.revision,
      mutationId: 'photo-new',
      operations: [{ op: 'replace', path: '/data/basics/photo', value: other }],
    });
    expect(replaced.data.basics.photo).toBe(photoSummary(other));
    expect((await page(route)).data.basics.photo).toBe(other);

    // A retry of the write already applied gets its result, though the photo its summary stood for is gone.
    const retried = await agent(route, 'PATCH', basics);
    expect(retried.revision).toBe(patched.revision);
    expect(retried.data.basics.photo).toBe(photoSummary(photo));

    // Imported data has no photo of its own for a summary to stand for.
    await expect(
      agent('/api/import-resume', 'POST', { mutationId: 'photo-copy', data: read.data }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: expect.stringContaining('导入的数据里有照片摘要') });
  } finally {
    await close();
  }
});
