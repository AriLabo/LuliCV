import { create } from 'zustand';
import { baseAppearance, createResumeRecord, densityDefaults, sampleResumeInput } from './defaults';
import { createId } from './ids';
import { BrowserRepository, type ObservableRepository } from './browser-repository';
import { normalizeImport } from '../core/document';
import { diffDocuments } from '../core/mutation';
import { ResumeService } from '../core/service';
import { errorMessage, ResumeError } from '../core/errors';
import { DraftRepository } from './drafts';
import { BridgeRepository, type RevisionSummary, type SourceDiff, type TreeSummaryNode } from './bridge-repository';
import type {
  Appearance,
  Density,
  DocumentWorkspace,
  LayoutSettings,
  ResumeData,
  ResumeDocument,
  ResumeTarget,
} from '../core/types';
import { formatChanges, summarizeChanges } from '../core/change-summary';
import type { ExportLogEntry, ExportRequest, PrivacyChoices, PrivacySettings } from '../core/privacy';
import type { PrivacyPlanSummary, PrivacyState } from './privacy';
import type { LayoutReport } from '../core/layout';

export interface AgentChange {
  resumeId: string;
  revision: number;
  text: string;
  created: boolean;
  deleted: boolean;
}

interface StudioState {
  workspace: DocumentWorkspace | null;
  ready: boolean;
  initError?: string;
  mode: 'browser' | 'workspace';
  connected: boolean;
  saveState: 'saved' | 'saving' | 'error' | 'conflict';
  error?: string;
  lastChange?: AgentChange;
  conflicts: Record<string, boolean>;
  canUndo: boolean;
  canRedo: boolean;
  /** Counts local edits, undos and redos (not saves), so a UI can tell whether anything changed since. */
  editStamp: number;
  init: () => Promise<void>;
  flush: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  selectResume: (id: string) => void;
  updateData: (updater: (data: ResumeData) => ResumeData) => void;
  updateAppearance: (patch: Partial<Appearance>) => void;
  /** Replaces the whole appearance as its own undo step, e.g. a theme switch. */
  setAppearance: (appearance: Appearance) => void;
  updateLayout: (patch: Partial<LayoutSettings>) => void;
  setDensity: (density: Density, themeDefaults?: LayoutSettings) => void;
  updateTarget: (target: ResumeTarget | undefined) => void;
  dismissChange: () => void;
  loadHistory: (id: string) => Promise<RevisionSummary[]>;
  loadSourceChanges: () => Promise<Record<string, number>>;
  loadSourceDiff: (id: string) => Promise<SourceDiff | undefined>;
  /** `sample: false` clears the example mark; it does not change the content. */
  updateMeta: (patch: { parentId?: string | null; purpose?: string; sample?: false }) => void;
  /** Marks the source's changes up to `revision` as seen, so they stop being flagged. */
  acknowledgeSource: (revision: number) => void;
  createResume: (name?: string) => Promise<void>;
  /** Saves the built-in example as a resume of its own, marked as an example. */
  createSample: () => Promise<void>;
  duplicateResume: (id?: string, name?: string, target?: ResumeTarget, parentId?: string) => void;
  renameResume: (name: string) => void;
  deleteResume: () => void;
  importResumeData: (
    data: ResumeData,
    mode: 'replace-current' | 'new',
    options?: { appearance?: Appearance; name?: string },
  ) => void;
  restore: (value: unknown) => boolean;
  discardDraft: () => Promise<void>;
  saveDraftAsNew: () => Promise<void>;
  restorePrevious: () => Promise<void>;
  /** Privacy mode as the Bridge has it; unset in browser mode. Holds no private value, only whether each is filled and its shape. */
  privacy?: PrivacyState;
  loadPrivacy: () => Promise<void>;
  /** What turning privacy mode on or off, or changing its fields, would move; nothing is written. */
  planPrivacy: (next: PrivacySettings, choices?: PrivacyChoices) => Promise<PrivacyPlanSummary>;
  changePrivacy: (next: PrivacySettings, choices?: PrivacyChoices) => Promise<PrivacyPlanSummary>;
  /** Write-only: the value goes to the Bridge and is never read back. */
  setPrivateValue: (key: string, value: string) => Promise<void>;
  /** The Bridge's own layout of a saved revision, with the real values: page count and checks as the PDF will have them. */
  inspectSaved: (id: string, revision: number) => Promise<LayoutReport>;
  exportSaved: (id: string, revision: number) => Promise<Blob>;
  /** Agents' export requests waiting for the person to approve or decline them. */
  exportRequests: ExportRequest[];
  loadExportRequests: () => Promise<void>;
  approveExport: (requestId: string) => Promise<{ pdf: Blob; pages: number }>;
  declineExport: (requestId: string) => Promise<void>;
  /** Exports made in privacy mode, newest first: when, which revision and how it went, never the PDF. */
  loadExportLog: () => Promise<ExportLogEntry[]>;
}
interface History {
  past: ResumeDocument[];
  future: ResumeDocument[];
  key: string;
  at: number;
}
const histories = new Map<string, History>();
const committed = new Map<string, ResumeDocument>();
const dirty = new Set<string>();
const running = new Map<string, Promise<void>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const own = new Set<string>();
let service: ResumeService;
let drafts: DraftRepository;
let refreshChain = Promise.resolve();
let repository: ObservableRepository;
let initTask: Promise<void> | undefined;
let configured: { repository: ObservableRepository; mode: StudioState['mode']; namespace: string } | undefined;
export function configureRepository(next: ObservableRepository, mode: StudioState['mode'], namespace: string) {
  if (initTask) throw new Error('Store already initialized');
  configured = { repository: next, mode, namespace };
}
function history(id: string): History {
  let result = histories.get(id);
  if (!result) {
    result = { past: [], future: [], key: '', at: 0 };
    histories.set(id, result);
  }
  return result;
}
function flags(id?: string) {
  const h = id ? history(id) : undefined;
  return { canUndo: !!h?.past.length, canRedo: !!h?.future.length };
}
function active(): ResumeDocument | undefined {
  const workspace = useStudioStore.getState().workspace;
  return workspace?.resumes.find((record) => record.id === workspace.activeId);
}
function show(document: ResumeDocument) {
  const state = useStudioStore.getState();
  if (state.workspace)
    useStudioStore.setState({
      workspace: {
        ...state.workspace,
        resumes: state.workspace.resumes.map((record) => (record.id === document.id ? document : record)),
      },
      ...flags(state.workspace.activeId),
    });
}
function status() {
  const state = useStudioStore.getState();
  useStudioStore.setState({
    saveState: Object.keys(state.conflicts).length
      ? 'conflict'
      : state.error
        ? 'error'
        : dirty.size || running.size
          ? 'saving'
          : 'saved',
  });
}
function fail(error: unknown) {
  useStudioStore.setState({ error: errorMessage(error) });
  status();
}
function persistDraft(id: string) {
  const local = useStudioStore.getState().workspace?.resumes.find((record) => record.id === id);
  const base = committed.get(id);
  if (local && base) void drafts.save(id, { local, baseRevision: base.revision }).catch(fail);
}
function clearTimer(id: string) {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
}
function schedule(id: string) {
  clearTimer(id);
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      void flushDocument(id).catch(fail);
    }, 180),
  );
  status();
}
function edit(updater: (document: ResumeDocument) => ResumeDocument, key: string, coalesceMs = 0) {
  const current = active();
  if (!current) return;
  const h = history(current.id);
  const now = Date.now();
  if (!coalesceMs || h.key !== key || now - h.at > coalesceMs) {
    h.past.push(structuredClone(current));
    if (h.past.length > 100) h.past.shift();
  }
  h.future = [];
  h.key = key;
  h.at = now;
  show(updater(structuredClone(current)));
  dirty.add(current.id);
  persistDraft(current.id);
  useStudioStore.setState({ error: undefined, editStamp: useStudioStore.getState().editStamp + 1 });
  schedule(current.id);
}
async function refresh() {
  const documents = await service.list();
  const state = useStudioStore.getState();
  if (!state.workspace) return;
  const byId = new Map(documents.map((document) => [document.id, document]));
  const conflicts = { ...state.conflicts };
  const records = state.workspace.resumes.flatMap((local) => {
    const remote = byId.get(local.id);
    byId.delete(local.id);
    const previous = committed.get(local.id);
    if (remote && previous && remote.revision < previous.revision) return [local];
    if (!remote || (previous && remote.revision > previous.revision)) {
      histories.delete(local.id);
      if (dirty.has(local.id) || running.has(local.id)) {
        conflicts[local.id] = true;
        return [local];
      }
      committed.delete(local.id);
    }
    if (!remote) return [];
    if (!dirty.has(local.id) && !running.has(local.id)) {
      committed.set(local.id, remote);
      return [remote];
    }
    return [local];
  });
  for (const remote of byId.values()) {
    committed.set(remote.id, remote);
    records.push(remote);
  }
  const activeId = records.some((record) => record.id === state.workspace!.activeId)
    ? state.workspace.activeId
    : (records[0]?.id ?? '');
  useStudioStore.setState({ workspace: { version: 1, resumes: records, activeId }, conflicts, ...flags(activeId) });
  status();
  for (const id of dirty) if (!conflicts[id] && state.connected) schedule(id);
}
async function flushDocument(id: string): Promise<void> {
  clearTimer(id);
  const existing = running.get(id);
  if (existing) {
    await existing;
    if (dirty.has(id)) return flushDocument(id);
    return;
  }
  if (!dirty.has(id)) return;
  if (useStudioStore.getState().conflicts[id]) throw new ResumeError('REVISION_CONFLICT', '请先处理未提交草稿冲突');
  const current = useStudioStore.getState().workspace?.resumes.find((record) => record.id === id);
  const base = committed.get(id);
  if (!current || !base) return;
  const sent = structuredClone(current);
  const operations = diffDocuments(base, sent);
  if (!operations.length) {
    dirty.delete(id);
    await drafts.remove(id);
    status();
    return;
  }
  const mutationId = createId('web');
  own.add(mutationId);
  const task = (async () => {
    try {
      const saved = await service.patch(id, { baseRevision: base.revision, mutationId, operations });
      useStudioStore.setState({ error: undefined });
      committed.set(id, saved);
      const latest = useStudioStore.getState().workspace?.resumes.find((record) => record.id === id);
      const changed = latest && diffDocuments(sent, latest).length > 0;
      if (!changed) {
        show(saved);
        dirty.delete(id);
        await drafts.remove(id);
      } else {
        show({ ...latest, revision: saved.revision, updatedAt: saved.updatedAt });
        persistDraft(id);
      }
    } catch (error) {
      if (error instanceof ResumeError && error.code === 'REVISION_CONFLICT')
        useStudioStore.setState({ conflicts: { ...useStudioStore.getState().conflicts, [id]: true } });
      fail(error);
      throw error;
    } finally {
      own.delete(mutationId);
      running.delete(id);
      status();
    }
  })();
  running.set(id, task);
  status();
  await task;
  if (dirty.has(id) && !useStudioStore.getState().conflicts[id]) schedule(id);
}
async function append(document: ResumeDocument) {
  committed.set(document.id, document);
  const state = useStudioStore.getState();
  if (state.workspace)
    useStudioStore.setState({
      workspace: {
        ...state.workspace,
        activeId: document.id,
        resumes: [...state.workspace.resumes.filter((record) => record.id !== document.id), document],
      },
      ...flags(document.id),
    });
  status();
}
function bridge(): BridgeRepository {
  if (!(repository instanceof BridgeRepository))
    throw new ResumeError('VALIDATION_FAILED', '隐私模式只在本地工作区可用');
  return repository;
}
/** Runs a task whose failure goes to the error notice; the returned promise never rejects. */
function background(task: () => Promise<void>): Promise<void> {
  return task().catch(fail);
}
const clamp = (value: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, value)) * 100) / 100;
/** Density shifts the theme's own defaults instead of replacing them with one global preset. */
function relativeDensity(
  density: Density,
  base: LayoutSettings = { ...densityDefaults.balanced, accentColor: '#000000', photoEnabled: false },
) {
  const shift = densityDefaults[density],
    neutral = densityDefaults.balanced;
  return {
    pageMarginMm: clamp(base.pageMarginMm + shift.pageMarginMm - neutral.pageMarginMm, 9, 24),
    baseFontPt: clamp(base.baseFontPt + shift.baseFontPt - neutral.baseFontPt, 9, 12),
    lineHeight: clamp(base.lineHeight + shift.lineHeight - neutral.lineHeight, 1.3, 1.7),
    sectionSpacingPt: clamp(base.sectionSpacingPt + shift.sectionSpacingPt - neutral.sectionSpacingPt, 4, 16),
  };
}
export const useStudioStore = create<StudioState>((set, get) => ({
  workspace: null,
  ready: false,
  mode: 'browser',
  connected: true,
  saveState: 'saved',
  conflicts: {},
  canUndo: false,
  canRedo: false,
  editStamp: 0,
  exportRequests: [],
  init: () => {
    if (initTask) return initTask;
    initTask = (async () => {
      try {
        repository = configured?.repository ?? new BrowserRepository();
        service = new ResumeService(repository, createResumeRecord);
        drafts = new DraftRepository(configured?.namespace ?? 'browser');
        if (repository instanceof BridgeRepository)
          repository.onPrivacy(() => {
            void get().loadPrivacy().catch(fail);
          });
        if (repository instanceof BridgeRepository)
          repository.onExportRequest((request) => {
            if (!request) {
              void get().loadExportRequests().catch(fail);
              return;
            }
            const others = get().exportRequests.filter((item) => item.requestId !== request.requestId);
            set({ exportRequests: request.status === 'pending' ? [...others, request] : others });
          });
        if (repository instanceof BridgeRepository)
          repository.onConnection((connected) => {
            set({ connected, ...(connected ? { error: undefined } : {}) });
            status();
          });
        repository.subscribe((event) => {
          if (own.has(event.mutationId)) return;
          const known = !!get().workspace?.resumes.some((record) => record.id === event.resumeId);
          refreshChain = refreshChain
            .catch(() => {})
            .then(() => {
              // The version before this commit, so a deleted section or entry can still be named.
              const before = committed.get(event.resumeId);
              return refresh().then(() => {
                if (event.source !== 'agent') return;
                const document = get().workspace?.resumes.find((record) => record.id === event.resumeId);
                const after = committed.get(event.resumeId);
                const created = !known && event.revision === 1 && !event.deleted;
                if (created && document) get().selectResume(document.id);
                const changes =
                  before && after?.revision === event.revision && before.revision === event.revision - 1
                    ? formatChanges(summarizeChanges(before, after))
                    : '';
                set({
                  lastChange: {
                    resumeId: event.resumeId,
                    revision: event.revision,
                    created,
                    deleted: !!event.deleted,
                    text: event.deleted
                      ? 'Agent 删除了一份简历'
                      : created
                        ? `Agent 新建了「${document?.name ?? '简历'}」，已为你切换过去`
                        : `Agent 修改了${changes || '这份简历'}`,
                  },
                });
              });
            });
          void refreshChain.catch(fail);
        });
        // An empty workspace stays empty: the page previews the example until the user picks one.
        let records = await service.list();
        records.forEach((record) => committed.set(record.id, record));
        const conflicts: Record<string, boolean> = {};
        records = await Promise.all(
          records.map(async (record) => {
            const draft = await drafts.get(record.id);
            if (!draft) return record;
            if (draft.baseRevision !== record.revision) conflicts[record.id] = true;
            dirty.add(record.id);
            return draft.local;
          }),
        );
        for (const draft of await drafts.list())
          if (!records.some((record) => record.id === draft.local.id)) {
            records.push(draft.local);
            committed.set(draft.local.id, draft.local);
            dirty.add(draft.local.id);
            conflicts[draft.local.id] = true;
          }
        const storedId = localStorage.getItem('lulicv:active');
        const activeId = records.find((record) => record.id === storedId)?.id ?? records[0]?.id ?? '';
        if (repository instanceof BridgeRepository) await get().loadPrivacy();
        set({
          workspace: { version: 1, activeId, resumes: records },
          ready: true,
          conflicts,
          mode: configured?.mode ?? 'browser',
        });
        for (const id of dirty) if (!conflicts[id]) schedule(id);
        status();
      } catch (error) {
        set({ ready: true, initError: errorMessage(error), saveState: 'error' });
      }
    })();
    return initTask;
  },
  flush: async () => {
    for (const id of [...dirty]) await flushDocument(id);
  },
  selectResume: (id) => {
    const workspace = get().workspace;
    if (!workspace?.resumes.some((record) => record.id === id)) return;
    localStorage.setItem('lulicv:active', id);
    set({ workspace: { ...workspace, activeId: id }, ...flags(id) });
  },
  updateData: (updater) => edit((record) => ({ ...record, data: updater(record.data) }), 'data', 700),
  updateAppearance: (patch) =>
    edit((record) => ({ ...record, appearance: { ...record.appearance, ...patch } }), 'appearance', 400),
  setAppearance: (appearance) => edit((record) => ({ ...record, appearance }), 'theme'),
  updateLayout: (patch) =>
    edit(
      (record) => ({
        ...record,
        appearance: { ...record.appearance, layout: { ...record.appearance.layout, ...patch } },
      }),
      'layout',
      400,
    ),
  setDensity: (density, themeDefaults) =>
    edit(
      (record) => ({
        ...record,
        appearance: {
          ...record.appearance,
          density,
          layout: { ...record.appearance.layout, ...relativeDensity(density, themeDefaults) },
        },
      }),
      'density',
    ),
  updateTarget: (target) =>
    edit(
      (record) => {
        const next = { ...record };
        if (target) next.target = target;
        else delete next.target;
        return next;
      },
      'target',
      700,
    ),
  dismissChange: () => set({ lastChange: undefined }),
  loadHistory: async (id) => (repository instanceof BridgeRepository ? repository.history(id) : []),
  // Content changes in a copy's source come from stored snapshots, so they exist in workspace mode only.
  loadSourceChanges: async () => {
    if (!(repository instanceof BridgeRepository)) return {};
    const result: Record<string, number> = {};
    const walk = (nodes: TreeSummaryNode[]) =>
      nodes.forEach((node) => {
        if (node.sourceChanges) result[node.id] = node.sourceChanges;
        walk(node.children);
      });
    walk(await repository.tree());
    return result;
  },
  loadSourceDiff: async (id) => (repository instanceof BridgeRepository ? repository.sourceDiff(id) : undefined),
  updateMeta: (patch) =>
    edit(
      (record) => {
        const next = { ...record };
        if (patch.parentId === null) delete next.parentId;
        else if (patch.parentId !== undefined) next.parentId = patch.parentId;
        if (patch.purpose !== undefined) {
          if (patch.purpose.trim()) next.purpose = patch.purpose;
          else delete next.purpose;
        }
        if (patch.sample === false) delete next.sample;
        return next;
      },
      'meta',
      700,
    ),
  acknowledgeSource: (revision) =>
    edit((record) => (record.source ? { ...record, source: { ...record.source, revision } } : record), 'source'),
  renameResume: (name) => {
    if (name.trim()) edit((record) => ({ ...record, name: name.trim() }), 'rename', 700);
  },
  undo: () => {
    const record = active();
    if (!record) return;
    const h = history(record.id);
    const previous = h.past.pop();
    if (!previous) return;
    h.future.push(structuredClone(record));
    h.key = '';
    show({ ...previous, revision: record.revision });
    set({ editStamp: get().editStamp + 1 });
    dirty.add(record.id);
    persistDraft(record.id);
    schedule(record.id);
  },
  redo: () => {
    const record = active();
    if (!record) return;
    const h = history(record.id);
    const next = h.future.pop();
    if (!next) return;
    h.past.push(structuredClone(record));
    h.key = '';
    show({ ...next, revision: record.revision });
    set({ editStamp: get().editStamp + 1 });
    dirty.add(record.id);
    persistDraft(record.id);
    schedule(record.id);
  },
  createResume: (name) =>
    background(async () => {
      await append(await service.create({ name }));
    }),
  createSample: () =>
    background(async () => {
      await append(await service.create(sampleResumeInput()));
    }),
  duplicateResume: (id, name, target, parentId) =>
    background(async () => {
      const record = active();
      if (!record) return;
      await flushDocument(id ?? record.id);
      const copy = await service.duplicate(id ?? record.id, name, parentId ? { parentId } : {});
      await append(copy);
      if (target) get().updateTarget(target);
    }),
  deleteResume: () =>
    background(async () => {
      const record = active();
      if (!record) return;
      await flushDocument(record.id);
      await service.delete(record.id, {
        baseRevision: committed.get(record.id)!.revision,
        mutationId: createId('delete'),
      });
      // An earlier agent notice no longer describes what the page shows after the person's own delete.
      set({ lastChange: undefined });
      await refresh();
    }),
  importResumeData: (data, mode, options) => {
    const record = active();
    if (!record && mode !== 'new') return;
    background(async () => {
      if (mode === 'new' || !record) {
        await append(
          await service.create({
            data,
            name: options?.name ?? `${data.basics.name || '导入'}的简历`,
            appearance: options?.appearance ?? record?.appearance ?? structuredClone(baseAppearance),
          }),
        );
      } else {
        await flushDocument(record.id);
        const base = committed.get(record.id)!;
        const mutationId = createId('import');
        own.add(mutationId);
        try {
          const saved = await service.replace(
            record.id,
            { baseRevision: base.revision, mutationId },
            { data, appearance: options?.appearance ?? base.appearance },
          );
          committed.set(record.id, saved);
          show(saved);
          histories.delete(record.id);
          set(flags(record.id));
        } finally {
          own.delete(mutationId);
        }
      }
    });
  },
  restore: (value) => {
    try {
      normalizeImport(value, createResumeRecord);
    } catch {
      return false;
    }
    background(async () => {
      for (const document of await service.importNew(value)) await append(document);
    });
    return true;
  },
  discardDraft: async () => {
    const record = active();
    if (!record) return;
    await running.get(record.id)?.catch(() => {});
    clearTimer(record.id);
    dirty.delete(record.id);
    await drafts.remove(record.id);
    histories.delete(record.id);
    const conflicts = { ...get().conflicts };
    delete conflicts[record.id];
    set({ conflicts, error: undefined });
    await refresh();
    status();
  },
  saveDraftAsNew: async () => {
    const record = active();
    if (!record) return;
    const saved = await service.create({
      name: `${record.name} 本地草稿`,
      data: record.data,
      appearance: record.appearance,
      ...(record.sample ? { sample: true as const } : {}),
    });
    await get().discardDraft();
    await append(saved);
  },
  loadPrivacy: async () => {
    if (!(repository instanceof BridgeRepository)) return;
    const { enabled, fields, values } = await repository.request<PrivacyState>('/api/privacy');
    set({ privacy: { enabled, fields, values } });
  },
  planPrivacy: async (next, choices) =>
    bridge().request<PrivacyPlanSummary>('/api/privacy/plan', 'POST', { ...next, ...(choices ? { choices } : {}) }),
  changePrivacy: async (next, choices) => {
    // Every resume may be rewritten: local edits are saved first so they are not left behind as a conflict.
    await get().flush();
    const result = await bridge().request<PrivacyPlanSummary>('/api/privacy', 'PUT', {
      ...next,
      ...(choices ? { choices } : {}),
    });
    await get().loadPrivacy();
    refreshChain = refreshChain.catch(() => {}).then(refresh);
    await refreshChain;
    return result;
  },
  setPrivateValue: async (key, value) => {
    const { values } = await bridge().request<Pick<PrivacyState, 'values'>>('/api/privacy/values', 'PUT', {
      key,
      value,
    });
    const privacy = get().privacy;
    if (privacy) set({ privacy: { ...privacy, values } });
  },
  inspectSaved: (id, revision) =>
    bridge().request<LayoutReport>(`/api/resumes/${encodeURIComponent(id)}/inspect`, 'POST', { revision }),
  exportSaved: (id, revision) => bridge().exportPdf(id, revision),
  loadExportRequests: async () =>
    set({ exportRequests: (await bridge().request<{ requests: ExportRequest[] }>('/api/export-requests')).requests }),
  approveExport: (requestId) => bridge().approveExport(requestId),
  declineExport: (requestId) => bridge().declineExport(requestId),
  loadExportLog: async () => (await bridge().request<{ exports: ExportLogEntry[] }>('/api/export-log')).exports,
  restorePrevious: async () => {
    const record = active();
    if (!record) return;
    await flushDocument(record.id);
    const mutationId = createId('restore');
    own.add(mutationId);
    try {
      const saved = await service.restorePrevious(record.id, {
        baseRevision: committed.get(record.id)!.revision,
        mutationId,
      });
      committed.set(record.id, saved);
      histories.delete(record.id);
      show(saved);
    } finally {
      own.delete(mutationId);
    }
  },
}));
