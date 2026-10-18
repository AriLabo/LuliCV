import { expect, it } from 'vitest';
import { createResumeRecord } from './defaults';
import { normalizeDocument } from './document';
import { MemoryRepository } from './memory-repository';
import { ResumeService } from './service';
import { buildTree, defaultParentForCopy, pathTo, placementError } from './tree';
import type { ResumeDocument } from './types';

let clock = 0;
function doc(name: string, extra: Partial<ResumeDocument> = {}): ResumeDocument {
  clock += 1;
  return { ...normalizeDocument({ ...createResumeRecord(name), createdAt: clock, updatedAt: clock }), ...extra };
}
const job = (company: string) => ({ target: { company, role: '后端工程师', jd: '' } });

it('places resumes by parentId and keeps three levels', () => {
  const master = doc('完整经历');
  const backend = doc('后端方向', { parentId: master.id });
  const sent = doc('云帆网络 · 后台开发', { parentId: backend.id, ...job('云帆网络') });
  const draft = doc('星澜科技 · 后端工程师', { parentId: backend.id, ...job('星澜科技') });
  const copied = doc('远山互娱 · 架构师', {
    parentId: backend.id,
    source: { id: sent.id, revision: 1 },
    ...job('远山互娱'),
  });
  // Without a parentId a resume sits at the top level, even when it was copied from another one.
  const imported = doc('导入的旧简历', { source: { id: backend.id, revision: 1 } });
  const tree = buildTree([imported, copied, draft, sent, backend, master]);
  expect(tree.map((node) => node.document.name)).toEqual(['完整经历', '导入的旧简历']);
  const direction = tree[0].children[0];
  expect(direction.document.name).toBe('后端方向');
  // Job versions, newest first.
  expect(direction.children.map((node) => node.document.name)).toEqual([
    '远山互娱 · 架构师',
    '星澜科技 · 后端工程师',
    '云帆网络 · 后台开发',
  ]);
  expect(direction.children.every((node) => node.level === 2)).toBe(true);
  expect(pathTo([master, backend, sent], sent.id).map((item) => item.name)).toEqual([
    '完整经历',
    '后端方向',
    '云帆网络 · 后台开发',
  ]);
});

it('refuses cycles, job parents and a fourth level, and picks sensible defaults for copies', () => {
  const master = doc('完整经历');
  const backend = doc('后端方向', { parentId: master.id });
  const sent = doc('云帆网络', { parentId: backend.id, ...job('云帆网络') });
  const documents = [master, backend, sent];
  expect(placementError(documents, master.id, backend.id)).toBe('不能放进自己的下级');
  expect(placementError(documents, master.id, master.id)).toBe('不能放在自己下面');
  expect(placementError(documents, '__new__', sent.id, 'job')).toBe('投递版下面不能再放简历');
  expect(placementError(documents, '__new__', 'missing', 'job')).toBe('找不到要放入的简历');
  const deep = doc('细分方向', { parentId: backend.id });
  expect(placementError([...documents, deep], '__new__', deep.id, 'job')).toBe('最多 3 层');
  expect(placementError(documents, '__new__', backend.id, 'job')).toBeUndefined();
  expect(defaultParentForCopy(documents, backend.id)).toBe(backend.id);
  expect(defaultParentForCopy(documents, sent.id)).toBe(backend.id);
  expect(defaultParentForCopy([...documents, deep], deep.id)).toBe(backend.id);
});

it('enforces placement through the service and records an explicit parent on copies', async () => {
  const service = new ResumeService(new MemoryRepository(), createResumeRecord);
  const master = await service.create({ name: '完整经历' });
  const backend = await service.duplicate(master.id, '后端方向', { mutationId: 'direction' });
  expect(backend.parentId).toBe(master.id);
  const tailored = await service.duplicate(master.id, '云帆网络 · 后台开发', {
    mutationId: 'job',
    parentId: backend.id,
  });
  expect(tailored).toMatchObject({ parentId: backend.id, source: { id: master.id, revision: 1 } });
  const asJob = await service.patch(tailored.id, {
    baseRevision: 1,
    mutationId: 'target',
    operations: [{ op: 'add', path: '/target', value: { company: '云帆网络', role: '后台开发', jd: '' } }],
  });
  await expect(
    service.duplicate(master.id, '不能放在投递版下', { mutationId: 'bad-parent', parentId: asJob.id }),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  await expect(
    service.patch(master.id, {
      baseRevision: 1,
      mutationId: 'cycle',
      operations: [{ op: 'add', path: '/parentId', value: backend.id }],
    }),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  await expect(
    service.patch(backend.id, {
      baseRevision: 1,
      mutationId: 'as-job',
      operations: [{ op: 'add', path: '/target', value: { company: '某公司', role: '', jd: '' } }],
    }),
  ).rejects.toThrow('下级简历');
  const moved = await service.patch(asJob.id, {
    baseRevision: 2,
    mutationId: 'move-top',
    operations: [
      { op: 'remove', path: '/parentId' },
      { op: 'add', path: '/purpose', value: '不该写在投递版上也允许' },
    ],
  });
  expect(moved.parentId).toBeUndefined();
  await expect(
    service.patch(asJob.id, {
      baseRevision: 3,
      mutationId: 'bad-path',
      operations: [{ op: 'add', path: '/parentId/x', value: 'y' }],
    }),
  ).rejects.toThrow('parentId');
});

it('imports an exported workspace as new top-level resumes and leaves the existing ones alone', async () => {
  const service = new ResumeService(new MemoryRepository(), createResumeRecord);
  const master = await service.create({ name: '母版' });
  const sent = await service.duplicate(master.id, '云帆网络 · 后台开发', { parentId: master.id });
  const exported = { version: 1, activeId: master.id, resumes: await service.list() };
  const imported = await service.importNew(exported);
  expect(imported.map((document) => document.name).sort()).toEqual(['云帆网络 · 后台开发', '母版']);
  expect(imported.every((document) => !document.parentId && !document.source && document.revision === 1)).toBe(true);
  expect(imported.some((document) => [master.id, sent.id].includes(document.id))).toBe(false);
  expect((await service.get(sent.id)).parentId).toBe(master.id);
  expect(await service.list()).toHaveLength(4);
});
