import { completeCreation, type CreationIdentity, type DuplicateSource } from '../core/creation';
import { normalizeDocument } from '../core/document';
import { ResumeError } from '../core/errors';
import { completeMutation } from '../core/mutation';
import {
  receiptKey,
  type MutationIdentity,
  type Receipt,
  type ResumeRepository,
  type Transform,
} from '../core/repository';
import type { ResumeDocument } from '../core/types';
export interface CommitEvent {
  resumeId: string;
  revision: number;
  mutationId: string;
  deleted?: boolean;
  source?: string;
  paths?: string[];
}
export interface ObservableRepository extends ResumeRepository {
  subscribe(listener: (event: CommitEvent) => void): () => void;
}
export function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new ResumeError('STORAGE_FAILED', '事务中止'));
  });
}
export class BrowserRepository implements ObservableRepository {
  private listeners = new Set<(event: CommitEvent) => void>();
  private channel: BroadcastChannel | undefined;
  private readonly db: Promise<IDBDatabase>;
  constructor(name = 'lulicv') {
    this.db = this.open(name);
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(`${name}:commits`);
      this.channel.onmessage = (event: MessageEvent<CommitEvent>) => {
        for (const listener of this.listeners) listener(event.data);
      };
    }
  }
  private async open(name: string) {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      for (const store of ['documents', 'receipts', 'creations']) request.result.createObjectStore(store);
    };
    const db = await requestValue(request);
    db.onversionchange = () => db.close();
    return db;
  }
  subscribe(listener: (event: CommitEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private publish(event: CommitEvent) {
    this.channel?.postMessage(event);
    for (const listener of this.listeners) listener(event);
  }
  async close() {
    this.channel?.close();
    (await this.db).close();
  }
  async list() {
    const db = await this.db;
    return (await requestValue<ResumeDocument[]>(db.transaction('documents').objectStore('documents').getAll())).map(
      normalizeDocument,
    );
  }
  async get(id: string) {
    const db = await this.db;
    const document: unknown = await requestValue(db.transaction('documents').objectStore('documents').get(id));
    if (!document) throw new ResumeError('NOT_FOUND', id);
    return normalizeDocument(document);
  }
  async create(candidate: ResumeDocument, identity?: CreationIdentity, source?: DuplicateSource) {
    const db = await this.db;
    const tx = db.transaction(['documents', 'creations'], 'readwrite');
    const done = completed(tx);
    void done.catch(() => {});
    try {
      const receipt: Receipt | undefined =
        identity && (await requestValue(tx.objectStore('creations').get(identity.mutationId)));
      if (receipt) {
        if (receipt.fingerprint !== identity!.fingerprint)
          throw new ResumeError('VALIDATION_FAILED', 'mutationId 已用于不同创建请求');
        await done;
        return structuredClone(receipt.result!);
      }
      const current: ResumeDocument | undefined =
        source && (await requestValue(tx.objectStore('documents').get(source.id)));
      const document = completeCreation(candidate, source, current);
      tx.objectStore('documents').add(document, document.id);
      if (identity)
        tx.objectStore('creations').add(
          { fingerprint: identity.fingerprint, result: document } satisfies Receipt,
          identity.mutationId,
        );
      await done;
      this.publish({ resumeId: document.id, revision: 1, mutationId: identity?.mutationId ?? `create-${document.id}` });
      return structuredClone(document);
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* Already completed or aborted. */
      }
      throw error;
    }
  }
  async transact(id: string, identity: MutationIdentity, transform: Transform) {
    const db = await this.db;
    const tx = db.transaction(['documents', 'receipts'], 'readwrite');
    const done = completed(tx);
    void done.catch(() => {});
    try {
      const key = receiptKey(id, identity.mutationId);
      const receipt: Receipt | undefined = await requestValue(tx.objectStore('receipts').get(key));
      if (receipt) {
        if (receipt.fingerprint !== identity.fingerprint)
          throw new ResumeError('VALIDATION_FAILED', 'mutationId 已用于不同请求');
        await done;
        return receipt.result;
      }
      const current: ResumeDocument | undefined = await requestValue(tx.objectStore('documents').get(id));
      if (!current) throw new ResumeError('NOT_FOUND', id);
      // Browser storage keeps only the current version; past revisions live in the workspace's SQLite.
      const result = completeMutation(current, identity.baseRevision, transform);
      if (result) tx.objectStore('documents').put(result, id);
      else tx.objectStore('documents').delete(id);
      tx.objectStore('receipts').put({ fingerprint: identity.fingerprint, result } satisfies Receipt, key);
      await done;
      this.publish({ resumeId: id, revision: current.revision + 1, mutationId: identity.mutationId, deleted: !result });
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* Completed or aborted transaction. */
      }
      throw error;
    }
  }
}
