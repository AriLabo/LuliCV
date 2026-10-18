import { syncFile, syncDirectory } from '../runtime/files';
import { chmod, copyFile, lstat, mkdir, readFile, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { normalizeDocument } from '../../src/core/document';
import { ResumeError } from '../../src/core/errors';
import { atomicWrite } from './workspace';
import { SCHEMA_VERSION } from './sqlite-repository';
/** Restore only while Bridge is stopped. Validate a copied backup before touching the existing database. */
export async function restoreWorkspace(directory: string, input: string) {
  const root = await realpath(directory);
  const state = path.join(root, '.cvslate');
  if ((await lstat(state)).isSymbolicLink()) throw new ResumeError('VALIDATION_FAILED', '禁止符号链接工作区状态目录');
  const lock = path.join(state, 'lock');
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new ResumeError('WORKSPACE_LOCKED', '恢复前请停止 Bridge');
    throw error;
  }
  const temporary = path.join(root, `restore-${randomUUID()}.tmp`);
  let database: DatabaseSync | undefined;
  try {
    await atomicWrite(path.join(lock, 'owner.json'), { pid: process.pid });
    const source = await realpath(input);
    if (!(await lstat(source)).isFile()) throw new ResumeError('VALIDATION_FAILED', '需要 SQLite 备份文件');
    await copyFile(source, temporary);
    await chmod(temporary, 0o600);
    database = new DatabaseSync(temporary, { readOnly: true });
    if (Number(database.prepare('PRAGMA user_version').get()!.user_version) !== SCHEMA_VERSION)
      throw new ResumeError('VALIDATION_FAILED', '备份数据库版本不支持');
    const manifest = JSON.parse(await readFile(path.join(root, 'cvslate.json'), 'utf8'));
    if (
      database.prepare("SELECT value FROM workspace_meta WHERE key='workspace_id'").get()?.value !==
      manifest.workspaceId
    )
      throw new ResumeError('VALIDATION_FAILED', '备份属于另一个工作区');
    if (
      database.prepare('PRAGMA integrity_check').get()!.integrity_check !== 'ok' ||
      database.prepare('PRAGMA foreign_key_check').all().length
    )
      throw new ResumeError('VALIDATION_FAILED', '备份数据库完整性检查失败');
    for (const row of database
      .prepare('SELECT resume_id,revision,document_json FROM resume_revisions WHERE document_json IS NOT NULL')
      .all()) {
      const document = normalizeDocument(JSON.parse(String(row.document_json)));
      if (document.id !== row.resume_id || document.revision !== Number(row.revision))
        throw new ResumeError('VALIDATION_FAILED', '备份快照索引不一致');
    }
    const invalidHead = database
      .prepare(
        'SELECT 1 FROM resumes r LEFT JOIN resume_revisions v ON r.id=v.resume_id AND r.current_revision=v.revision WHERE v.revision IS NULL OR (r.deleted_at IS NULL AND v.kind!=?) OR (r.deleted_at IS NOT NULL AND v.kind!=?) LIMIT 1',
      )
      .get('document', 'deleted');
    if (invalidHead) throw new ResumeError('VALIDATION_FAILED', '备份 head 不一致');
    database.close();
    database = undefined;
    const file = path.join(root, 'cvslate.db');
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        if ((await lstat(file + suffix)).isSymbolicLink())
          throw new ResumeError('VALIDATION_FAILED', '禁止符号链接数据库');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    // Keep pre-restore state including WAL sidecars together, for manual recovery if necessary.
    const previous = path.join(state, `before-restore-${randomUUID()}`);
    await mkdir(previous, { mode: 0o700 });
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        await copyFile(file + suffix, path.join(previous, `cvslate.db${suffix}`));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    await syncFile(temporary);
    await atomicWrite(path.join(state, 'restore-pending.json'), { source, previous, temporary });
    // Remove old WAL before replacing the main file; no process may access the workspace while locked.
    await rm(file + '-wal', { force: true });
    await rm(file + '-shm', { force: true });
    await rename(temporary, file);
    await syncDirectory(root);
    await rm(path.join(state, 'runtime.json'), { force: true });
    await rm(path.join(state, 'restore-pending.json'), { force: true });
    await syncDirectory(state);
    return { restored: true, workspace: root, previousState: previous };
  } finally {
    database?.close();
    await rm(temporary, { force: true });
    await rm(temporary + '-wal', { force: true });
    await rm(temporary + '-shm', { force: true });
    await rm(lock, { recursive: true, force: true });
  }
}
