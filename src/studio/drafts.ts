import type { ResumeDocument } from '../core/types';
import { requestValue } from './browser-repository';
export interface Draft {
  local: ResumeDocument;
  baseRevision: number;
}
export class DraftRepository {
  private readonly database: Promise<IDBDatabase>;
  private readonly writes = new Map<string, Promise<void>>();
  constructor(private readonly namespace: string) {
    const request = indexedDB.open('lulicv-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    this.database = requestValue(request);
  }
  private key(id: string) {
    return `${this.namespace}:${id}`;
  }
  async get(id: string): Promise<Draft | undefined> {
    const db = await this.database;
    return requestValue(db.transaction('drafts').objectStore('drafts').get(this.key(id)));
  }
  async list(): Promise<Draft[]> {
    const db = await this.database;
    return requestValue(
      db
        .transaction('drafts')
        .objectStore('drafts')
        .getAll(IDBKeyRange.bound(`${this.namespace}:`, `${this.namespace}:\uffff`)),
    );
  }
  private enqueue(id: string, draft?: Draft): Promise<void> {
    const task = (this.writes.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const db = await this.database;
        const tx = db.transaction('drafts', 'readwrite');
        const done = new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onabort = tx.onerror = () => reject(tx.error);
        });
        if (draft) tx.objectStore('drafts').put(draft, this.key(id));
        else tx.objectStore('drafts').delete(this.key(id));
        await done;
      });
    this.writes.set(id, task);
    void task
      .finally(() => {
        if (this.writes.get(id) === task) this.writes.delete(id);
      })
      .catch(() => {});
    return task;
  }
  save(id: string, draft: Draft) {
    return this.enqueue(id, structuredClone(draft));
  }
  remove(id: string) {
    return this.enqueue(id);
  }
}
