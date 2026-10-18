import { DatabaseSync } from 'node:sqlite';
import { PRIVACY_NOTICE } from '../../src/core/privacy';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile, spawn } from 'node:child_process';
import { checkSqlite, compareVersions, isRelease, MIN_SQLITE, SUPPORTED_NODE } from './version';
import { CHROMIUM_NAMES, launchChromium } from './chromium';
import { bridgeRequest, runtimeAt, workspaceIdAt } from '../cli/client';
import { lockOwner } from '../bridge/workspace';
import { buildInfo, buildLabel } from './build';
import { ResumeError } from '../../src/core/errors';
import { isWorkspace, type WorkspaceLocation } from './workspace-location';
export interface Diagnostic {
  name: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  nextAction?: string;
}
const rootAt = () => fileURLToPath(new URL('../', import.meta.url));
export async function doctor(location?: WorkspaceLocation, installedRoot = rootAt()) {
  const checks: Diagnostic[] = [{ name: 'version', status: 'ok', message: `CVSlate ${buildLabel()}` }];
  // Asked first and awaited last: npm takes a second or two, while the browser check runs. Source runs have no version to compare.
  const update =
    buildInfo.version === 'dev' ? undefined : publishedTags().then((tags) => updateCheck(buildInfo.version, tags));
  checks.push({ name: 'node', status: 'ok', message: process.versions.node });
  const db = new DatabaseSync(':memory:');
  try {
    const version = String(db.prepare('SELECT sqlite_version() AS version').get()!.version);
    checkSqlite(version);
    checks.push({ name: 'sqlite', status: 'ok', message: version });
  } catch {
    checks.push({
      name: 'sqlite',
      status: 'error',
      message: 'SQLite 版本不兼容',
      nextAction: `换用自带 SQLite ${MIN_SQLITE} 或更新版本的 Node：${SUPPORTED_NODE}`,
    });
  } finally {
    db.close();
  }
  try {
    const html = await readFile(path.join(installedRoot, 'dist/index.html'), 'utf8');
    for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g))
      await access(path.join(installedRoot, 'dist', match[1]));
    for (const match of html.matchAll(/href="(\/assets\/[^"?#]+\.css)"/g)) {
      const css = await readFile(path.join(installedRoot, 'dist', match[1]), 'utf8');
      for (const url of css.matchAll(/url\(["']?([^)'" ]+)["']?\)/g)) {
        if (url[1].startsWith('data:')) continue;
        const file = path.resolve(installedRoot, 'dist', url[1].startsWith('/') ? '.' + url[1] : 'assets/' + url[1]);
        if (!file.startsWith(path.join(installedRoot, 'dist') + path.sep)) throw new Error('Invalid asset');
        await access(file);
      }
    }
    const assets = await readdir(path.join(installedRoot, 'dist/assets'));
    for (const font of ['MiSans', 'noto-sans-sc', 'LXGW'])
      if (!assets.some((file) => file.includes(font))) throw new Error('Font assets missing');
    for (const file of [
      'agent-dist/cli.mjs',
      'agent-dist/cli-main.mjs',
      'agent-dist/mcp.mjs',
      'agent-dist/mcp-main.mjs',
      'schema/resume-data.schema.json',
      'schema/theme-catalog.json',
    ])
      await access(path.join(installedRoot, file));
    checks.push({ name: 'resources', status: 'ok', message: 'CLI / MCP / Web / 中文字体 / Schema 完整' });
  } catch {
    checks.push({
      name: 'resources',
      status: 'error',
      message: '安装资源缺失',
      nextAction: '重新安装完整 CVSlate tgz',
    });
  }
  // Playwright is loaded on demand: it is many files, and most CLI commands never launch a browser.
  try {
    const { browser, source } = await launchChromium(10000);
    await browser.close();
    checks.push({ name: 'chromium', status: 'ok', message: `${CHROMIUM_NAMES[source]} 可启动` });
  } catch {
    checks.push({
      name: 'chromium',
      status: 'error',
      message: '没有可用的 Chromium、Chrome 或 Edge',
      nextAction: '执行 cvslate setup，或安装 Chrome / Edge；Linux 还需安装浏览器系统依赖',
    });
  }
  // Without a location only the installation is checked. A directory that cannot be read goes on to the
  // workspace checks, which report it.
  const workspace = location?.directory;
  if (workspace && !(await isWorkspace(workspace).catch(() => true))) {
    if (location?.source === 'chosen')
      checks.push({
        name: 'workspace',
        status: 'error',
        message: `找不到选定的工作区 ${workspace}`,
        nextAction: '可能被移动了，或者所在的磁盘没有连接；要改用别的位置，执行 cvslate workspace <directory>',
      });
    else
      checks.push({ name: 'workspace', status: 'ok', message: `工作区 ${workspace} 还没有建，第一次使用时自动创建` });
  } else if (workspace) {
    try {
      const owner = await lockOwner(workspace);
      if (owner && !owner.alive)
        checks.push({
          name: 'lock',
          status: 'warning',
          message: `工作区锁残留：记录的 Bridge 进程 ${owner.pid} 已退出`,
          nextAction: '下一条需要 Bridge 的命令（如 cvslate tree）会自动清理；也可执行 cvslate unlock',
        });
    } catch {
      checks.push({
        name: 'lock',
        status: 'error',
        message: '工作区锁记录损坏',
        nextAction: '确认没有 Bridge 运行后，按恢复文档人工检查 .cvslate/lock',
      });
    }
    try {
      await workspaceIdAt(workspace);
      checks.push({ name: 'workspace', status: 'ok', message: `工作区 ${workspace}` });
    } catch {
      checks.push({
        name: 'workspace',
        status: 'error',
        message: `工作区 ${workspace} 的配置文件 cvslate.json 无效`,
        nextAction: '按恢复文档检查这个文件，或从备份恢复',
      });
    }
    try {
      const runtime = await runtimeAt(workspace);
      const { build, fileAccess, privacyMode } = (await (await bridgeRequest(runtime, '/api/health')).json()) as {
        build: { version: string; commit: string };
        fileAccess: boolean;
        privacyMode: boolean;
      };
      if (privacyMode) checks.push({ name: 'privacy', status: 'ok', message: PRIVACY_NOTICE });
      if (!fileAccess)
        checks.push({
          name: 'bridge-files',
          status: 'error',
          message: 'Bridge 正在运行，但已无法读取安装文件（常见于启动它的 agent 会话结束后）；排版检查和导出会失败',
          nextAction: '在当前会话执行 cvslate stop；下一条命令会重新启动 Bridge',
        });
      // A Bridge started before a rebuild or reinstall keeps serving its own build until restarted.
      if (build.version !== buildInfo.version || build.commit !== buildInfo.commit)
        checks.push({
          name: 'bridge',
          status: 'warning',
          message: `运行中的 Bridge 是 ${buildLabel(build)}，与当前 CLI ${buildLabel()} 不一致`,
          nextAction: '执行 cvslate stop；下一条命令会用当前构建重新启动 Bridge',
        });
      else
        checks.push({
          name: 'bridge',
          status: 'ok',
          message: `Bridge ${buildLabel(build)} 身份有效，与当前 CLI 同一构建`,
        });
    } catch (error) {
      // Not running is the normal state between sessions: the next command that needs the Bridge starts it.
      if (error instanceof ResumeError && error.code === 'BRIDGE_NOT_RUNNING')
        checks.push({ name: 'bridge', status: 'ok', message: 'Bridge 未运行；需要它的命令会自动启动' });
      else
        checks.push({
          name: 'bridge',
          status: 'warning',
          message: 'Bridge 连接信息无效',
          nextAction: '执行 cvslate stop 后重试；仍失败按恢复文档检查 .cvslate/',
        });
    }
  }
  // A Bridge that lost file access also makes the installation look incomplete; restarting it is the lighter fix, so say that first.
  const resources = checks.find((check) => check.name === 'resources' && check.status === 'error');
  if (resources && checks.some((check) => check.name === 'bridge-files'))
    Object.assign(resources, {
      status: 'warning',
      message: '安装资源暂时读不到，可能与 Bridge 丢失文件访问是同一原因',
      nextAction: '先按 bridge-files 的提示 stop，让下一条命令重新启动 Bridge；之后仍报缺失再重新安装 tgz',
    });
  if (update) checks.splice(1, 0, await update);
  return { valid: !checks.some((check) => check.status === 'error'), checks };
}
// A preview is offered the newest preview or release; a release only newer releases. Updating stays the user's choice.
export function updateCheck(current: string, tags: Record<string, unknown> | undefined): Diagnostic {
  if (!tags)
    return { name: 'update', status: 'ok', message: '没能查询新版本（离线，或 npm 源上还没有 cvslate），不影响使用' };
  const newest = [tags.latest, current.includes('-') ? tags.next : undefined]
    .filter(isRelease)
    .sort(compareVersions)
    .at(-1);
  if (!newest || compareVersions(newest, current) <= 0)
    return { name: 'update', status: 'ok', message: `${current} 是最新版本` };
  return {
    name: 'update',
    status: 'warning',
    message: `CVSlate ${newest} 已发布，当前是 ${current}`,
    nextAction: '告诉用户有新版本，由用户决定是否更新；更新方法见 Skill 的 references/install.md 中 Updating 一节',
  };
}
// Only the headless shell: rendering never shows a window, and the full browser would double the download.
export function chromiumInstaller() {
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve('playwright/package.json');
  return {
    executable: process.execPath,
    args: [path.join(path.dirname(packagePath), 'cli.js'), 'install', 'chromium', '--only-shell'],
  };
}
const NPMMIRROR_PLAYWRIGHT = 'https://cdn.npmmirror.com/binaries/playwright';
// Runs the npm beside this Node (where the installer found it), so it sees the config the runtime was installed with.
function npm(args: string[], node: string, timeout: number): Promise<string | undefined> {
  const cli =
    process.platform === 'win32'
      ? path.join(path.dirname(node), 'node_modules/npm/bin/npm-cli.js')
      : path.join(path.dirname(node), '../lib/node_modules/npm/bin/npm-cli.js');
  return new Promise((resolve) => {
    execFile(node, [cli, ...args], { timeout }, (error, stdout) =>
      resolve(error ? undefined : stdout.trim() || undefined),
    );
  });
}
export const npmRegistry = (node = process.execPath) => npm(['config', 'get', 'registry'], node, 30000);
// @arilabo/cvslate's dist-tags on the user's registry; offline, or not published there, gives undefined.
export async function publishedTags(node = process.execPath): Promise<Record<string, unknown> | undefined> {
  const output = await npm(['view', '@arilabo/cvslate', 'dist-tags', '--json'], node, 15000);
  try {
    const tags = output && JSON.parse(output);
    return tags && typeof tags === 'object' && !Array.isArray(tags) ? tags : undefined;
  } catch {
    return undefined;
  }
}
// Playwright's own override, under either name it reads (an npm config value reaches it as npm_config_*).
function userDownloadHost(env: NodeJS.ProcessEnv) {
  return ['PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST', 'PLAYWRIGHT_DOWNLOAD_HOST'].some(
    (name) => env[name] ?? env[`npm_config_${name.toLowerCase()}`],
  );
}
// cdn.playwright.dev serves Chromium from Google storage, which from mainland China crawls rather than fails. An npm that
// already goes through npmmirror suggests the user is there, so take Chromium from npmmirror's copy as well.
export function chromiumDownloadHost(env: NodeJS.ProcessEnv, registry?: string) {
  if (userDownloadHost(env) || !registry) return undefined;
  try {
    const host = new URL(registry).hostname;
    return host === 'npmmirror.com' || host.endsWith('.npmmirror.com') ? NPMMIRROR_PLAYWRIGHT : undefined;
  } catch {
    return undefined;
  }
}
export async function setupChromium(
  command = chromiumInstaller(),
  registry = npmRegistry,
): Promise<{ installed: true; downloadHost?: string }> {
  const downloadHost = chromiumDownloadHost(process.env, await registry());
  if (downloadHost)
    process.stderr.write(
      `npm uses npmmirror, so Chromium is downloaded from ${downloadHost}; set PLAYWRIGHT_DOWNLOAD_HOST to use another host.\n`,
    );
  const hint =
    downloadHost || userDownloadHost(process.env)
      ? ''
      : `；默认下载源在中国大陆可能极慢，可设置环境变量 PLAYWRIGHT_DOWNLOAD_HOST=${NPMMIRROR_PLAYWRIGHT} 后重试`;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
      env: downloadHost ? { ...process.env, PLAYWRIGHT_DOWNLOAD_HOST: downloadHost } : process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => process.stderr.write(chunk));
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    const interrupt = () => {
      child.kill('SIGTERM');
    };
    const cleanup = () => {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', interrupt);
    };
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    child.once('error', () => {
      cleanup();
      reject(new ResumeError('STORAGE_FAILED', 'Chromium installer 无法启动；检查安装包与 Node'));
    });
    child.once('exit', (code) => {
      cleanup();
      if (code === 0) resolve();
      else
        reject(
          new ResumeError(
            'STORAGE_FAILED',
            `Chromium 安装失败；检查网络、磁盘与权限后重试 cvslate setup，或安装 Chrome / Edge${hint}`,
          ),
        );
    });
  });
  return downloadHost ? { installed: true, downloadHost } : { installed: true };
}
