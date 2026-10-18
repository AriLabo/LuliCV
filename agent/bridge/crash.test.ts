import { expect, test } from 'vitest';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { initializeWorkspace, unlockWorkspace } from './workspace';
import { SqliteRepository } from './sqlite-repository';
import { ResumeService } from '../../src/core/service';
import { createResumeRecord } from '../../src/core/defaults';
test('process death before commit rolls back; after commit retains receipt and requires safe unlock', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'resume-crash-'));
  await initializeWorkspace(root);
  const repository = await SqliteRepository.open(root);
  const service = new ResumeService(repository, createResumeRecord);
  const document = await service.create();
  await repository.close();
  const binary = path.join(root, 'child.mjs');
  await symlink(
    path.resolve('node_modules'),
    path.join(root, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await build({
    stdin: {
      contents: `
    import { SqliteRepository } from './agent/bridge/sqlite-repository';
    import { ResumeService } from './src/core/service';
    import { createResumeRecord } from './src/core/defaults';
    import { DatabaseSync } from 'node:sqlite';
    const [root,id,mode]=process.argv.slice(2);
    const repository=await SqliteRepository.open(root);
    if(mode==='before') { const db=new DatabaseSync(root+'/cvslate.db'); db.exec('BEGIN IMMEDIATE'); db.prepare('UPDATE resumes SET current_revision=99 WHERE id=?').run(id); }
    else { const service=new ResumeService(repository,createResumeRecord); await service.patch(id,{baseRevision:1,mutationId:'crash-after',operations:[{op:'replace',path:'/name',value:'已提交'}]}); }
    process.stdout.write('ready\\n'); setInterval(()=>{},1000);
  `,
      resolveDir: process.cwd(),
      sourcefile: 'crash-fixture.ts',
    },
    outfile: binary,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    target: 'node22',
  });
  try {
    for (const mode of ['before', 'after']) {
      const child = spawn(process.execPath, [binary, root, document.id, mode], { stdio: ['ignore', 'pipe', 'pipe'] });
      const exited = once(child, 'exit');
      let diagnostics = '';
      child.stderr.on('data', (chunk) => {
        diagnostics += chunk;
      });
      try {
        await Promise.race([
          once(child.stdout, 'data'),
          exited.then(() => {
            throw new Error(`child exited: ${diagnostics}`);
          }),
        ]);
        await expect(unlockWorkspace(root)).rejects.toMatchObject({ code: 'WORKSPACE_LOCKED' });
      } finally {
        child.kill('SIGKILL');
        await exited;
      }
      await expect(SqliteRepository.open(root)).rejects.toMatchObject({ code: 'WORKSPACE_LOCKED' });
      await unlockWorkspace(root);
      const reopened = await SqliteRepository.open(root);
      const service2 = new ResumeService(reopened, createResumeRecord);
      try {
        expect((await service2.get(document.id)).revision).toBe(mode === 'before' ? 1 : 2);
        if (mode === 'after')
          expect(
            (
              await service2.patch(document.id, {
                baseRevision: 1,
                mutationId: 'crash-after',
                operations: [{ op: 'replace', path: '/name', value: '已提交' }],
              })
            ).revision,
          ).toBe(2);
      } finally {
        await reopened.close();
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
