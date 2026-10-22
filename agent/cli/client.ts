import { ResumeError } from '../../src/core/errors';
import type { Runtime } from '../bridge/server';
import { readFile, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { clearStaleLock } from '../bridge/workspace';

export async function workspaceIdAt(root: string): Promise<string> {
  const manifest = JSON.parse(await readFile(path.join(root, 'lulicv.json'), 'utf8'));
  if (
    manifest.workspaceVersion !== 1 ||
    typeof manifest.workspaceId !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(manifest.workspaceId)
  )
    throw new ResumeError('VALIDATION_FAILED', '工作区配置无效');
  return manifest.workspaceId;
}

// Nothing reached a Bridge, so nothing was written: the caller starts one and retries, instead of treating the result as unknown.
const notRunning = () => new ResumeError('BRIDGE_NOT_RUNNING', '这个工作区的 Bridge 没有运行，请求没有发出');

export async function runtimeAt(root: string, expectedWorkspaceId?: string): Promise<Runtime> {
  const file = await readFile(path.join(root, '.lulicv/runtime.json'), 'utf8').catch((error: NodeJS.ErrnoException) => {
    throw error.code === 'ENOENT' ? notRunning() : error;
  });
  const runtime = JSON.parse(file) as Runtime;
  const url = new URL(runtime.origin);
  const workspaceId = await workspaceIdAt(root);
  if (
    url.hostname !== '127.0.0.1' ||
    url.protocol !== 'http:' ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    typeof runtime.token !== 'string' ||
    !/^[a-f0-9]{64}$/.test(runtime.token) ||
    !Number.isSafeInteger(runtime.pid) ||
    runtime.pid < 1 ||
    runtime.workspaceId !== workspaceId ||
    (expectedWorkspaceId !== undefined && expectedWorkspaceId !== workspaceId)
  )
    throw new ResumeError('VALIDATION_FAILED', '运行信息与指定工作区不匹配');
  const health = (await (await bridgeRequest(runtime, '/api/health')).json()) as { workspaceId: string; pid: number };
  if (health.workspaceId !== workspaceId || runtime.pid !== health.pid)
    throw new ResumeError('VALIDATION_FAILED', 'Bridge 与指定工作区不匹配');
  return runtime;
}
export async function bridgeRequest(
  runtime: Runtime,
  route: string,
  method = 'GET',
  value?: unknown,
  timeout = 35000,
): Promise<Response> {
  const response = await fetch(runtime.origin + route, {
    method,
    redirect: 'error',
    headers: {
      Authorization: `Bearer ${runtime.token}`,
      ...(value === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: value === undefined ? undefined : JSON.stringify(value),
    signal: AbortSignal.timeout(timeout),
  })
    // Only a refused connection proves the request was never sent; a reset or timeout leaves the result unknown.
    .catch((error: Error) => {
      throw (error.cause as NodeJS.ErrnoException | undefined)?.code === 'ECONNREFUSED' ? notRunning() : error;
    });
  if (!response.ok) {
    const error = (await response.json()) as { code: ResumeError['code']; message: string; currentRevision?: number };
    throw new ResumeError(error.code, error.message, error.currentRevision);
  }
  return response;
}

/** An export in privacy mode, waiting for the person to approve it in the web page; the PDF downloads there, never to the agent. */
export interface ExportApproval {
  requestId: string;
  status: 'pending' | 'approved';
  id: string;
  revision: number;
  pages: number;
  expiresAt?: number;
  webOpen?: boolean;
  message: string;
}
/**
 * Waits on an export request in turns shorter than the request timeout, until the person approves it, declines it or
 * lets it expire (both EXPORT_DECLINED), or `until` passes. `onWait` sees each pending state.
 */
export async function awaitExport(
  runtime: Runtime,
  state: ExportApproval,
  until = Infinity,
  onWait?: (state: ExportApproval) => void,
): Promise<ExportApproval> {
  while (state.status === 'pending') {
    onWait?.(state);
    const wait = Math.min(25000, until - Date.now());
    if (wait <= 0) break;
    state = (await (
      await bridgeRequest(runtime, `/api/export-requests/${state.requestId}?wait=${Math.ceil(wait)}`)
    ).json()) as ExportApproval;
  }
  return state;
}

/**
 * This workspace's Bridge, started detached from `cli` (a CLI entry that accepts `serve`) when none is running, so no
 * command needs a separate start step. `recoveredLock` is the pid of a Bridge that had exited without cleaning up.
 */
export async function ensureBridge(
  root: string,
  cli: string,
  options: { port?: string; expectedWorkspaceId?: string } = {},
): Promise<{ runtime: Runtime; recoveredLock?: number }> {
  try {
    return { runtime: await runtimeAt(root, options.expectedWorkspaceId) };
  } catch (error) {
    if (
      !(error instanceof TypeError) &&
      !(error instanceof ResumeError && (error.code === 'BRIDGE_NOT_RUNNING' || error.code === 'UNAUTHORIZED'))
    )
      throw error;
  }
  // A Bridge that exited without cleaning up leaves its lock behind; its owner is gone, so it is safe to clear.
  const recoveredLock = await clearStaleLock(root);
  const logFile = path.join(root, '.lulicv/bridge.log');
  const log = await open(logFile, 'a', 0o600);
  let exited = false;
  try {
    const child = spawn(
      process.execPath,
      [cli, 'serve', '--workspace', root, ...(options.port ? ['--port', options.port] : [])],
      { detached: true, stdio: ['ignore', log.fd, log.fd] },
    );
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.once('exit', () => {
      exited = true;
    });
    child.unref();
  } finally {
    await log.close();
  }
  const lastLogLine = async () =>
    (await readFile(logFile, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).at(-1);
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      return {
        runtime: await runtimeAt(root, options.expectedWorkspaceId),
        ...(recoveredLock ? { recoveredLock } : {}),
      };
    } catch {
      /* Not up yet. */
    }
    // Two commands starting at once: the one that lost the lock waits for the winner instead of failing.
    if (exited && !(await lastLogLine())?.includes('WORKSPACE_LOCKED')) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  // Report why the Bridge did not start (its last log line, the error JSON a failed serve writes) instead of a generic failure.
  const line = await lastLogLine();
  let reason = line;
  try {
    const logged = JSON.parse(line ?? '') as { message?: unknown };
    if (typeof logged.message === 'string') reason = logged.message;
  } catch {
    /* A plain line. */
  }
  throw new ResumeError(
    line?.includes('WORKSPACE_LOCKED') ? 'WORKSPACE_LOCKED' : 'STORAGE_FAILED',
    `Bridge 启动失败${reason ? `：${reason.slice(0, 300)}` : ''}（完整日志见 .lulicv/bridge.log）`,
  );
}

// How to show the editor to the person, for any result that hands out a fresh sign-in url.
export const OPEN_EDITOR =
  '在用户正看着的地方打开 url：先找客户端里的浏览器工具（可能来自另一个 Skill 或插件，描述里会提到打开或浏览网页），有就加载它来打开；没有，或者它打不开本机页面，就把完整的 url 作为可点击的链接发给用户，很多客户端里点开对话中的链接就会在它自己的浏览器里打开。链接要在 5 分钟内打开，只能用一次；打开后这个浏览器会保持登录，不用再重新打开。没来得及打开就重新运行 preview 拿新链接。';
/** A one-time sign-in link for the person's browser, valid for five minutes. */
export async function editorEntry(runtime: Runtime) {
  return (await (await bridgeRequest(runtime, '/api/preview-entry', 'POST', {})).json()) as {
    url: string;
    expiresAt: number;
  };
}
/**
 * After a write: whether the person has the editor open to watch it, and if not a fresh link to open it. The write has
 * already succeeded, so a failure here leaves the status out rather than making the result look unknown.
 */
export async function editorStatus(runtime: Runtime) {
  try {
    const { editors } = (await (await bridgeRequest(runtime, '/api/health')).json()) as { editors: number };
    if (editors > 0) return { open: true };
    return {
      open: false,
      ...(await editorEntry(runtime)),
      nextAction: `用户没有打开编辑器，看不到这次修改；打开后，后面的修改都能实时看到。${OPEN_EDITOR}如果这次会话里打开过、是用户自己关掉的，就不要再打开。`,
    };
  } catch {
    return undefined;
  }
}
