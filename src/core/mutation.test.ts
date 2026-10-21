import { expect, it } from 'vitest';
import { ResumeService } from './service';
import { MemoryRepository } from './memory-repository';
import { sampleRecord } from './fixtures';
async function setup() {
  const service = new ResumeService(new MemoryRepository(), sampleRecord);
  return { service, document: await service.create() };
}
it('permits only one concurrent writer at the same revision', async () => {
  const { service, document } = await setup();
  const results = await Promise.allSettled(
    ['a', 'b'].map((value) =>
      service.patch(document.id, {
        baseRevision: 1,
        mutationId: value,
        operations: [{ op: 'replace', path: '/data/basics/name', value }],
      }),
    ),
  );
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(await service.get(document.id)).toMatchObject({ revision: 2 });
});
it('rolls back an entire invalid batch and rejects metadata and full content overwrites', async () => {
  const { service, document } = await setup();
  await expect(
    service.patch(document.id, {
      baseRevision: 1,
      mutationId: 'bad',
      operations: [
        { op: 'replace', path: '/name', value: 'changed' },
        { op: 'remove', path: '/data/basics/missing' },
      ],
    }),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(await service.get(document.id)).toEqual(document);
  for (const path of ['/revision', '/data', '/data/sections', '/data/__proto__/polluted'])
    await expect(
      service.patch(document.id, {
        baseRevision: 1,
        mutationId: 'bad',
        operations: [{ op: 'replace', path, value: {} }],
      }),
    ).rejects.toThrow();
});
it('deduplicates append requests and rejects reuse with different payloads', async () => {
  const { service, document } = await setup();
  const request = {
    baseRevision: 1,
    mutationId: 'append',
    operations: [{ op: 'add' as const, path: '/data/sections/1/entries/0/bullets/-', value: 'new' }],
  };
  const first = await service.patch(document.id, request);
  expect(await service.patch(document.id, request)).toEqual(first);
  await expect(
    service.patch(document.id, { ...request, operations: [{ op: 'replace', path: '/name', value: 'other' }] }),
  ).rejects.toThrow();
  expect((await service.get(document.id)).revision).toBe(2);
});
it('rejects stale indices after reordering and restores previous with a new revision', async () => {
  const { service, document } = await setup();
  await service.patch(document.id, {
    baseRevision: 1,
    mutationId: 'move',
    operations: [{ op: 'move', from: '/data/sections/1', path: '/data/sections/2' }],
  });
  await expect(
    service.patch(document.id, {
      baseRevision: 1,
      mutationId: 'stale',
      operations: [{ op: 'replace', path: '/data/sections/1/title', value: 'oops' }],
    }),
  ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  expect(await service.restorePrevious(document.id, { baseRevision: 2, mutationId: 'restore' })).toMatchObject({
    revision: 3,
    data: document.data,
  });
});
it('creates and duplicates once, pins the source, and replays original results after deletion', async () => {
  const { service } = await setup();
  const input = { name: '岗位母版' };
  const results = await Promise.all([service.create(input, 'create-once'), service.create(input, 'create-once')]);
  expect(results[0]).toEqual(results[1]);
  const document = results[0];
  await expect(service.create({ name: '另一个创建' }, 'create-once')).rejects.toMatchObject({
    code: 'VALIDATION_FAILED',
  });
  await expect(
    service.duplicate(document.id, '岗位版', { mutationId: 'pin', expectedSourceRevision: 2 }),
  ).rejects.toMatchObject({ code: 'REVISION_CONFLICT', currentRevision: 1 });
  const copy = await service.duplicate(document.id, '岗位版', { mutationId: 'copy-once', expectedSourceRevision: 1 });
  await service.patch(copy.id, {
    baseRevision: 1,
    mutationId: 'edit-copy',
    operations: [{ op: 'replace', path: '/name', value: '后来修改' }],
  });
  await service.delete(document.id, { baseRevision: 1, mutationId: 'delete-source' });
  expect(await service.create(input, 'create-once')).toEqual(document);
  expect(
    await service.duplicate(document.id, '岗位版', { mutationId: 'copy-once', expectedSourceRevision: 1 }),
  ).toEqual(copy);
  expect((await service.get(copy.id)).name).toBe('后来修改');
});
it('records the duplicate source and lets only the target metadata be patched', async () => {
  const { service, document } = await setup();
  const copy = await service.duplicate(document.id, '示例科技 · 后端', {
    mutationId: 'job-copy',
    expectedSourceRevision: 1,
  });
  expect(copy.source).toEqual({ id: document.id, revision: 1 });
  expect(copy.target).toBeUndefined();
  const target = { company: '示例科技', role: '后端工程师', jd: '负责订单系统' };
  const tailored = await service.patch(copy.id, {
    baseRevision: 1,
    mutationId: 'set-target',
    operations: [{ op: 'add', path: '/target', value: target }],
  });
  expect(tailored).toMatchObject({ revision: 2, target, source: { id: document.id, revision: 1 } });
  await expect(
    service.patch(copy.id, {
      baseRevision: 2,
      mutationId: 'forge-source',
      operations: [{ op: 'replace', path: '/source/id', value: 'other' }],
    }),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  await expect(
    service.patch(copy.id, {
      baseRevision: 2,
      mutationId: 'bad-target',
      operations: [{ op: 'add', path: '/target/salary', value: '1' }],
    }),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(
    (
      await service.patch(copy.id, {
        baseRevision: 2,
        mutationId: 'clear-target',
        operations: [{ op: 'remove', path: '/target' }],
      })
    ).target,
  ).toBeUndefined();
});
it('diffs a first, changed and cleared target into patches the service accepts', async () => {
  const { service, document } = await setup();
  const { diffDocuments } = await import('./mutation');
  const target = { company: '示例科技', role: '后端', jd: '' };
  let current = document;
  for (const [mutationId, next] of [
    ['first', target],
    ['change', { ...target, role: '前端' }],
    ['clear', undefined],
  ] as const) {
    const edited = { ...current, ...(next ? { target: next } : {}) };
    if (!next) delete edited.target;
    current = await service.patch(document.id, {
      baseRevision: current.revision,
      mutationId,
      operations: diffDocuments(current, edited),
    });
    expect(current.target).toEqual(next);
  }
});
it('saves the built-in example once, marked as a sample through copies, until the user clears the mark', async () => {
  const { createResumeRecord, sampleName } = await import('./defaults');
  const { diffDocuments } = await import('./mutation');
  const service = new ResumeService(new MemoryRepository(), createResumeRecord);
  const blank = await service.create();
  expect(blank.sample).toBeUndefined();
  expect(blank.data.basics.name).toBe('');
  expect(blank.data.sections.every((section) => section.entries.length === 0 && !section.text)).toBe(true);

  const { document: sample } = await service.importResume({ mutationId: 'try', sample: true });
  expect(sample).toMatchObject({ name: sampleName, sample: true, revision: 1 });
  expect(sample.data.basics.name).toBe('林夏');
  expect((await service.importResume({ mutationId: 'try', sample: true })).document).toEqual(sample);
  await expect(service.importResume({ mutationId: 'both', sample: true, data: blank.data })).rejects.toMatchObject({
    code: 'VALIDATION_FAILED',
  });
  await expect(service.importResume({ mutationId: 'false', sample: false })).rejects.toMatchObject({
    code: 'VALIDATION_FAILED',
  });

  const copy = await service.duplicate(sample.id, '内容运营 · 投递版', {
    mutationId: 'copy',
    expectedSourceRevision: 1,
  });
  expect(copy.sample).toBe(true);
  await expect(
    service.patch(copy.id, {
      baseRevision: 1,
      mutationId: 'deep',
      operations: [{ op: 'add', path: '/sample/x', value: true }],
    }),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  const cleared = await service.patch(copy.id, {
    baseRevision: 1,
    mutationId: 'clear',
    operations: [{ op: 'remove', path: '/sample' }],
  });
  expect(cleared).not.toHaveProperty('sample');
  const { sample: _, ...unmarked } = sample;
  const edited = await service.patch(sample.id, {
    baseRevision: 1,
    mutationId: 'diff-clear',
    operations: diffDocuments(sample, unmarked),
  });
  expect(edited).not.toHaveProperty('sample');
  expect(edited.data).toEqual(sample.data);

  const { document: again } = await service.importResume({ mutationId: 'again', sample: true });
  const replaced = await service.replace(
    again.id,
    { baseRevision: 1, mutationId: 'mine' },
    { data: blank.data, appearance: again.appearance },
  );
  expect(replaced).not.toHaveProperty('sample');
});
