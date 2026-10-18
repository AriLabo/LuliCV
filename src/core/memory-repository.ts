import { completeCreation, type CreationIdentity, type DuplicateSource } from './creation';
import { ResumeError } from './errors';
import { completeMutation } from './mutation';
import { receiptKey, type MutationIdentity, type Receipt, type ResumeRepository, type Transform } from './repository';
import type { ResumeDocument } from './types';
/** Reference transactional adapter used by protocol tests. All updates execute synchronously before resolving. */
export class MemoryRepository implements ResumeRepository {
  private creations = new Map<string, { fingerprint: string; result: ResumeDocument }>();
  private documents = new Map<string, ResumeDocument>();
  private previous = new Map<string, ResumeDocument>();
  private receipts = new Map<string, Receipt>();
  async list() {
    return structuredClone([...this.documents.values()]);
  }
  async get(id: string) {
    const document = this.documents.get(id);
    if (!document) throw new ResumeError('NOT_FOUND', id);
    return structuredClone(document);
  }
  async create(candidate: ResumeDocument, identity?: CreationIdentity, source?: DuplicateSource) {
    const receipt = identity && this.creations.get(identity.mutationId);
    if (receipt) {
      if (receipt.fingerprint !== identity!.fingerprint)
        throw new ResumeError('VALIDATION_FAILED', 'mutationId 已用于不同创建请求');
      return structuredClone(receipt.result);
    }
    const document = completeCreation(candidate, source, source && this.documents.get(source.id));
    if (this.documents.has(document.id)) throw new ResumeError('VALIDATION_FAILED', 'ID 已存在');
    this.documents.set(document.id, structuredClone(document));
    if (identity)
      this.creations.set(identity.mutationId, { fingerprint: identity.fingerprint, result: structuredClone(document) });
    return structuredClone(document);
  }
  async transact(id: string, request: MutationIdentity, transform: Transform) {
    const key = receiptKey(id, request.mutationId);
    const receipt = this.receipts.get(key);
    if (receipt) {
      if (receipt.fingerprint !== request.fingerprint)
        throw new ResumeError('VALIDATION_FAILED', 'mutationId 已用于不同请求');
      return structuredClone(receipt.result);
    }
    const current = this.documents.get(id);
    if (!current) throw new ResumeError('NOT_FOUND', id);
    const result = completeMutation(current, request.baseRevision, transform, this.previous.get(id));
    this.previous.set(id, current);
    if (result) this.documents.set(id, result);
    else this.documents.delete(id);
    this.receipts.set(key, { fingerprint: request.fingerprint, result });
    return structuredClone(result);
  }
}
