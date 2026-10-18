import { randomUUID } from 'node:crypto';
import { ResumeError } from '../../src/core/errors';
import { CHANGED_AFTER_REQUEST, type ExportLogEntry, type ExportRequest } from '../../src/core/privacy';

/** How long an agent's export request waits for the person before it counts as declined. */
export const EXPORT_APPROVAL_MS = 5 * 60 * 1000;
/** How long a finished request can still be asked about, so an agent that polls late still learns the outcome. */
const KEEP_FINISHED_MS = 10 * 60 * 1000;

interface Entry {
  request: ExportRequest;
  timer: NodeJS.Timeout;
  waiters: Set<() => void>;
  busy: boolean;
}

/**
 * Agents' export requests in privacy mode. One waits at a time; the person approves or declines it in the web page,
 * or it expires. Only the requested revision is ever exported. Every change is announced to the web pages and every
 * outcome goes to the export log.
 */
export class ExportApprovals {
  private readonly entries = new Map<string, Entry>();
  constructor(
    private readonly options: {
      timeout?: number;
      announce(request: ExportRequest): void;
      log(entry: ExportLogEntry): void;
    },
  ) {}
  pending(): ExportRequest[] {
    return [...this.entries.values()]
      .filter((entry) => entry.request.status === 'pending')
      .map((entry) => structuredClone(entry.request));
  }
  /** The request already waiting for this revision; another one waiting means this one has to wait its turn. */
  existing(resumeId: string, revision: number): ExportRequest | undefined {
    const waiting = this.pending()[0];
    if (!waiting) return undefined;
    if (waiting.resumeId === resumeId && waiting.revision === revision) return waiting;
    throw new ResumeError(
      'EXPORT_PENDING',
      `已有一个导出请求（${waiting.name} 第 ${waiting.revision} 版）在等用户处理，等它结束后再请求`,
    );
  }
  open(input: Pick<ExportRequest, 'resumeId' | 'name' | 'revision' | 'pages' | 'fields'>): ExportRequest {
    const waiting = this.existing(input.resumeId, input.revision);
    if (waiting) return waiting;
    const timeout = this.options.timeout ?? EXPORT_APPROVAL_MS;
    const request: ExportRequest = {
      ...input,
      requestId: randomUUID(),
      expiresAt: Date.now() + timeout,
      changed: false,
      status: 'pending',
    };
    const entry: Entry = {
      request,
      waiters: new Set(),
      busy: false,
      timer: setTimeout(() => {
        if (!entry.busy) this.finish(entry, 'expired');
      }, timeout),
    };
    this.entries.set(request.requestId, entry);
    this.options.announce(structuredClone(request));
    return structuredClone(request);
  }
  get(requestId: string): ExportRequest {
    return structuredClone(this.entry(requestId).request);
  }
  /** The request once it is no longer pending, or as it is after `ms`. */
  async wait(requestId: string, ms: number): Promise<ExportRequest> {
    const entry = this.entry(requestId);
    if (entry.request.status === 'pending' && ms > 0)
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          entry.waiters.delete(done);
          resolve();
        };
        const timer = setTimeout(done, ms);
        entry.waiters.add(done);
      });
    return this.get(requestId);
  }
  /** A save after the request: the requested revision is no longer the current one, so it can no longer be approved. */
  changed(resumeId: string, revision: number) {
    for (const entry of this.entries.values())
      if (
        entry.request.status === 'pending' &&
        entry.request.resumeId === resumeId &&
        entry.request.revision !== revision &&
        !entry.request.changed
      ) {
        entry.request.changed = true;
        this.options.announce(structuredClone(entry.request));
      }
  }
  /** Exports an approved request. If the export fails the request keeps waiting, unless its time ran out meanwhile. */
  async approve<T>(
    requestId: string,
    run: (request: ExportRequest) => Promise<{ result: T; pages: number }>,
  ): Promise<T> {
    const entry = this.waiting(requestId);
    if (entry.busy) throw new ResumeError('EXPORT_PENDING', '这个请求正在导出');
    if (entry.request.changed) throw new ResumeError('REVISION_CONFLICT', CHANGED_AFTER_REQUEST);
    entry.busy = true;
    try {
      const { result, pages } = await run(structuredClone(entry.request));
      this.finish(entry, 'approved', pages);
      return result;
    } finally {
      entry.busy = false;
      if (entry.request.status === 'pending' && Date.now() >= entry.request.expiresAt) this.finish(entry, 'expired');
    }
  }
  decline(requestId: string) {
    const entry = this.waiting(requestId);
    if (entry.busy) throw new ResumeError('EXPORT_PENDING', '这个请求正在导出');
    this.finish(entry, 'declined');
  }
  close() {
    for (const entry of this.entries.values()) {
      clearTimeout(entry.timer);
      for (const done of [...entry.waiters]) done();
    }
    this.entries.clear();
  }
  private entry(requestId: string): Entry {
    const entry = this.entries.get(requestId);
    if (!entry) throw new ResumeError('NOT_FOUND', '导出请求不存在或已过期');
    return entry;
  }
  private waiting(requestId: string): Entry {
    const entry = this.entry(requestId);
    if (entry.request.status !== 'pending')
      throw new ResumeError(
        'EXPORT_DECLINED',
        entry.request.status === 'approved' ? '这个请求已经导出过了' : '这个导出请求已结束',
      );
    return entry;
  }
  private finish(entry: Entry, status: Exclude<ExportRequest['status'], 'pending'>, pages?: number) {
    if (entry.request.status !== 'pending') return;
    clearTimeout(entry.timer);
    const { request } = entry;
    request.status = status;
    if (pages !== undefined) request.pages = pages;
    this.options.log({
      at: Date.now(),
      resumeId: request.resumeId,
      name: request.name,
      revision: request.revision,
      ...(status === 'approved' ? { pages: request.pages } : {}),
      outcome: status,
    });
    this.options.announce(structuredClone(request));
    for (const done of [...entry.waiters]) done();
    entry.timer = setTimeout(() => this.entries.delete(request.requestId), KEEP_FINISHED_MS);
    entry.timer.unref();
  }
}
