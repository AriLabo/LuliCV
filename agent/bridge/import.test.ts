import { test, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initializeWorkspace } from './workspace';
import { SqliteRepository } from './sqlite-repository';
import { ResumeService } from '../../src/core/service';
import { createResumeRecord } from '../../src/core/defaults';
test('single imports validate before writing and durable concurrent retries never add example content', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'resume-import-'));
  await initializeWorkspace(root);
  let repository = await SqliteRepository.open(root);
  let service = new ResumeService(repository, createResumeRecord);
  try {
    const master = await service.create();
    const data = { ...master.data, basics: { ...master.data.basics, name: '', phone: '', email: '' }, sections: [] };
    const input = { data, name: '原文待核对', mutationId: 'import-once' };
    for (const invalid of [
      { ...input, appearance: null },
      { ...input, data: {} },
      { ...input, revision: 9 },
      { ...input, id: master.id },
      { ...input, data: [data] },
      { ...input, appearance: { ...master.appearance, themeId: 'Not A Theme' } },
    ])
      await expect(service.importResume(invalid)).rejects.toThrow();
    expect(await service.list()).toHaveLength(1);
    const results = await Promise.all([service.importResume(input), service.importResume(input)]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({ document: { revision: 1, data }, warnings: ['姓名未填写'] });
    expect(await service.get(master.id)).toEqual(master);
    await repository.close();
    repository = await SqliteRepository.open(root);
    service = new ResumeService(repository, createResumeRecord);
    expect(await service.importResume(input)).toEqual(results[0]);
    expect(await service.list()).toHaveLength(2);
    await expect(service.importResume({ ...input, name: '不同参数' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(await service.get(results[0].document.id)).toEqual(results[0].document);
  } finally {
    await repository.close();
    await rm(root, { recursive: true, force: true });
  }
});
