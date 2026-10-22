import schema from '../../schema/resume-data.schema.json' with { type: 'json' };
import { layoutOptions, themeCatalog } from '../../src/core/document';
import { buildInfo } from '../runtime/build';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, readdir, realpath, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { treeSummary, describeSourceChanges } from './tree';
import { SqliteRepository } from './sqlite-repository';
import { atomicWrite } from './workspace';
import { ThemeStore, type ThemePackage } from './themes';
import { ResumeService } from '../../src/core/service';
import { createResumeRecord } from '../../src/core/defaults';
import { ResumeError } from '../../src/core/errors';
import type { ResumePatch, WriteIdentity } from '../../src/core/mutation';
import type { ResumeDocument } from '../../src/core/types';
import type { ThemeManifest } from '../../src/core/theme-types';
import { checkThemePackage } from '../../src/core/theme-package';
import { reservedThemeIds } from '../../src/core/document';
import {
  CHANGED_AFTER_REQUEST,
  describePrivate,
  filledFields,
  loosens,
  normalizePrivacy,
  PRIVACY_NOTICE,
  PrivacyView,
  privateFieldOptions,
  type ExportLogEntry,
  type ExportRequest,
  type PrivacyChoices,
  type PrivateField,
} from '../../src/core/privacy';
import { ExportApprovals } from './export-approval';
export interface Runtime {
  pid: number;
  origin: string;
  token: string;
  workspaceId: string;
}
/** One sample rendered with a theme that is not installed yet (lulicv theme check). */
export interface ThemeCheckResult {
  sample: string;
  name: string;
  maxPages: number;
  report: unknown;
  pages?: string[];
}
/** What page images cover with field labels in privacy mode: the private fields' elements and any text matching the patterns. */
export interface Redaction {
  fields: PrivateField[];
  patterns: Array<{ pattern: string; field: PrivateField }>;
}
export interface RenderAdapter {
  snapshot(key: string): ResumeDocument;
  theme?(key: string): ThemePackage | null;
  checkTheme?(theme: ThemePackage, images: boolean): Promise<ThemeCheckResult[]>;
  inspect(id: string, revision: number, maxPages?: number): Promise<unknown>;
  export(id: string, revision: number): Promise<{ pdf: Buffer; report: unknown }>;
  preview?(id: string, revision: number, redaction?: Redaction): Promise<{ report: unknown; pages: string[] }>;
  beginShutdown?(): void;
  close(): Promise<void>;
}
function json(response: ServerResponse, status: number, data: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}
/**
 * Responses in privacy mode carry placeholders instead of private values; agent responses also say so, with what
 * privacy mode changed in their writes. Page images are covered by the renderer.
 */
function reply(
  response: ServerResponse,
  status: number,
  data: unknown,
  view?: PrivacyView,
  agent?: { notes: string[] },
) {
  if (!view) {
    json(response, status, data);
    return;
  }
  response.setHeader('X-Resume-Privacy', 'on');
  const safe = view.protect(data, (key) => key === 'pages');
  if (!agent || !safe || typeof safe !== 'object' || Array.isArray(safe)) {
    json(response, status, safe);
    return;
  }
  json(response, status, {
    ...safe,
    privacy: {
      mode: true,
      fields: view.fields,
      notice: PRIVACY_NOTICE,
      ...(agent.notes.length ? { changes: view.protect(agent.notes) } : {}),
    },
  });
}
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers['content-type']?.startsWith('application/json'))
    throw new ResumeError('VALIDATION_FAILED', '需要 application/json');
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 8 * 1024 * 1024) throw new ResumeError('VALIDATION_FAILED', '请求超出 8MB');
    chunks.push(Buffer.from(chunk));
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('需要对象');
    return value;
  } catch {
    throw new ResumeError('VALIDATION_FAILED', '请求 JSON 无效');
  }
}
export async function startBridge(options: {
  workspace: string;
  dist: string;
  port?: number;
  exportApprovalMs?: number;
  renderer?: (service: ResumeService, runtime: Runtime, themes: ThemeStore) => RenderAdapter;
}) {
  const repository = await SqliteRepository.open(options.workspace);
  const service = new ResumeService(repository, createResumeRecord);
  const dist = await realpath(options.dist).catch(async (error) => {
    await repository.close();
    throw error;
  });
  const manifest = JSON.parse(await readFile(path.join(repository.root, 'lulicv.json'), 'utf8'));
  const themes = await ThemeStore.open(repository.root).catch(async (error) => {
    await repository.close();
    throw error;
  });
  // Serve the web app from memory: some agent sandboxes revoke file access from a background Bridge once the
  // shell that started it ends, and people should still be able to open and edit their resumes.
  const assets = await loadAssets(dist).catch(async (error) => {
    await repository.close();
    throw error;
  });
  /** Whether this process can still read its own installation; rendering and export need it. */
  const fileAccess = async () => {
    try {
      await stat(path.join(dist, 'index.html'));
      return true;
    } catch {
      return false;
    }
  };
  const token = randomBytes(32).toString('hex');
  let origin = '';
  let runtime: Runtime;
  let render: RenderAdapter | undefined;
  let closing = false;
  let closeTask: Promise<void> | undefined;
  const streams = new Set<ServerResponse>();
  // Short-lived browser entry credentials are never the persistent CLI bearer.
  const previewTickets = new Map<string, number>();
  const descriptions = new Map<string, { source: string; paths: string[] }>();
  // A failed log write must not stop an export the person approved, or crash the expiry timer.
  const logExport = (entry: ExportLogEntry) => {
    try {
      repository.logExport(entry);
    } catch {
      process.stderr.write('导出记录写入失败\n');
    }
  };
  const approvals = new ExportApprovals({
    timeout: options.exportApprovalMs,
    announce: (request) => broadcast('export-request', request),
    log: logExport,
  });
  /** What the agent learns about its request: never the PDF or where it went, only that it was exported and how many pages. */
  const requestStatus = (request: ExportRequest) => {
    const common = {
      requestId: request.requestId,
      status: request.status,
      id: request.resumeId,
      revision: request.revision,
      pages: request.pages,
    };
    if (request.status === 'approved')
      return {
        ...common,
        message: `PDF 已交给用户的浏览器下载，共 ${request.pages} 页；用户没收到文件（比如在保存对话框里取消了）可以再请求一次`,
      };
    const webOpen = streams.size > 0;
    return {
      ...common,
      expiresAt: request.expiresAt,
      webOpen,
      message: webOpen
        ? '等用户在网页里批准，5 分钟内有效'
        : '没有打开的履栗网页：请用户打开网页（lulicv preview 给出的网址）来批准，请求 5 分钟后自动取消',
    };
  };
  /**
   * The CLI token counts only as a bearer and a browser only with a cookie of its own, so the token in runtime.json,
   * which agents can read, never passes for the person's browser.
   */
  function authorized(request: IncomingMessage) {
    const header = request.headers.authorization;
    if (header !== undefined) {
      const bytes = Buffer.from(header);
      const expected = Buffer.from(`Bearer ${token}`);
      return bytes.length === expected.length && timingSafeEqual(bytes, expected);
    }
    const cookie = request.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`resume_session_${new URL(origin).port}=`))
      ?.split('=')
      .slice(1)
      .join('=');
    return !!cookie && /^[a-f0-9]{64}$/.test(cookie) && repository.hasBrowserSession(cookie);
  }
  const server = createServer((request, response) => {
    const agent = !!request.headers.authorization;
    // Set while privacy mode is on, for agents and the web page alike; every response and error goes through it.
    let view: PrivacyView | undefined;
    const send = (status: number, data: unknown) =>
      reply(response, status, data, view, agent ? { notes: repository.privacyNotes() } : undefined);
    void repository
      .withContext({ source: agent ? 'agent' : 'human', privacyNotes: [] }, async () => {
        if (
          request.headers.host !== new URL(origin).host ||
          (request.headers.origin && request.headers.origin !== origin) ||
          request.headers['sec-fetch-site'] === 'cross-site'
        )
          throw new ResumeError('UNAUTHORIZED', 'Host 或 Origin 不被允许');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Referrer-Policy', 'no-referrer');
        const url = new URL(request.url ?? '/', origin);
        const pathname = decodeURIComponent(url.pathname);
        if (pathname.startsWith('/api/')) {
          let previewSession = false;
          if (pathname === '/api/session' && request.method === 'POST' && request.headers['x-resume-preview']) {
            const ticket = String(request.headers['x-resume-preview']);
            const expires = previewTickets.get(ticket);
            previewTickets.delete(ticket);
            previewSession = expires !== undefined && expires > Date.now() && !closing;
          }
          // The render page reads a job by its unguessable key, which only the Bridge's own renderer is given.
          const renderJob = pathname.startsWith('/api/render/') && request.method === 'GET';
          if (!previewSession && !renderJob && !authorized(request))
            throw new ResumeError('UNAUTHORIZED', '本地会话无效，请从 lulicv preview 重新打开');
          if (
            closing &&
            !['/api/health', '/api/shutdown', '/api/session'].includes(pathname) &&
            !pathname.startsWith('/api/render/')
          )
            throw new ResumeError('STORAGE_FAILED', 'Bridge 正在关闭，请等待完成后重新 preview');
          const privacy = repository.privacy();
          // The render page loads the filled resume it lays out; that route is for the Bridge's own renderer.
          if (privacy.enabled && pathname.startsWith('/api/render/') && agent)
            throw new ResumeError('PRIVACY_MODE', '隐私模式下渲染数据只供 Bridge 内部排版使用');
          if (
            privacy.enabled &&
            !['/api/health', '/api/shutdown', '/api/session', '/api/preview-entry', '/api/events'].includes(pathname) &&
            !pathname.startsWith('/api/privacy') &&
            !pathname.startsWith('/api/render/')
          )
            view = new PrivacyView(privacy, repository.privateStore());
          if (pathname === '/api/session' && request.method === 'POST') {
            if (agent) throw new ResumeError('UNAUTHORIZED', '浏览器只能用 lulicv preview 给出的链接打开');
            if (previewSession) {
              // The port is fixed per workspace, so the sign-in outlasts Bridge restarts; the address can be bookmarked.
              const secret = randomBytes(32).toString('hex');
              repository.addBrowserSession(secret, Date.now() + BROWSER_SESSION_MS);
              response.setHeader(
                'Set-Cookie',
                `resume_session_${new URL(origin).port}=${secret}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${BROWSER_SESSION_MS / 1000}`,
              );
            }
            json(response, 200, { workspaceId: manifest.workspaceId });
            return;
          }
          if (pathname === '/api/preview-entry' && request.method === 'POST') {
            if (!request.headers.authorization) throw new ResumeError('UNAUTHORIZED', '预览入口需要 CLI 会话凭证');
            await body(request);
            for (const [ticket, expires] of previewTickets) if (expires <= Date.now()) previewTickets.delete(ticket);
            if (previewTickets.size >= 32) previewTickets.delete(previewTickets.keys().next().value!);
            const ticket = randomBytes(32).toString('hex');
            const expiresAt = Date.now() + 300000;
            previewTickets.set(ticket, expiresAt);
            json(response, 201, { url: `${origin}/#preview=${ticket}`, expiresAt });
            return;
          }
          if (pathname === '/api/privacy' || pathname === '/api/privacy/plan') {
            // Saved values are never sent back, to the web page either: it gets their length and shape for sizing placeholders.
            if (pathname === '/api/privacy' && request.method === 'GET') {
              json(response, 200, {
                ...privacy,
                options: privateFieldOptions,
                values: describePrivate(privacy, repository.privateStore(), !agent),
              });
              return;
            }
            if (request.method === 'PUT' || (pathname === '/api/privacy/plan' && request.method === 'POST')) {
              const { choices, ...settings } = await body(request);
              const next = normalizePrivacy(settings);
              if (agent && loosens(privacy, next))
                throw new ResumeError('PRIVACY_MODE', '隐私模式只能由用户在网页里关闭或减少隐私字段');
              if (
                choices !== undefined &&
                (agent ||
                  !choices ||
                  typeof choices !== 'object' ||
                  Array.isArray(choices) ||
                  Object.values(choices).some((value) => typeof value !== 'string'))
              )
                throw new ResumeError(
                  agent ? 'PRIVACY_MODE' : 'VALIDATION_FAILED',
                  agent ? '各份简历里的值不一致时，由用户在网页里选择导出用哪个' : 'choices 需要 { 字段: 值 }',
                );
              const plan = repository.changePrivacy(
                next,
                choices as PrivacyChoices | undefined,
                request.method === 'PUT',
              );
              // Conflicting values are not private yet (the field is being added), so the plan may name them.
              const summary = {
                enabled: plan.settings.enabled,
                fields: plan.settings.fields,
                moved: plan.moved,
                restored: plan.restored,
                conflicts: plan.conflicts,
              };
              if (request.method === 'PUT' && plan.conflicts.length)
                throw new ResumeError(
                  'VALIDATION_FAILED',
                  `${plan.conflicts.map((conflict) => conflict.label).join('、')}在几份简历里不一样，${agent ? '需要用户在网页里开启隐私模式并' : '请'}选择导出时统一用哪个`,
                );
              if (request.method === 'PUT')
                broadcast('privacy', { enabled: plan.settings.enabled, fields: plan.settings.fields });
              json(response, 200, summary);
              return;
            }
          }
          if (pathname === '/api/privacy/values' && request.method === 'PUT') {
            // Write-only, from the web page: agents get no path to the values, and do not change them either.
            if (agent) throw new ResumeError('PRIVACY_MODE', '隐私信息只能由用户在网页里填写');
            const input = await body(request);
            if (typeof input.key !== 'string') throw new ResumeError('VALIDATION_FAILED', '需要 key 和 value');
            repository.setPrivateValue(input.key, input.value);
            broadcast('privacy', { enabled: privacy.enabled, fields: privacy.fields });
            json(response, 200, { values: describePrivate(privacy, repository.privateStore()) });
            return;
          }
          if (pathname === '/api/backup' && request.method === 'GET') {
            if (view && agent)
              throw new ResumeError('PRIVACY_MODE', '隐私模式下备份含真实个人信息，请用户在网页里操作');
            const temporary = path.join(repository.root, '.lulicv', `backup-${randomUUID()}.db`);
            try {
              await repository.backupTo(temporary);
              const content = await readFile(temporary);
              response.writeHead(200, { 'Content-Type': 'application/x-sqlite3', 'Cache-Control': 'no-store' });
              response.end(content);
            } finally {
              await rm(temporary, { force: true });
            }
            return;
          }
          if (pathname === '/api/health' && request.method === 'GET') {
            json(response, 200, {
              workspaceId: manifest.workspaceId,
              pid: process.pid,
              build: buildInfo,
              fileAccess: await fileAccess(),
              privacyMode: privacy.enabled,
              editors: streams.size,
              closing,
            });
            return;
          }
          if (pathname === '/api/schema/resume-data' && request.method === 'GET') {
            json(response, 200, { schema });
            return;
          }
          if (pathname === '/api/import-resume' && request.method === 'POST') {
            send(201, await service.importResume(await body(request)));
            return;
          }
          if (pathname === '/api/tree' && request.method === 'GET') {
            send(200, { resumes: await treeSummary(repository, await service.list()) });
            return;
          }
          if (pathname === '/api/themes' && request.method === 'GET') {
            json(response, 200, {
              themes: [
                ...themeCatalog.map((theme) => ({ ...theme, source: 'builtin' })),
                ...themes.list().map((theme) => ({ ...theme, source: 'installed' })),
              ],
              invalid: themes.invalid,
              layout: layoutOptions,
            });
            return;
          }
          if (pathname === '/api/themes' && request.method === 'POST') {
            const input = await body(request);
            if (typeof input.css !== 'string') throw new ResumeError('VALIDATION_FAILED', '需要 manifest 和 css');
            const result = await themes.install(input.manifest, input.css);
            broadcast('themes', { installed: result.theme.id });
            json(response, 201, result);
            return;
          }
          if (pathname === '/api/themes/check' && request.method === 'POST') {
            const input = await body(request);
            if (typeof input.css !== 'string') throw new ResumeError('VALIDATION_FAILED', '需要 manifest 和 css');
            const { errors, warnings } = checkThemePackage(input.manifest, input.css, reservedThemeIds);
            if (errors.length) {
              json(response, 200, { valid: false, errors, warnings, samples: [] });
              return;
            }
            if (!render?.checkTheme) throw new ResumeError('NOT_FOUND', '渲染接口未启用');
            if (!(await fileAccess())) throw new ResumeError('STORAGE_FAILED', FILE_ACCESS_LOST);
            const samples = await render.checkTheme(
              { manifest: input.manifest as ThemeManifest, css: input.css },
              input.images === true,
            );
            json(response, 200, { valid: true, errors, warnings, samples });
            return;
          }
          const themeMatch = pathname.match(/^\/api\/themes\/([a-z][a-z0-9-]{1,39})(\/theme\.css)?$/);
          if (themeMatch && themeMatch[2] && request.method === 'GET') {
            const theme = themes.get(themeMatch[1]);
            if (!theme) throw new ResumeError('NOT_FOUND', `没有安装主题「${themeMatch[1]}」`);
            response.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' });
            response.end(theme.css);
            return;
          }
          if (themeMatch && !themeMatch[2] && request.method === 'DELETE') {
            await body(request);
            await themes.remove(themeMatch[1]);
            broadcast('themes', { removed: themeMatch[1] });
            const usedBy = (await service.list())
              .filter((document) => document.appearance.themeId === themeMatch[1])
              .map(({ id, name }) => ({ id, name }));
            send(200, { removed: themeMatch[1], usedBy });
            return;
          }
          const renderTheme = pathname.match(/^\/api\/render\/([a-f0-9-]{36})\/theme$/);
          if (renderTheme && request.method === 'GET') {
            if (!render) throw new ResumeError('NOT_FOUND', '渲染接口未启用');
            send(200, { theme: render.theme?.(renderTheme[1]) ?? null });
            return;
          }
          if (pathname === '/api/shutdown' && request.method === 'POST') {
            if (!request.headers.authorization) throw new ResumeError('UNAUTHORIZED', '关闭需要 CLI 会话凭证');
            await body(request);
            closing = true;
            render?.beginShutdown?.();
            response.once('finish', () => {
              void closeBridge().catch(() => {
                process.stderr.write('Bridge 关闭失败，请检查锁和工作区\n');
                process.exitCode = 1;
              });
            });
            json(response, 202, { stopping: true, pid: process.pid });
            return;
          }
          if (pathname === '/api/events' && request.method === 'GET') {
            response.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            });
            response.write('event: connected\ndata: {}\n\n');
            streams.add(response);
            const timer = setInterval(() => response.write(': heartbeat\n\n'), 15000);
            request.on('close', () => {
              clearInterval(timer);
              streams.delete(response);
            });
            return;
          }
          if (pathname.startsWith('/api/render/') && request.method === 'GET') {
            if (!render) throw new ResumeError('NOT_FOUND', '渲染接口未启用');
            const [key, part] = pathname.slice('/api/render/'.length).split('/');
            if (part === 'theme') {
              if (!render.theme) throw new ResumeError('NOT_FOUND', '渲染接口未启用');
              send(200, { theme: render.theme(key) });
              return;
            }
            send(200, render.snapshot(key));
            return;
          }
          if (pathname === '/api/export-requests' && request.method === 'GET') {
            send(200, { requests: approvals.pending() });
            return;
          }
          if (pathname === '/api/export-log' && request.method === 'GET') {
            send(200, { exports: repository.exportLog() });
            return;
          }
          const exportRequest = pathname.match(/^\/api\/export-requests\/([a-f0-9-]{36})(?:\/(approve|decline))?$/);
          if (exportRequest && !exportRequest[2] && request.method === 'GET') {
            // The agent waits here in turns shorter than its request timeout.
            const waited = await approvals.wait(
              exportRequest[1],
              Math.min(Math.max(Number(url.searchParams.get('wait')) || 0, 0), 25000),
            );
            if (waited.status === 'declined') throw new ResumeError('EXPORT_DECLINED', '用户拒绝了这次导出');
            if (waited.status === 'expired')
              throw new ResumeError('EXPORT_DECLINED', '用户 5 分钟内没有处理，这次导出已取消');
            send(200, requestStatus(waited));
            return;
          }
          if (exportRequest && exportRequest[2] && request.method === 'POST') {
            if (agent) throw new ResumeError('PRIVACY_MODE', '导出请求只能由用户在网页里批准或拒绝');
            await body(request);
            if (exportRequest[2] === 'decline') {
              approvals.decline(exportRequest[1]);
              json(response, 200, { status: 'declined' });
              return;
            }
            if (!render) throw new ResumeError('NOT_FOUND', '渲染接口未启用');
            if (!(await fileAccess())) throw new ResumeError('STORAGE_FAILED', FILE_ACCESS_LOST);
            const pdf = await approvals.approve(exportRequest[1], async (approved) => {
              const current = await service.get(approved.resumeId);
              if (current.revision !== approved.revision) {
                approvals.changed(approved.resumeId, current.revision);
                throw new ResumeError('REVISION_CONFLICT', CHANGED_AFTER_REQUEST, current.revision);
              }
              const result = await render!.export(approved.resumeId, approved.revision);
              return { result: result.pdf, pages: (result.report as { pageCount: number }).pageCount };
            });
            const approved = approvals.get(exportRequest[1]);
            response.writeHead(200, {
              'Content-Type': 'application/pdf',
              'Cache-Control': 'no-store',
              'X-Resume-Revision': String(approved.revision),
              'X-Resume-Pages': String(approved.pages),
            });
            response.end(pdf);
            return;
          }
          if (pathname === '/api/import' && request.method === 'POST') {
            send(201, await service.importNew((await body(request)).value));
            return;
          }
          if (pathname === '/api/resumes') {
            if (request.method === 'GET') {
              send(200, await service.list());
              return;
            }
            if (request.method === 'POST') {
              const { mutationId, ...document } = await body(request);
              send(201, await service.create(document, mutationId as string | undefined));
              return;
            }
          }
          const match = pathname.match(
            /^\/api\/resumes\/([a-zA-Z0-9_-]{1,128})(?:\/(duplicate|validate|replace|restore|inspect|export|preview|history|source-diff))?$/,
          );
          if (!match) throw new ResumeError('NOT_FOUND', '接口不存在');
          const [, id, action] = match;
          if (!action && request.method === 'GET') {
            const revision = url.searchParams.get('revision');
            send(200, revision === null ? await service.get(id) : await repository.at(id, Number(revision)));
            return;
          }
          if (action === 'validate' && request.method === 'GET') {
            send(200, await service.validate(id));
            return;
          }
          if (action === 'source-diff' && request.method === 'GET') {
            const result = await repository.sourceChanges(id);
            send(200, result ? describeSourceChanges(result) : { sourceId: null, changes: [], paths: [] });
            return;
          }
          if (action === 'history' && request.method === 'GET') {
            send(200, { revisions: await repository.history(id) });
            return;
          }
          if (action === 'duplicate' && request.method === 'POST') {
            const input = await body(request);
            send(
              201,
              await service.duplicate(id, input.name as string | undefined, {
                mutationId: input.mutationId as string | undefined,
                expectedSourceRevision: input.expectedSourceRevision as number | undefined,
                ...(input.parentId === undefined ? {} : { parentId: String(input.parentId) }),
              }),
            );
            return;
          }
          if ((action === 'inspect' || action === 'export' || action === 'preview') && request.method === 'POST') {
            if (!render) throw new ResumeError('NOT_FOUND', '渲染接口未启用');
            if (!(await fileAccess())) throw new ResumeError('STORAGE_FAILED', FILE_ACCESS_LOST);
            const input = await body(request);
            const revision = input.revision as number;
            if (
              !Number.isSafeInteger(revision) ||
              revision < 1 ||
              (input.maxPages !== undefined &&
                (!Number.isSafeInteger(input.maxPages) || (input.maxPages as number) < 1))
            )
              throw new ResumeError('VALIDATION_FAILED', '非法 revision 或 maxPages');
            if (action === 'inspect') {
              send(200, await render.inspect(id, revision, input.maxPages as number | undefined));
              return;
            }
            if (action === 'preview') {
              if (!render.preview) throw new ResumeError('NOT_FOUND', '预览图片接口未启用');
              send(
                200,
                await render.preview(id, revision, view && { fields: [...view.fields], patterns: view.patterns() }),
              );
              return;
            }
            if (view && agent) {
              // The PDF has the real values: the person approves it in the web page, where it downloads; the agent waits on the request.
              const current = await service.get(id);
              if (current.revision !== revision)
                throw new ResumeError(
                  'SNAPSHOT_UNAVAILABLE',
                  `只能导出当前版本：这份简历现在是第 ${current.revision} 版，请重新检查后再请求`,
                  current.revision,
                );
              const waiting = approvals.existing(id, revision);
              if (waiting) {
                send(202, requestStatus(waiting));
                return;
              }
              const report = (await render.inspect(id, revision)) as { pageCount: number };
              const opened = approvals.open({
                resumeId: id,
                name: current.name,
                revision,
                pages: report.pageCount,
                fields: filledFields(current, privacy, repository.privateStore()),
              });
              // A save while the layout was checked is a save after the request.
              const latest = await service.get(id);
              if (latest.revision !== revision) approvals.changed(id, latest.revision);
              send(202, requestStatus(approvals.get(opened.requestId)));
              return;
            }
            const result = await render.export(id, revision);
            if (view)
              logExport({
                at: Date.now(),
                resumeId: id,
                name: (await repository.at(id, revision)).name,
                revision,
                pages: (result.report as { pageCount: number }).pageCount,
                outcome: 'web',
              });
            response.writeHead(200, {
              'Content-Type': 'application/pdf',
              'Cache-Control': 'no-store',
              'X-Resume-Revision': String(revision),
            });
            response.end(result.pdf);
            return;
          }
          const input = await body(request);
          const mutationId = input.mutationId as string;
          descriptions.set(`${id}:${mutationId}`, {
            source: request.headers.authorization ? 'agent' : 'human',
            paths: Array.isArray(input.operations)
              ? input.operations.map((operation) => String(operation.path))
              : [action ?? 'delete'],
          });
          // The example mark comes only from creating the built-in example; an agent may take it off, not put it on.
          if (
            agent &&
            Array.isArray(input.operations) &&
            input.operations.some(
              (operation) => operation?.path === '/sample' && !['remove', 'test'].includes(operation.op),
            )
          )
            throw new ResumeError('VALIDATION_FAILED', '示例标记只在创建内置示例时产生，agent 只能 remove /sample');
          try {
            if (!action && request.method === 'PATCH')
              send(200, await service.patch(id, input as unknown as ResumePatch));
            else if (!action && request.method === 'DELETE') {
              await service.delete(id, input as unknown as WriteIdentity);
              send(200, { deleted: true });
            } else if (action === 'replace' && request.method === 'POST')
              send(
                200,
                await service.replace(
                  id,
                  input as unknown as WriteIdentity,
                  input.document as Pick<ResumeDocument, 'data' | 'appearance'>,
                ),
              );
            else if (action === 'restore' && request.method === 'POST')
              send(200, await service.restorePrevious(id, input as unknown as WriteIdentity));
            else throw new ResumeError('NOT_FOUND', '不支持的操作');
          } finally {
            descriptions.delete(`${id}:${mutationId}`);
          }
          return;
        }
        if (request.method !== 'GET' && request.method !== 'HEAD') throw new ResumeError('NOT_FOUND', '不支持的请求');
        const relative = pathname === '/' || pathname === '/render' ? 'index.html' : pathname.slice(1);
        // Only files found under dist at startup are served; the lookup never touches the file system.
        let content = assets.get(relative);
        if (!content) throw new ResumeError('NOT_FOUND', '文件不存在');
        const mime: Record<string, string> = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.svg': 'image/svg+xml',
          '.ico': 'image/x-icon',
          '.woff': 'font/woff',
          '.woff2': 'font/woff2',
          '.ttf': 'font/ttf',
        };
        if (relative === 'index.html')
          content = Buffer.from(
            content
              .toString()
              .replace('<head>', `<head><meta name="lulicv-workspace" content="${manifest.workspaceId}">`),
          );
        // Installed themes are third-party CSS: the page itself may only reach this Bridge, whatever a stylesheet asks for.
        if (relative === 'index.html') response.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
        response.writeHead(200, {
          'Content-Type': mime[path.extname(relative)] ?? 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
        response.end(request.method === 'HEAD' ? undefined : content);
      })
      .catch((error) => {
        if (response.headersSent) {
          response.destroy();
          return;
        }
        const code =
          error instanceof ResumeError
            ? error.code
            : error instanceof Error && error.message.startsWith('VALIDATION_FAILED')
              ? 'VALIDATION_FAILED'
              : 'STORAGE_FAILED';
        const status =
          code === 'UNAUTHORIZED' || code === 'PRIVACY_MODE'
            ? 403
            : code === 'NOT_FOUND'
              ? 404
              : [
                    'REVISION_CONFLICT',
                    'EXTERNAL_CHANGE',
                    'SNAPSHOT_UNAVAILABLE',
                    'EXPORT_PENDING',
                    'EXPORT_DECLINED',
                  ].includes(code)
                ? 409
                : code === 'VALIDATION_FAILED'
                  ? 400
                  : code === 'RENDER_TIMEOUT'
                    ? 504
                    : 500;
        send(status, {
          code,
          message: error instanceof Error ? error.message : '请求失败',
          currentRevision: error instanceof ResumeError ? error.currentRevision : undefined,
        });
      });
  });
  const broadcast = (event: string, data: unknown) => {
    for (const stream of streams) stream.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const unsubscribeCommits = repository.subscribe((event) => {
    broadcast('commit', {
      ...event,
      ...(descriptions.get(`${event.resumeId}:${event.mutationId}`) ?? { source: event.source, paths: [] }),
    });
    approvals.changed(event.resumeId, event.revision);
  });
  const unsubscribeStore = repository.onPrivateStore(() => {
    const settings = repository.privacy();
    broadcast('privacy', { enabled: settings.enabled, fields: settings.fields });
  });
  const unsubscribe = () => {
    unsubscribeCommits();
    unsubscribeStore();
  };
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port ?? manifest.bridgePort ?? 0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('监听失败');
    origin = `http://127.0.0.1:${address.port}`;
    runtime = { pid: process.pid, origin, token, workspaceId: manifest.workspaceId };
    if (manifest.bridgePort !== address.port)
      await atomicWrite(path.join(repository.root, 'lulicv.json'), { ...manifest, bridgePort: address.port });
    render = options.renderer?.(service, runtime, themes);
    await atomicWrite(path.join(repository.root, '.lulicv/runtime.json'), runtime);
  } catch (error) {
    unsubscribe();
    server.close();
    await render?.close().catch(() => {});
    await repository.close();
    throw error;
  }
  function closeBridge(): Promise<void> {
    if (closeTask) return closeTask;
    closing = true;
    render?.beginShutdown?.();
    closeTask = (async () => {
      // Offline SSE peers must not hold shutdown open; renderer reads use separate connections.
      unsubscribe();
      approvals.close();
      for (const stream of streams) {
        stream.end();
        stream.destroy();
      }
      // Keep static/render reads available until the active Chromium job finishes.
      let renderError: unknown;
      try {
        await render?.close();
      } catch (error) {
        renderError = error;
      }
      // Peers that vanished mid-request (offline browser, dropped loopback socket) are not idle,
      // so shutdown must drop every remaining connection instead of waiting on them.
      try {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      } finally {
        await repository.close();
      }
      if (renderError) throw renderError;
    })();
    return closeTask;
  }
  return { service, repository, runtime, origin, close: closeBridge };
}

const BROWSER_SESSION_MS = 90 * 24 * 60 * 60 * 1000;
// The policy is about where the page may load things from. Ajv compiles the resume schema with new Function, hence 'unsafe-eval'.
export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'";
export const FILE_ACCESS_LOST =
  'Bridge 已无法读取安装文件（常见于启动它的 agent 会话结束后），排版检查和导出暂不可用，网页编辑不受影响。请在当前会话执行 stop，再 preview 重新启动 Bridge';

/** Every regular file under dist keyed by its URL path (forward slashes); symlinks are skipped. */
async function loadAssets(dist: string): Promise<Map<string, Buffer>> {
  const assets = new Map<string, Buffer>();
  const walk = async (directory: string, prefix: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), `${prefix}${entry.name}/`);
      else if (entry.isFile()) assets.set(`${prefix}${entry.name}`, await readFile(path.join(directory, entry.name)));
    }
  };
  await walk(dist, '');
  return assets;
}
