import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { BrowserRepository } from './browser-repository';
import { ResumeService } from '../core/service';
import { createResumeRecord } from './defaults';
it('uses one IndexedDB transaction for concurrent revision checks across adapters', async () => {
  const name = crypto.randomUUID();
  const a = new BrowserRepository(name);
  const b = new BrowserRepository(name);
  try {
    const first = new ResumeService(a, createResumeRecord);
    const second = new ResumeService(b, createResumeRecord);
    const document = await first.create();
    const results = await Promise.allSettled(
      [first, second].map((service, index) =>
        service.patch(document.id, {
          baseRevision: 1,
          mutationId: `write-${index}`,
          operations: [{ op: 'replace', path: '/name', value: String(index) }],
        }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await second.get(document.id)).revision).toBe(2);
  } finally {
    await a.close();
    await b.close();
  }
});
it('deduplicates creation across adapters and retains the original duplicate after reopening', async () => {
  const name = crypto.randomUUID();
  const a = new BrowserRepository(name);
  const b = new BrowserRepository(name);
  const first = new ResumeService(a, createResumeRecord);
  const second = new ResumeService(b, createResumeRecord);
  let documentId: string;
  let copyId: string;
  try {
    const results = await Promise.all([
      first.create({ name: '母版' }, 'browser-create'),
      second.create({ name: '母版' }, 'browser-create'),
    ]);
    expect(results[0]).toEqual(results[1]);
    documentId = results[0].id;
    const copy = await first.duplicate(documentId, '岗位版', { mutationId: 'browser-copy', expectedSourceRevision: 1 });
    copyId = copy.id;
    await second.delete(documentId, { baseRevision: 1, mutationId: 'browser-delete' });
  } finally {
    await a.close();
    await b.close();
  }
  const reopened = new BrowserRepository(name);
  const service = new ResumeService(reopened, createResumeRecord);
  try {
    expect((await service.create({ name: '母版' }, 'browser-create')).id).toBe(documentId!);
    expect(
      (await service.duplicate(documentId!, '岗位版', { mutationId: 'browser-copy', expectedSourceRevision: 1 })).id,
    ).toBe(copyId!);
    expect(await service.list()).toHaveLength(1);
    await expect(service.create({ name: 'different' }, 'browser-create')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  } finally {
    await reopened.close();
  }
});
