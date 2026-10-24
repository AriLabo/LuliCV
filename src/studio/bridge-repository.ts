import type { CreationIdentity, DuplicateSource } from '../core/creation';
import { ResumeError, type ErrorCode } from '../core/errors';
import type { MutationIdentity, Transform } from '../core/repository';
import type { ResumeDocument } from '../core/types';
import type { ExportRequest } from '../core/privacy';
import type { CommitEvent, ObservableRepository } from './browser-repository';
import { openEvents, type EventStream } from './shared-events';
export interface TreeSummaryNode {
  id: string;
  sourceChanges?: number;
  children: TreeSummaryNode[];
}
export interface SourceDiff {
  sourceId: string | null;
  sourceName?: string;
  fromRevision?: number;
  toRevision?: number;
  changes: string[];
}
export interface RevisionSummary {
  revision: number;
  source: string;
  createdAt: number;
  created: boolean;
  changes: string[];
  /** Set when this revision restored an earlier one. */
  restoredFrom?: number;
}
export interface RemoteCommit extends CommitEvent {
  source?: string;
  paths?: string[];
}
/** Runs a request to the Bridge with a deadline. Without one a request the Bridge never answers leaves the page waiting with no message. */
export async function withTimeout<T>(seconds: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  try {
    return await run(AbortSignal.timeout(seconds * 1000));
  } catch (error) {
    if ((error as Error | undefined)?.name === 'TimeoutError')
      throw new ResumeError(
        'BRIDGE_TIMEOUT',
        `本地工作区 ${seconds} 秒内没有响应。请刷新页面；仍然不行，请让 agent 运行 lulicv doctor 检查`,
      );
    throw error;
  }
}
export class BridgeRepository implements ObservableRepository {
  private listeners = new Set<(event: RemoteCommit) => void>();
  private events?: EventStream;
  private connections = new Set<(connected: boolean) => void>();
  private themeListeners = new Set<() => void>();
  private privacyListeners = new Set<() => void>();
  private exportListeners = new Set<(request?: ExportRequest) => void>();
  async request<T>(route: string, method = 'GET', value?: unknown): Promise<T> {
    return withTimeout(35, async (signal) => {
      const response = await fetch(route, {
        method,
        credentials: 'same-origin',
        headers: value === undefined ? {} : { 'Content-Type': 'application/json' },
        body: value === undefined ? undefined : JSON.stringify(value),
        signal,
      });
      if (!response.ok) {
        const error = (await response.json()) as { code: ErrorCode; message: string; currentRevision?: number };
        throw new ResumeError(error.code, error.message, error.currentRevision);
      }
      return (await response.json()) as T;
    });
  }
  async authenticate() {
    const preview = new URLSearchParams(location.hash.slice(1)).get('preview');
    if (preview) {
      const response = await withTimeout(15, (signal) =>
        fetch('/api/session', {
          method: 'POST',
          headers: { 'X-Resume-Preview': preview, 'Content-Type': 'application/json' },
          body: '{}',
          credentials: 'same-origin',
          signal,
        }),
      );
      if (!response.ok) throw new ResumeError('UNAUTHORIZED', '工作区会话无效，请用 lulicv preview 重新打开');
      history.replaceState(null, '', location.pathname + location.search);
    }
  }
  /** Called when installed themes change, and after reconnecting because a change may have been missed. */
  onThemes(listener: () => void) {
    this.themeListeners.add(listener);
    return () => {
      this.themeListeners.delete(listener);
    };
  }
  /** Called when privacy mode or its stored values change, and after reconnecting. */
  onPrivacy(listener: () => void) {
    this.privacyListeners.add(listener);
    return () => {
      this.privacyListeners.delete(listener);
    };
  }
  /** Called with each change to an agent's export request, and without one after reconnecting, when all should be fetched again. */
  onExportRequest(listener: (request?: ExportRequest) => void) {
    this.exportListeners.add(listener);
    return () => {
      this.exportListeners.delete(listener);
    };
  }
  onConnection(listener: (connected: boolean) => void) {
    this.connections.add(listener);
    return () => {
      this.connections.delete(listener);
    };
  }
  subscribe(listener: (event: RemoteCommit) => void) {
    this.listeners.add(listener);
    if (!this.events) {
      this.events = openEvents(this.deliver);
      window.addEventListener('online', this.reconnect);
      window.addEventListener('offline', this.offline);
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        this.events?.close();
        this.events = undefined;
        window.removeEventListener('online', this.reconnect);
        window.removeEventListener('offline', this.offline);
      }
    };
  }
  private readonly offline = () => {
    for (const callback of this.connections) callback(false);
  };
  // A brief network loss can drop an event without closing an established SSE socket.
  // The tab that owns the stream always opens a fresh one; its connected event makes every tab refetch.
  private readonly reconnect = () => {
    this.events?.reconnect();
  };
  private readonly deliver = (name: string, data?: string) => {
    if (name === 'offline') this.offline();
    else if (name === 'connected') {
      for (const callback of this.connections) callback(true);
      for (const callback of this.listeners) callback({ resumeId: '', revision: 0, mutationId: 'reconnect' });
      for (const callback of this.themeListeners) callback();
      for (const callback of this.privacyListeners) callback();
      for (const callback of this.exportListeners) callback();
    } else if (name === 'export-request') {
      const request = JSON.parse(data!) as ExportRequest;
      for (const callback of this.exportListeners) callback(request);
    } else if (name === 'privacy') for (const callback of this.privacyListeners) callback();
    else if (name === 'themes') for (const callback of this.themeListeners) callback();
    else if (name === 'commit') {
      const commit = JSON.parse(data!) as RemoteCommit;
      for (const callback of this.listeners) callback(commit);
    }
  };
  /** The PDF as the Bridge lays it out, with private values filled in; only the web page may ask for it in privacy mode. */
  async exportPdf(id: string, revision: number): Promise<Blob> {
    return withTimeout(60, async (signal) => {
      const response = await fetch(`/api/resumes/${encodeURIComponent(id)}/export`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision }),
        signal,
      });
      if (!response.ok) {
        const error = (await response.json()) as { code: ErrorCode; message: string };
        throw new ResumeError(error.code, error.message);
      }
      return await response.blob();
    });
  }
  /** Approves an agent's export request: the PDF comes back here, to download in this browser. */
  async approveExport(requestId: string): Promise<{ pdf: Blob; pages: number }> {
    return withTimeout(60, async (signal) => {
      const response = await fetch(`/api/export-requests/${encodeURIComponent(requestId)}/approve`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal,
      });
      if (!response.ok) {
        const error = (await response.json()) as { code: ErrorCode; message: string; currentRevision?: number };
        throw new ResumeError(error.code, error.message, error.currentRevision);
      }
      return { pdf: await response.blob(), pages: Number(response.headers.get('X-Resume-Pages')) };
    });
  }
  async declineExport(requestId: string) {
    await this.request(`/api/export-requests/${encodeURIComponent(requestId)}/decline`, 'POST', {});
  }
  list() {
    return this.request<ResumeDocument[]>('/api/resumes');
  }
  get(id: string) {
    return this.request<ResumeDocument>(`/api/resumes/${encodeURIComponent(id)}`);
  }
  async tree() {
    return (await this.request<{ resumes: TreeSummaryNode[] }>('/api/tree')).resumes;
  }
  sourceDiff(id: string) {
    return this.request<SourceDiff>(`/api/resumes/${encodeURIComponent(id)}/source-diff`);
  }
  async history(id: string) {
    return (await this.request<{ revisions: RevisionSummary[] }>(`/api/resumes/${encodeURIComponent(id)}/history`))
      .revisions;
  }
  create(document: ResumeDocument, identity?: CreationIdentity, source?: DuplicateSource) {
    const mutationId = identity?.mutationId ?? `create-${document.id}`;
    if (source)
      return this.request<ResumeDocument>(`/api/resumes/${encodeURIComponent(source.id)}/duplicate`, 'POST', {
        mutationId,
        name: source.name,
        expectedSourceRevision: source.expectedRevision,
      });
    const payload = identity
      ? JSON.parse(identity.fingerprint).input
      : { name: document.name, data: document.data, appearance: document.appearance };
    return this.request<ResumeDocument>('/api/resumes', 'POST', { ...payload, mutationId });
  }
  transact(id: string, identity: MutationIdentity, _transform: Transform) {
    // ResumeService supplies a canonical serializable payload; no callback or direct file operation crosses the bridge.
    const payload = JSON.parse(identity.fingerprint);
    const route = `/api/resumes/${encodeURIComponent(id)}`;
    const input = { baseRevision: identity.baseRevision, mutationId: identity.mutationId };
    if (Array.isArray(payload.operations)) return this.request<ResumeDocument>(route, 'PATCH', payload);
    if (payload.kind === 'import')
      return this.request<ResumeDocument>(route + '/replace', 'POST', { ...input, document: payload.input });
    if (payload.kind === 'restore')
      return this.request<ResumeDocument>(route + '/restore', 'POST', { ...input, revision: payload.revision });
    if (payload.kind === 'delete') return this.request<{ deleted: boolean }>(route, 'DELETE', input).then(() => null);
    return Promise.reject(new ResumeError('VALIDATION_FAILED', '未知修改协议'));
  }
}
