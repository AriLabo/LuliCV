import { expect, test } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SqliteRepository } from './sqlite-repository';
import { initializeWorkspace } from './workspace';
import { restoreWorkspace } from './recovery';
import { ResumeService } from '../../src/core/service';
import { createResumeRecord } from '../../src/core/defaults';
test('backup restore refuses an active Bridge and invalid backups, preserves state and restores receipts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'resume-recovery-'));
  await initializeWorkspace(root);
  const repository = await SqliteRepository.open(root);
  const service = new ResumeService(repository, createResumeRecord);
  const document = await service.create();
  const backup = path.join(root, 'backup.db');
  const mutation = {
    baseRevision: 1,
    mutationId: 'before-backup',
    operations: [{ op: 'replace' as const, path: '/name', value: '备份版本' }],
  };
  try {
    await service.patch(document.id, mutation);
    await repository.backupTo(backup);
    await expect(repository.backupTo(backup)).rejects.toMatchObject({ code: 'EEXIST' });
    await expect(restoreWorkspace(root, backup)).rejects.toMatchObject({ code: 'WORKSPACE_LOCKED' });
    await service.patch(document.id, {
      ...mutation,
      baseRevision: 2,
      mutationId: 'later',
      operations: [{ op: 'replace', path: '/name', value: '后来版本' }],
    });
  } finally {
    await repository.close();
  }
  try {
    const before = await readFile(path.join(root, 'lulicv.db'));
    const invalid = path.join(root, 'invalid.db');
    await writeFile(invalid, 'broken database');
    await expect(restoreWorkspace(root, invalid)).rejects.toBeDefined();
    expect(await readFile(path.join(root, 'lulicv.db'))).toEqual(before);
    expect((await restoreWorkspace(root, backup)).restored).toBe(true);
    const restored = await SqliteRepository.open(root);
    const service2 = new ResumeService(restored, createResumeRecord);
    try {
      expect((await service2.get(document.id)).name).toBe('备份版本');
      expect((await service2.patch(document.id, mutation)).revision).toBe(2);
    } finally {
      await restored.close();
    }
    await writeFile(path.join(root, '.lulicv/restore-pending.json'), '{}');
    await expect(SqliteRepository.open(root)).rejects.toThrow('恢复未完成');
    await restoreWorkspace(root, backup);
    const resumed = await SqliteRepository.open(root);
    await resumed.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
