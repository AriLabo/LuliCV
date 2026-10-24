import { checkRuntime, checkSqlite } from '../runtime/version';
export { checkRuntime } from '../runtime/version';
import { completeCreation, type CreationIdentity, type DuplicateSource } from '../../src/core/creation';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rm, chmod, open } from 'node:fs/promises';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { normalizeDocument } from '../../src/core/document';
import { ResumeError } from '../../src/core/errors';
import { completeMutation, diffDocuments } from '../../src/core/mutation';
import { listChanges, summarizeChanges } from '../../src/core/change-summary';
import {
  defaultPrivacy,
  emptyStore,
  fillPrivate,
  normalizePrivacy,
  planPrivacy,
  privateFieldOptions,
  sealPrivate,
  setPrivateValue,
  type ExportLogEntry,
  type ExportOutcome,
  type PrivacyChoices,
  type PrivacyPlan,
  type PrivacySettings,
  type PrivateStore,
} from '../../src/core/privacy';
import type { MutationIdentity, ResumeRepository, Transform } from '../../src/core/repository';
import type { ResumeDocument } from '../../src/core/types';
import { atomicWrite } from './workspace';

export interface SourceChanges {
  sourceId: string;
  sourceName: string;
  fromRevision: number;
  toRevision: number;
  changes: string[];
  paths: string[];
}
/** A revision with what it changed relative to the one before it; the first revision is the creation. */
export interface RevisionSummary {
  revision: number;
  source: string;
  createdAt: number;
  paths: string[];
  created: boolean;
  changes: string[];
  /** Set when this revision restored an earlier one. */
  restoredFrom?: number;
}
export interface CommitEvent {
  resumeId: string;
  revision: number;
  mutationId: string;
  deleted?: boolean;
  source: string;
}
interface WriteContext {
  source: 'human' | 'agent' | 'system' | 'import';
  /** What privacy mode changed in the writes of this request. */ privacyNotes?: string[];
}
interface SnapshotRow {
  document_json: string | null;
}
export const SCHEMA_VERSION = 1;
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
function encoded(document: ResumeDocument) {
  const json = JSON.stringify(document);
  if (Buffer.byteLength(json) > MAX_DOCUMENT_BYTES) throw new ResumeError('VALIDATION_FAILED', '文档超过 8MB');
  return json;
}
function fingerprint(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
/** Node-only persistence. Transform callbacks are synchronous; no renderer/network work runs inside a transaction. */
export class SqliteRepository implements ResumeRepository {
  private readonly context = new AsyncLocalStorage<WriteContext>();
  private readonly listeners = new Set<(event: CommitEvent) => void>();
  private readonly storeListeners = new Set<() => void>();
  private closing = false;
  private readonly backups = new Set<Promise<void>>();
  private closeTask?: Promise<void>;
  private constructor(
    readonly root: string,
    private readonly database: DatabaseSync,
  ) {}

  static async open(directory: string) {
    checkRuntime();
    const root = await realpath(directory);
    const manifest = JSON.parse(await readFile(path.join(root, 'lulicv.json'), 'utf8'));
    if (
      manifest.workspaceVersion !== 1 ||
      typeof manifest.workspaceId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(manifest.workspaceId)
    ) {
      throw new ResumeError('VALIDATION_FAILED', '工作区 manifest 无效');
    }
    for (const relative of ['.lulicv', 'assets']) {
      if ((await lstat(path.join(root, relative))).isSymbolicLink())
        throw new ResumeError('VALIDATION_FAILED', '禁止符号链接目录');
    }
    try {
      await lstat(path.join(root, '.lulicv/restore-pending.json'));
      throw new ResumeError('STORAGE_FAILED', '工作区恢复未完成，请重新运行 restore-workspace');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const file = path.join(root, 'lulicv.db');
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        if ((await lstat(file + suffix)).isSymbolicLink())
          throw new ResumeError('VALIDATION_FAILED', '禁止符号链接数据库');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    const lock = path.join(root, '.lulicv/lock');
    try {
      await mkdir(lock);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new ResumeError('WORKSPACE_LOCKED', '工作区已有 Bridge；异常退出后使用 lulicv unlock');
      throw error;
    }
    let database: DatabaseSync | undefined;
    try {
      await atomicWrite(path.join(lock, 'owner.json'), { pid: process.pid });
      const reservation = await open(file, 'a', 0o600);
      await reservation.close();
      await chmod(file, 0o600);
      database = new DatabaseSync(file, { timeout: 250 });
      checkSqlite(String(database.prepare('SELECT sqlite_version() AS version').get()!.version));
      database.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;');
      const schema = Number(database.prepare('PRAGMA user_version').get()!.user_version);
      if (schema > SCHEMA_VERSION) throw new ResumeError('STORAGE_FAILED', '数据库版本较新，请升级履栗');
      if (schema === 0) {
        database.exec(`BEGIN IMMEDIATE;
          CREATE TABLE workspace_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE resumes (id TEXT PRIMARY KEY, current_revision INTEGER NOT NULL CHECK(current_revision>0), deleted_at INTEGER);
          CREATE TABLE resume_revisions (
            resume_id TEXT NOT NULL REFERENCES resumes(id), revision INTEGER NOT NULL CHECK(revision>0),
            document_json TEXT, kind TEXT NOT NULL CHECK(kind IN ('document','deleted')), source TEXT NOT NULL, created_at INTEGER NOT NULL,
            PRIMARY KEY(resume_id, revision), CHECK((kind='document' AND document_json IS NOT NULL) OR (kind='deleted' AND document_json IS NULL))
          );
          CREATE TABLE mutations (
            resume_id TEXT NOT NULL, mutation_id TEXT NOT NULL, request_fingerprint TEXT NOT NULL,
            result_revision INTEGER NOT NULL, created_at INTEGER NOT NULL,
            PRIMARY KEY(resume_id, mutation_id), FOREIGN KEY(resume_id,result_revision) REFERENCES resume_revisions(resume_id,revision)
          );
          CREATE TABLE creations (
            mutation_id TEXT PRIMARY KEY, request_fingerprint TEXT NOT NULL, resume_id TEXT NOT NULL,
            result_revision INTEGER NOT NULL CHECK(result_revision=1), created_at INTEGER NOT NULL,
            FOREIGN KEY(resume_id,result_revision) REFERENCES resume_revisions(resume_id,revision)
          );
          -- Privacy mode's values live apart from the resumes, which hold tokens; only this repository reads them.
          CREATE TABLE private_values (key TEXT PRIMARY KEY, value TEXT NOT NULL, label TEXT);
          CREATE TABLE private_aliases (key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(key, value));
          -- Exports that filled in the private values: when, which revision, and how. Never the PDF.
          CREATE TABLE export_log (
            at INTEGER NOT NULL, resume_id TEXT NOT NULL, resume_name TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), pages INTEGER,
            outcome TEXT NOT NULL CHECK(outcome IN ('approved','declined','expired','web'))
          );
          -- Browsers signed in to this workspace. Only a hash of each cookie is kept, so a copy of the database signs no one in.
          CREATE TABLE browser_sessions (hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
          PRAGMA user_version=${SCHEMA_VERSION};`);
        database.prepare('INSERT INTO workspace_meta VALUES (?,?)').run('workspace_id', manifest.workspaceId);
        database.exec('COMMIT');
      }
      const workspaceId = database.prepare("SELECT value FROM workspace_meta WHERE key='workspace_id'").get()?.value;
      if (workspaceId !== manifest.workspaceId) throw new ResumeError('VALIDATION_FAILED', '数据库与工作区 ID 不匹配');
      // Added after schema 1 shipped; a workspace without it gains it here, and an older runtime just never reads it.
      database.exec(`CREATE TABLE IF NOT EXISTS restores (
        resume_id TEXT NOT NULL, revision INTEGER NOT NULL, restored_from INTEGER NOT NULL,
        PRIMARY KEY(resume_id, revision), FOREIGN KEY(resume_id,revision) REFERENCES resume_revisions(resume_id,revision)
      )`);
      const mode = database.prepare('PRAGMA journal_mode=WAL').get()!.journal_mode;
      if (mode !== 'wal') throw new ResumeError('STORAGE_FAILED', '无法启用 SQLite WAL');
      const repository = new SqliteRepository(root, database);
      // Fail closed on invalid current documents instead of seeding over a damaged workspace.
      await repository.list();
      return repository;
    } catch (error) {
      database?.close();
      await rm(lock, { recursive: true, force: true });
      throw error;
    }
  }

  withContext<T>(context: WriteContext, work: () => Promise<T>): Promise<T> {
    return this.context.run(context, work);
  }
  subscribe(listener: (event: CommitEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  /** Called when a write takes a new private value into the store, e.g. a link address typed into a resume. */
  onPrivateStore(listener: () => void) {
    this.storeListeners.add(listener);
    return () => {
      this.storeListeners.delete(listener);
    };
  }
  private ensureOpen() {
    if (this.closing) throw new ResumeError('STORAGE_FAILED', '工作区已关闭');
  }
  private transaction<T>(work: () => T): T {
    this.ensureOpen();
    try {
      this.database.exec('BEGIN IMMEDIATE');
    } catch (error) {
      throw new ResumeError('STORAGE_FAILED', `数据库忙或无法启动事务: ${String(error)}`);
    }
    try {
      const result = work();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
  private snapshot(id: string, revision: number): ResumeDocument | null {
    const row = this.database
      .prepare('SELECT document_json FROM resume_revisions WHERE resume_id=? AND revision=?')
      .get(id, revision) as unknown as SnapshotRow | undefined;
    if (!row) throw new ResumeError('STORAGE_FAILED', '版本快照缺失');
    if (row.document_json === null) return null;
    const document = normalizeDocument(JSON.parse(row.document_json));
    if (document.id !== id || document.revision !== revision)
      throw new ResumeError('STORAGE_FAILED', '版本快照与索引不匹配');
    return document;
  }
  /**
   * What changed in the resume's source content since it was copied: JSON Pointers under /data
   * between the source snapshot at the recorded revision and the source's current head.
   * Null when the resume has no source or the source no longer exists.
   */
  async sourceChanges(id: string): Promise<SourceChanges | null> {
    const document = await this.get(id);
    if (!document.source) return null;
    const head = this.database
      .prepare('SELECT current_revision FROM resumes WHERE id=? AND deleted_at IS NULL')
      .get(document.source.id);
    if (!head) return null;
    const current = this.snapshot(document.source.id, Number(head.current_revision));
    const before = this.snapshot(document.source.id, document.source.revision);
    if (!current || !before) return null;
    const contentOnly = (snapshot: ResumeDocument) => ({
      ...snapshot,
      name: '',
      appearance: current.appearance,
      target: undefined,
      parentId: undefined,
      purpose: undefined,
      sample: undefined,
      source: undefined,
    });
    // A change already carried over (the copy now holds the source's value) no longer needs attention.
    const pending = (value: (snapshot: ResumeDocument) => unknown) =>
      JSON.stringify(value(document)) !== JSON.stringify(value(current));
    const changes = [
      ...new Set(
        listChanges(contentOnly(before), contentOnly(current))
          .filter((change) => pending(change.pick))
          .map((change) => change.label),
      ),
    ];
    const paths = diffDocuments(contentOnly(before), contentOnly(current))
      .map((operation) => operation.path)
      .filter((path) => pending((snapshot) => valueAt(snapshot, path)));
    return {
      sourceId: current.id,
      sourceName: current.name,
      fromRevision: document.source.revision,
      toRevision: current.revision,
      changes,
      paths,
    };
  }
  /** A past revision of a live resume, as it was committed. */
  async at(id: string, revision: number): Promise<ResumeDocument> {
    this.ensureOpen();
    const row = this.database.prepare('SELECT current_revision FROM resumes WHERE id=? AND deleted_at IS NULL').get(id);
    if (!row) throw new ResumeError('NOT_FOUND', id);
    if (!Number.isSafeInteger(revision) || revision < 1 || revision > Number(row.current_revision))
      throw new ResumeError('VALIDATION_FAILED', `revision 必须在 1–${row.current_revision} 之间`);
    const document = this.snapshot(id, revision);
    if (!document) throw new ResumeError('NOT_FOUND', `${id} r${revision} 是删除记录`);
    return document;
  }
  /** Recent revisions, newest first, with what each one changed relative to its predecessor. */
  async history(id: string, limit = 40): Promise<RevisionSummary[]> {
    this.ensureOpen();
    if (!this.database.prepare('SELECT 1 FROM resumes WHERE id=? AND deleted_at IS NULL').get(id))
      throw new ResumeError('NOT_FOUND', id);
    const rows = this.database
      .prepare(
        `SELECT r.revision, r.source, r.created_at, r.document_json, x.restored_from
         FROM resume_revisions r LEFT JOIN restores x ON x.resume_id=r.resume_id AND x.revision=r.revision
         WHERE r.resume_id=? ORDER BY r.revision DESC LIMIT ?`,
      )
      .all(id, limit + 1) as Array<{
      revision: number;
      source: string;
      created_at: number;
      document_json: string | null;
      restored_from: number | null;
    }>;
    const documents = rows.map((row) =>
      row.document_json === null ? null : (JSON.parse(row.document_json) as ResumeDocument),
    );
    return rows.slice(0, limit).map((row, index) => {
      const current = documents[index],
        previous = documents[index + 1];
      const created = Number(row.revision) === 1;
      // `paths` stays as it was for clients built before `changes`; `['/']` marks the creation.
      const paths = created
        ? ['/']
        : current && previous
          ? diffDocuments(previous, current)
              .map((operation) => operation.path)
              .slice(0, 20)
          : [];
      // Labels come from both versions, so a deleted section or entry is named from the one that still had it.
      const changes = !created && current && previous ? summarizeChanges(previous, current) : [];
      const restoredFrom = row.restored_from === null ? undefined : Number(row.restored_from);
      return {
        revision: Number(row.revision),
        source: String(row.source),
        createdAt: Number(row.created_at),
        paths,
        created,
        changes,
        ...(restoredFrom ? { restoredFrom } : {}),
      };
    });
  }
  /** The workspace's privacy mode. An unreadable setting hides every field rather than none. */
  privacy(): PrivacySettings {
    this.ensureOpen();
    const row = this.database.prepare("SELECT value FROM workspace_meta WHERE key='privacy'").get();
    if (!row) return structuredClone(defaultPrivacy);
    try {
      return normalizePrivacy(JSON.parse(String(row.value)));
    } catch {
      return { enabled: true, fields: privateFieldOptions.map((option) => option.id) };
    }
  }
  /** The stored private values. Never leaves the Bridge except filled into a render or an export. */
  privateStore(): PrivateStore {
    this.ensureOpen();
    const store = emptyStore();
    for (const row of this.database.prepare('SELECT key,value,label FROM private_values ORDER BY rowid').all()) {
      store.values[String(row.key)] = String(row.value);
      if (row.label !== null) store.labels[String(row.key)] = String(row.label);
    }
    store.aliases = this.database
      .prepare('SELECT key,value FROM private_aliases ORDER BY rowid')
      .all()
      .map((row) => ({ key: String(row.key), value: String(row.value) }));
    return store;
  }
  private writeStore(store: PrivateStore) {
    this.database.exec('DELETE FROM private_values; DELETE FROM private_aliases;');
    const value = this.database.prepare('INSERT INTO private_values VALUES (?,?,?)'),
      alias = this.database.prepare('INSERT OR IGNORE INTO private_aliases VALUES (?,?)');
    for (const [key, text] of Object.entries(store.values)) value.run(key, text, store.labels[key] ?? null);
    for (const item of store.aliases) alias.run(item.key, item.value);
  }
  fill(document: ResumeDocument): ResumeDocument {
    return fillPrivate(document, this.privacy(), this.privateStore());
  }
  /** Notes on what privacy mode changed in this request's writes, e.g. a phone number replaced by its token. */
  privacyNotes(): string[] {
    return this.context.getStore()?.privacyNotes ?? [];
  }
  /**
   * Turns privacy mode on or off or changes its fields, moving values between the resumes and the store in one
   * transaction (each changed resume gets a revision). With conflicts, or when only planning, nothing is written.
   */
  changePrivacy(next: PrivacySettings, choices: PrivacyChoices = {}, apply = true): PrivacyPlan<ResumeDocument> {
    const settings = normalizePrivacy(next);
    const events: CommitEvent[] = [];
    const plan = this.transaction(() => {
      const documents = this.currentDocuments();
      // Every revision of a live resume: older values become aliases, so history reads stay covered.
      const history = this.database
        .prepare(
          "SELECT r.document_json FROM resume_revisions r JOIN resumes h ON h.id=r.resume_id WHERE h.deleted_at IS NULL AND r.kind='document'",
        )
        .all()
        .map((row) => JSON.parse(String(row.document_json)) as ResumeDocument);
      const plan = planPrivacy(
        { settings: this.privacy(), store: this.privateStore(), documents, history },
        settings,
        choices,
      );
      if (!apply || plan.conflicts.length) return plan;
      for (const changed of plan.documents) {
        const current = documents.find((document) => document.id === changed.id)!;
        const result = completeMutation(current, current.revision, () => changed)!;
        this.insertSnapshot(current.id, result.revision, result);
        const update = this.database
          .prepare('UPDATE resumes SET current_revision=? WHERE id=? AND current_revision=?')
          .run(result.revision, current.id, current.revision);
        if (update.changes !== 1) throw new ResumeError('STORAGE_FAILED', '数据库 head 更新失败');
        events.push({
          resumeId: current.id,
          revision: result.revision,
          mutationId: `privacy-${result.revision}`,
          source: this.source(),
        });
      }
      this.writeStore(plan.store);
      this.database
        .prepare("INSERT INTO workspace_meta VALUES ('privacy', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .run(JSON.stringify(plan.settings));
      return plan;
    });
    for (const event of events) this.publish(event);
    return plan;
  }
  /** Replaces one stored value; the old one is kept as an alias so older revisions stay covered. */
  setPrivateValue(key: string, value: unknown) {
    this.transaction(() => this.writeStore(setPrivateValue(this.privacy(), this.privateStore(), key, value)));
  }
  /** Adds one export to the log, keeping the latest 50. */
  logExport(entry: ExportLogEntry) {
    this.transaction(() => {
      this.database
        .prepare('INSERT INTO export_log VALUES (?,?,?,?,?,?)')
        .run(entry.at, entry.resumeId, entry.name, entry.revision, entry.pages ?? null, entry.outcome);
      this.database.exec(
        'DELETE FROM export_log WHERE rowid NOT IN (SELECT rowid FROM export_log ORDER BY rowid DESC LIMIT 50)',
      );
    });
  }
  /** Keeps a new browser sign-in; the oldest beyond the newest 20 lapse, as do expired ones. */
  addBrowserSession(secret: string, expiresAt: number) {
    this.transaction(() => {
      this.database.prepare('DELETE FROM browser_sessions WHERE expires_at<=?').run(Date.now());
      this.database
        .prepare('INSERT INTO browser_sessions VALUES (?,?,?)')
        .run(fingerprint(secret), Date.now(), expiresAt);
      this.database.exec(
        'DELETE FROM browser_sessions WHERE rowid NOT IN (SELECT rowid FROM browser_sessions ORDER BY created_at DESC, rowid DESC LIMIT 20)',
      );
    });
  }
  /** Whether the cookie belongs to a browser signed in here that has not expired. */
  hasBrowserSession(secret: string): boolean {
    this.ensureOpen();
    return !!this.database
      .prepare('SELECT 1 FROM browser_sessions WHERE hash=? AND expires_at>?')
      .get(fingerprint(secret), Date.now());
  }
  /** The export log, newest first. */
  exportLog(): ExportLogEntry[] {
    this.ensureOpen();
    return this.database
      .prepare('SELECT * FROM export_log ORDER BY rowid DESC')
      .all()
      .map((row) => ({
        at: Number(row.at),
        resumeId: String(row.resume_id),
        name: String(row.resume_name),
        revision: Number(row.revision),
        ...(row.pages === null ? {} : { pages: Number(row.pages) }),
        outcome: String(row.outcome) as ExportOutcome,
      }));
  }
  private currentDocuments(): ResumeDocument[] {
    return this.database
      .prepare('SELECT id,current_revision FROM resumes WHERE deleted_at IS NULL ORDER BY id')
      .all()
      .map((row) => {
        const document = this.snapshot(String(row.id), Number(row.current_revision));
        if (!document) throw new ResumeError('STORAGE_FAILED', '当前简历指向删除快照');
        return document;
      });
  }
  /** Privacy mode's rule for anything stored: real private values become tokens, inside the write's transaction. */
  private seal(document: ResumeDocument, before?: ResumeDocument): ResumeDocument {
    const settings = this.privacy();
    // With privacy mode off, only a restored revision's leftover tokens need anything done.
    if (!settings.enabled && !JSON.stringify(document).includes('{{private:')) return document;
    const store = this.privateStore();
    const sealed = sealPrivate(document, settings, store, before);
    if (JSON.stringify(sealed.store) !== JSON.stringify(store)) {
      this.writeStore(sealed.store);
      // After the write's transaction has committed or rolled back; a spurious call only makes clients re-read.
      setImmediate(() => {
        for (const listener of this.storeListeners) listener();
      });
    }
    this.context.getStore()?.privacyNotes?.push(...sealed.notes);
    return sealed.document;
  }
  async list(): Promise<ResumeDocument[]> {
    this.ensureOpen();
    return this.currentDocuments();
  }
  async get(id: string): Promise<ResumeDocument> {
    this.ensureOpen();
    const row = this.database.prepare('SELECT current_revision FROM resumes WHERE id=? AND deleted_at IS NULL').get(id);
    if (!row) throw new ResumeError('NOT_FOUND', id);
    const document = this.snapshot(id, Number(row.current_revision));
    if (!document) throw new ResumeError('STORAGE_FAILED', '当前简历快照无效');
    return document;
  }
  async create(
    candidate: ResumeDocument,
    identity?: CreationIdentity,
    source?: DuplicateSource,
  ): Promise<ResumeDocument> {
    let event: CommitEvent | undefined;
    const document = this.transaction(() => {
      const receipt =
        identity &&
        this.database
          .prepare('SELECT request_fingerprint,resume_id,result_revision FROM creations WHERE mutation_id=?')
          .get(identity.mutationId);
      if (receipt) {
        if (receipt.request_fingerprint !== fingerprint(identity!.fingerprint))
          throw new ResumeError('VALIDATION_FAILED', 'mutationId 已用于不同创建请求');
        const snapshot = this.snapshot(String(receipt.resume_id), Number(receipt.result_revision));
        if (!snapshot) throw new ResumeError('STORAGE_FAILED', '创建快照缺失');
        return snapshot;
      }
      let current: ResumeDocument | undefined;
      if (source) {
        const head = this.database
          .prepare('SELECT current_revision FROM resumes WHERE id=? AND deleted_at IS NULL')
          .get(source.id);
        if (head) current = this.snapshot(source.id, Number(head.current_revision))!;
      }
      const result = this.seal(completeCreation(candidate, source, current));
      if (this.database.prepare('SELECT 1 FROM resumes WHERE id=?').get(result.id))
        throw new ResumeError('VALIDATION_FAILED', '文档 ID 不可复用');
      this.database.prepare('INSERT INTO resumes VALUES (?,1,NULL)').run(result.id);
      this.insertSnapshot(result.id, 1, result);
      if (identity)
        this.database
          .prepare('INSERT INTO creations VALUES (?,?,?,?,?)')
          .run(identity.mutationId, fingerprint(identity.fingerprint), result.id, 1, Date.now());
      event = {
        resumeId: result.id,
        revision: 1,
        mutationId: identity?.mutationId ?? `create-${result.id}`,
        source: this.source(),
      };
      return result;
    });
    if (event) this.publish(event);
    return document;
  }
  private source() {
    return this.context.getStore()?.source ?? 'system';
  }
  private insertSnapshot(id: string, revision: number, document: ResumeDocument | null) {
    this.database
      .prepare('INSERT INTO resume_revisions VALUES (?,?,?,?,?,?)')
      .run(
        id,
        revision,
        document ? encoded(document) : null,
        document ? 'document' : 'deleted',
        this.source(),
        Date.now(),
      );
  }
  async transact(id: string, identity: MutationIdentity, transform: Transform): Promise<ResumeDocument | null> {
    let event: CommitEvent | undefined;
    const result = this.transaction(() => {
      const digest = fingerprint(identity.fingerprint);
      const receipt = this.database
        .prepare('SELECT request_fingerprint,result_revision FROM mutations WHERE resume_id=? AND mutation_id=?')
        .get(id, identity.mutationId);
      if (receipt) {
        if (receipt.request_fingerprint !== digest)
          throw new ResumeError('VALIDATION_FAILED', 'mutationId 已用于不同请求');
        return this.snapshot(id, Number(receipt.result_revision));
      }
      const head = this.database
        .prepare('SELECT current_revision FROM resumes WHERE id=? AND deleted_at IS NULL')
        .get(id);
      if (!head) throw new ResumeError('NOT_FOUND', id);
      const revision = Number(head.current_revision);
      const current = this.snapshot(id, revision)!;
      const mutated = completeMutation(current, identity.baseRevision, transform, (past) => {
        if (!Number.isSafeInteger(past) || past < 1 || past > revision)
          throw new ResumeError('VALIDATION_FAILED', `revision 必须在 1–${revision} 之间`);
        const document = this.snapshot(id, past);
        if (!document) throw new ResumeError('NOT_FOUND', `${id} r${past} 是删除记录`);
        return document;
      });
      const next = mutated && this.seal(mutated, current);
      this.insertSnapshot(id, revision + 1, next);
      const update = this.database
        .prepare('UPDATE resumes SET current_revision=?,deleted_at=? WHERE id=? AND current_revision=?')
        .run(revision + 1, next ? null : Date.now(), id, revision);
      if (update.changes !== 1) throw new ResumeError('STORAGE_FAILED', '数据库 head 更新失败');
      this.database
        .prepare('INSERT INTO mutations VALUES (?,?,?,?,?)')
        .run(id, identity.mutationId, digest, revision + 1, Date.now());
      if (next && identity.restoredFrom)
        this.database.prepare('INSERT INTO restores VALUES (?,?,?)').run(id, revision + 1, identity.restoredFrom);
      event = {
        resumeId: id,
        revision: revision + 1,
        mutationId: identity.mutationId,
        deleted: !next,
        source: this.source(),
      };
      return next;
    });
    if (event) this.publish(event);
    return result;
  }
  private publish(event: CommitEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        process.stderr.write(`Commit listener failed: ${String(error)}\n`);
      }
    }
  }
  backupTo(output: string): Promise<void> {
    this.ensureOpen();
    const task = (async () => {
      const reservation = await open(output, 'wx', 0o600);
      await reservation.close();
      try {
        await backup(this.database, output);
      } catch (error) {
        await rm(output, { force: true });
        throw error;
      }
    })();
    this.backups.add(task);
    void task.finally(() => this.backups.delete(task)).catch(() => {});
    return task;
  }
  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.closing = true;
    this.closeTask = (async () => {
      await Promise.allSettled([...this.backups]);
      this.database.close();
      await rm(path.join(this.root, '.lulicv/runtime.json'), { force: true });
      await rm(path.join(this.root, '.lulicv/lock'), { recursive: true, force: true });
    })();
    return this.closeTask;
  }
}

function valueAt(document: unknown, path: string): unknown {
  let value = document;
  for (const part of path
    .split('/')
    .slice(1)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}
