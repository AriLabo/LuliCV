import { afterEach, expect, test } from 'vitest';
import { mkdtemp, readFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initializeWorkspace } from './workspace';
import { SqliteRepository } from './sqlite-repository';
import { ResumeService } from '../../src/core/service';
import { createResumeRecord } from '../../src/core/defaults';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'resume-sqlite-'));
  roots.push(root);
  await initializeWorkspace(root);
  const repository = await SqliteRepository.open(root);
  const service = new ResumeService(repository, createResumeRecord);
  return { root, repository, service, document: await service.create() };
}
const patch = (baseRevision: number, mutationId: string, name: string) => ({
  baseRevision,
  mutationId,
  operations: [{ op: 'replace' as const, path: '/name', value: name }],
});
test('CAS, rollback and durable receipts survive restart and later revisions', async () => {
  const { root, repository, service, document } = await setup();
  try {
    await expect(SqliteRepository.open(root)).rejects.toMatchObject({ code: 'WORKSPACE_LOCKED' });
    const results = await Promise.allSettled([
      service.patch(document.id, patch(1, 'one', 'A')),
      service.patch(document.id, patch(1, 'two', 'B')),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    await expect(
      service.patch(document.id, {
        baseRevision: 2,
        mutationId: 'bad',
        operations: [
          { op: 'replace', path: '/name', value: 'bad' },
          { op: 'remove', path: '/data/basics' },
        ],
      }),
    ).rejects.toBeDefined();
    expect((await service.get(document.id)).revision).toBe(2);
    await service.patch(document.id, patch(2, 'third', 'C'));
  } finally {
    await repository.close();
  }
  const reopened = await SqliteRepository.open(root);
  const service2 = new ResumeService(reopened, createResumeRecord);
  try {
    expect((await service2.patch(document.id, patch(1, 'one', 'A'))).revision).toBe(2);
    expect((await service2.get(document.id)).revision).toBe(3);
    await expect(service2.patch(document.id, patch(1, 'one', 'different'))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    const restored = await service2.restore(document.id, { baseRevision: 3, mutationId: 'restore', revision: 2 });
    expect(restored.name).toBe('A');
    expect(restored.revision).toBe(4);
    expect((await reopened.history(document.id))[0]).toMatchObject({ revision: 4, restoredFrom: 2 });
  } finally {
    await reopened.close();
  }
});
test('deletion is a durable revision, is retryable and IDs cannot be reused', async () => {
  const { root, repository, service, document } = await setup();
  await service.delete(document.id, { baseRevision: 1, mutationId: 'delete' });
  await repository.close();
  const reopened = await SqliteRepository.open(root);
  const service2 = new ResumeService(reopened, createResumeRecord);
  try {
    await service2.delete(document.id, { baseRevision: 1, mutationId: 'delete' });
    await expect(service2.get(document.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await service2.list()).toEqual([]);
    await expect(reopened.create(document)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  } finally {
    await reopened.close();
  }
});
test('active WAL backup restores committed data and newer schemas are rejected', async () => {
  const { root, repository, service, document } = await setup();
  const output = path.join(root, 'backup.db');
  try {
    await service.patch(document.id, patch(1, 'saved', '已保存'));
    await repository.backupTo(output);
  } finally {
    await repository.close();
  }
  await copyFile(output, path.join(root, 'lulicv.db'));
  const reopened = await SqliteRepository.open(root);
  expect((await reopened.get(document.id)).name).toBe('已保存');
  await reopened.close();
  const database = new DatabaseSync(path.join(root, 'lulicv.db'));
  database.exec('PRAGMA user_version=99');
  database.close();
  await expect(SqliteRepository.open(root)).rejects.toThrow('数据库版本较新');
  expect(JSON.parse(await readFile(path.join(root, 'lulicv.json'), 'utf8')).workspaceVersion).toBe(1);
});
test('failure after snapshot insertion rolls back head, history and receipt and emits no event', async () => {
  const { root, repository, service, document } = await setup();
  const observer = new DatabaseSync(path.join(root, 'lulicv.db'));
  const events: unknown[] = [];
  repository.subscribe((event) => events.push(event));
  try {
    observer.exec(
      "CREATE TRIGGER fail_receipt BEFORE INSERT ON mutations BEGIN SELECT RAISE(ABORT, 'injected disk-stage failure'); END;",
    );
    await expect(service.patch(document.id, patch(1, 'failure', '不可提交'))).rejects.toThrow('injected');
    expect((await service.get(document.id)).revision).toBe(1);
    expect(observer.prepare('SELECT count(*) AS n FROM resume_revisions').get()!.n).toBe(1);
    expect(observer.prepare('SELECT count(*) AS n FROM mutations').get()!.n).toBe(0);
    expect(events).toEqual([]);
    observer.exec('DROP TRIGGER fail_receipt');
    expect((await service.patch(document.id, patch(1, 'failure', '可提交'))).revision).toBe(2);
  } finally {
    observer.close();
    await repository.close();
  }
});
test('creation receipts are atomic, durable, and replay before consulting a deleted source', async () => {
  const { root, repository, service } = await setup();
  const observer = new DatabaseSync(path.join(root, 'lulicv.db'));
  let createdId: string;
  let copiedId: string;
  try {
    observer.exec(
      "CREATE TRIGGER fail_creation BEFORE INSERT ON creations BEGIN SELECT RAISE(ABORT,'creation receipt failed'); END;",
    );
    await expect(service.create({ name: '母版' }, 'durable-create')).rejects.toThrow('creation receipt failed');
    expect(observer.prepare('SELECT count(*) AS n FROM resumes').get()!.n).toBe(1);
    expect(observer.prepare('SELECT count(*) AS n FROM resume_revisions').get()!.n).toBe(1);
    observer.exec('DROP TRIGGER fail_creation');
    const results = await Promise.all([
      service.create({ name: '母版' }, 'durable-create'),
      service.create({ name: '母版' }, 'durable-create'),
    ]);
    expect(results[0]).toEqual(results[1]);
    createdId = results[0].id;
    const copy = await service.duplicate(createdId, '岗位版', {
      mutationId: 'durable-copy',
      expectedSourceRevision: 1,
    });
    copiedId = copy.id;
    await service.delete(createdId, { baseRevision: 1, mutationId: 'delete-created' });
    await service.delete(copiedId, { baseRevision: 1, mutationId: 'delete-copy' });
  } finally {
    observer.close();
    await repository.close();
  }
  const reopened = await SqliteRepository.open(root);
  const service2 = new ResumeService(reopened, createResumeRecord);
  try {
    expect((await service2.create({ name: '母版' }, 'durable-create')).id).toBe(createdId!);
    expect(
      (await service2.duplicate(createdId!, '岗位版', { mutationId: 'durable-copy', expectedSourceRevision: 1 })).id,
    ).toBe(copiedId!);
    expect(await service2.list()).toHaveLength(1);
    await expect(service2.duplicate(createdId!, 'different', { mutationId: 'durable-create' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  } finally {
    await reopened.close();
  }
});

test('the runtime check looks at the bundled SQLite, whatever the Node version', async () => {
  const { checkRuntime } = await import('./sqlite-repository');
  expect(() => checkRuntime({ node: '20.20.0' })).toThrow('没有内置 SQLite');
  for (const [node, sqlite] of [
    ['22.22.2', '3.50.4'],
    ['24.14.1', '3.51.2'],
  ])
    expect(() => checkRuntime({ node, sqlite })).toThrow(`Node ${node} 自带的是 ${sqlite}`);
  for (const [node, sqlite] of [
    ['22.22.3', '3.51.3'],
    ['24.15.0', '3.51.3'],
    ['26.11.1', '3.53.4'],
  ])
    expect(() => checkRuntime({ node, sqlite })).not.toThrow();
});
test('the export log keeps the newest 50 entries and only what the person needs to recognize them', async () => {
  const { root, repository } = await setup();
  try {
    for (let index = 1; index <= 53; index++)
      repository.logExport({
        at: 1791400000000 + index,
        resumeId: 'resume-a',
        name: '后端 · 示例科技',
        revision: index,
        ...(index % 2 ? { pages: 1 } : {}),
        outcome: index % 2 ? 'approved' : 'declined',
      });
  } finally {
    await repository.close();
  }
  const reopened = await SqliteRepository.open(root);
  try {
    const log = reopened.exportLog();
    expect(log).toHaveLength(50);
    expect(log[0]).toEqual({
      at: 1791400000053,
      resumeId: 'resume-a',
      name: '后端 · 示例科技',
      revision: 53,
      pages: 1,
      outcome: 'approved',
    });
    expect(log[1]).toEqual({
      at: 1791400000052,
      resumeId: 'resume-a',
      name: '后端 · 示例科技',
      revision: 52,
      outcome: 'declined',
    });
    expect(log.at(-1)!.revision).toBe(4);
  } finally {
    await reopened.close();
  }
});
