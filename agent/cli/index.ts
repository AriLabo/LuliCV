#!/usr/bin/env node
import schema from '../../schema/resume-data.schema.json' with { type: 'json' };
import { errorResult } from '../runtime/guidance';
import { layoutOptions, themeCatalog } from '../../src/core/document';
import { openBrowser } from '../runtime/browser';
import { doctor, setupChromium } from '../runtime/environment';
import { parseArgs } from 'node:util';
import { readFile, lstat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { clearStaleLock, processAlive, unlockWorkspace } from '../bridge/workspace';
import { chooseWorkspace, isWorkspace, locateWorkspace, openWorkspace } from '../runtime/workspace-location';
import { startBridge, type Runtime } from '../bridge/server';
import {
  awaitExport,
  bridgeRequest,
  editorEntry,
  editorStatus,
  ensureBridge,
  OPEN_EDITOR,
  runtimeAt,
  type ExportApproval,
} from './client';
import { writeOutput } from './output';
import { ResumeError } from '../../src/core/errors';
import type { ResumeDocument } from '../../src/core/types';
import { diffDocuments } from '../../src/core/mutation';
import { buildInfo } from '../runtime/build';
import { summarizeChanges } from '../../src/core/change-summary';
import { privateFieldOptions, type PrivacySettings } from '../../src/core/privacy';
import { restoreWorkspace } from '../bridge/recovery';
import { WorkspaceRenderer } from '../renderer/renderer';
import { ThemeStore } from '../bridge/themes';
import { applyTheme, checkTheme, installTheme, newTheme, removeTheme, themeHelp } from './theme';

// Agents only need identity and revision after a write; full documents can be thousands of characters.
function summary({ id, name, revision, updatedAt, target, source, parentId, purpose, sample }: ResumeDocument) {
  return {
    id,
    name,
    revision,
    updatedAt,
    ...(parentId ? { parentId } : {}),
    ...(purpose ? { purpose } : {}),
    ...(sample ? { sample } : {}),
    ...(target ? { target: { company: target.company, role: target.role } } : {}),
    ...(source ? { source } : {}),
  };
}
async function readStdin() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}
const help =
  'lulicv version | doctor | setup | themes | schema | import --file FILE --mutation-id ID [--name NAME] | import --sample --mutation-id ID [--name NAME]（内置的虚构示例简历，供试用） | workspace [<directory>]（查看或改用工作区位置） | preview [--open]（返回编辑器的一次性链接；--open 同时用系统浏览器打开） | list | tree | get <id> [--revision N] | history <id> | duplicate <id> --mutation-id ID [--revision N] [--parent ID] | diff <id> --source | diff <id> --against <id> | diff <id> --from N [--to N] | patch <id> --file patch.json（- 表示标准输入） [--inspect [--images DIR] [--max-pages N]] | validate <id> | inspect <id> [--revision N] [--max-pages N] [--images DIR] | export <id> --revision N --output file.pdf（隐私模式下等用户在网页批准，PDF 下载到用户浏览器，不需要 --output） | restore <id> --to N --revision M（把 rN 的内容恢复成最新版本，M 是最近读取到的 revision；之后的版本留在修改记录里） | delete <id> --revision N | backup --output file.db | restore-workspace --file file.db | privacy [on [--fields name,phone,…]] | stop | unlock | ' +
  themeHelp +
  '\nlist / import / duplicate / patch / restore 加 --quiet 只输出 id、名称、revision 等摘要，get 加 --quiet 省略 JD 原文';
// Flags each command accepts beyond --workspace / --help; anything else is an error rather than silently ignored.
const commandFlags: Record<string, string[]> = {
  version: [],
  history: [],
  delete: ['revision', 'mutation-id'],
  restore: ['to', 'revision', 'mutation-id', 'quiet'],
  doctor: [],
  setup: [],
  themes: [],
  schema: [],
  workspace: [],
  unlock: [],
  stop: [],
  tree: [],
  validate: [],
  import: ['file', 'sample', 'mutation-id', 'name', 'quiet'],
  preview: ['port', 'open', 'no-open'],
  serve: ['port'],
  list: ['quiet'],
  get: ['revision', 'quiet'],
  duplicate: ['mutation-id', 'revision', 'parent', 'name', 'quiet'],
  diff: ['source', 'against', 'from', 'to'],
  patch: ['file', 'quiet', 'inspect', 'images', 'max-pages'],
  inspect: ['revision', 'max-pages', 'images'],
  export: ['revision', 'output'],
  backup: ['output'],
  'restore-workspace': ['file'],
  privacy: ['fields'],
  theme: ['from', 'name', 'output', 'images'],
};
const themeFlags: Record<string, string[]> = {
  new: ['from', 'name', 'output'],
  check: ['images'],
  install: [],
  remove: [],
  use: [],
};
async function inspectRevision(
  runtime: Runtime,
  root: string,
  id: string,
  revision: number,
  values: { images?: string; 'max-pages'?: string },
) {
  const route = `/api/resumes/${id}`;
  const maxPages = values['max-pages'] ? Number(values['max-pages']) : undefined;
  if (maxPages !== undefined && (!Number.isSafeInteger(maxPages) || maxPages < 1))
    throw new ResumeError('VALIDATION_FAILED', '--max-pages 需要正整数');
  if (!values.images)
    return (await (
      await bridgeRequest(runtime, route + '/inspect', 'POST', { revision, ...(maxPages ? { maxPages } : {}) })
    ).json()) as Record<string, unknown>;
  // Page images let the agent look at the real layout; the PDF stays the real-text deliverable.
  const { report, pages, privacy } = (await (
    await bridgeRequest(runtime, route + '/preview', 'POST', { revision })
  ).json()) as { report: { pageCount: number }; pages: string[]; privacy?: unknown };
  const directory = path.resolve(values.images);
  await mkdir(directory, { recursive: true });
  const images: string[] = [];
  for (const [index, page] of pages.entries())
    images.push(
      await writeOutput(
        root,
        path.join(directory, `${id}-r${revision}-page-${index + 1}.jpg`),
        Buffer.from(page, 'base64'),
      ),
    );
  return {
    ...report,
    ...(maxPages ? { constraints: { maxPages, satisfied: report.pageCount <= maxPages } } : {}),
    images,
    ...(privacy ? { privacy } : {}),
  };
}
/** Content differences between two resumes, labelled against the first: what `mine` changed relative to `other`. */
function compareContent(mine: ResumeDocument, other: ResumeDocument) {
  const contentOnly = (document: ResumeDocument): ResumeDocument => ({
    ...document,
    name: '',
    appearance: mine.appearance,
    target: undefined,
    parentId: undefined,
    purpose: undefined,
    sample: undefined,
    source: undefined,
  });
  const paths = diffDocuments(contentOnly(other), contentOnly(mine)).map((operation) => operation.path);
  return {
    id: mine.id,
    against: other.id,
    againstName: other.name,
    changes: summarizeChanges(contentOnly(other), contentOnly(mine)),
    paths: paths.slice(0, 50),
  };
}
// The entry the Bridge is started from: this same build, so it serves exactly what this CLI expects.
const cli = fileURLToPath(import.meta.url);
async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        workspace: { type: 'string' },
        name: { type: 'string' },
        file: { type: 'string' },
        'mutation-id': { type: 'string' },
        revision: { type: 'string' },
        'max-pages': { type: 'string' },
        output: { type: 'string' },
        images: { type: 'string' },
        parent: { type: 'string' },
        source: { type: 'boolean' },
        sample: { type: 'boolean' },
        against: { type: 'string' },
        inspect: { type: 'boolean' },
        port: { type: 'string' },
        open: { type: 'boolean' },
        'no-open': { type: 'boolean' },
        quiet: { type: 'boolean' },
        help: { type: 'boolean' },
        version: { type: 'boolean' },
        from: { type: 'string' },
        to: { type: 'string' },
        fields: { type: 'string' },
      },
    });
  } catch (error) {
    // A mistyped flag is an input error, not an environment failure.
    const flag = error instanceof Error ? /'(-[^' ]+)/.exec(error.message)?.[1] : undefined;
    const command = parseArgs({ allowPositionals: true, strict: false }).positionals[0];
    const allowed = command ? commandFlags[command] : undefined;
    throw new ResumeError(
      'VALIDATION_FAILED',
      `${flag ? `无法识别或缺少取值的参数 ${flag}` : '参数无效'}${allowed?.length ? `；${command} 可用参数: ${allowed.map((name) => '--' + name).join('、')}` : `。${help}`}`,
    );
  }
  const { values, positionals } = parsed;
  const [command, argument] = positionals;
  if (command === 'version' || values.version) {
    process.stdout.write(JSON.stringify({ version: buildInfo.version, commit: buildInfo.commit }) + '\n');
    return;
  }
  if (values.help || !command) {
    process.stdout.write(JSON.stringify({ help }) + '\n');
    return;
  }
  const allowed = commandFlags[command];
  if (!allowed) throw new ResumeError('VALIDATION_FAILED', `未知命令 ${command}。${help}`);
  const unsupported = Object.keys(values).filter(
    (flag) => flag !== 'workspace' && flag !== 'version' && !allowed.includes(flag),
  );
  if (unsupported.length)
    throw new ResumeError(
      'VALIDATION_FAILED',
      `${command} 不支持 ${unsupported.map((flag) => '--' + flag).join('、')}${allowed.length ? `；可用参数: ${allowed.map((flag) => '--' + flag).join('、')}` : ''}`,
    );
  if (values.images && command === 'patch' && !values.inspect)
    throw new ResumeError('VALIDATION_FAILED', 'patch 的 --images 需要与 --inspect 一起使用');
  if (command === 'workspace') {
    if (argument) {
      const previous = await locateWorkspace().then(
        (location) => location.directory,
        () => undefined,
      );
      process.stdout.write(
        JSON.stringify({ workspace: await chooseWorkspace(argument), ...(previous ? { previous } : {}) }) + '\n',
      );
      return;
    }
    const location = await locateWorkspace(values.workspace);
    process.stdout.write(
      JSON.stringify({
        workspace: location.directory,
        source: location.source,
        exists: await isWorkspace(location.directory),
      }) + '\n',
    );
    return;
  }
  if (command === 'doctor') {
    const report = await doctor(await locateWorkspace(values.workspace));
    process.stdout.write(JSON.stringify(report) + '\n');
    if (!report.valid) process.exitCode = 1;
    return;
  }
  if (command === 'setup') {
    process.stdout.write(JSON.stringify(await setupChromium()) + '\n');
    return;
  }
  if (command === 'schema') {
    process.stdout.write(JSON.stringify({ schema }) + '\n');
    return;
  }
  if (command === 'themes') {
    // Installed themes are read straight from the workspace, so this works without a running Bridge.
    const { directory } = await locateWorkspace(values.workspace);
    const installed = (await isWorkspace(directory)) ? await ThemeStore.open(directory) : undefined;
    process.stdout.write(
      JSON.stringify({
        themes: [
          ...themeCatalog.map((theme) => ({ ...theme, source: 'builtin' })),
          ...(installed?.list() ?? []).map((theme) => ({ ...theme, source: 'installed' })),
        ],
        ...(installed?.invalid.length ? { invalid: installed.invalid } : {}),
        layout: layoutOptions,
      }) + '\n',
    );
    return;
  }
  if (command === 'theme') {
    const allowedFlags = themeFlags[argument ?? ''];
    if (!allowedFlags) throw new ResumeError('VALIDATION_FAILED', `theme 需要子命令：${themeHelp}`);
    const extra = (['from', 'name', 'output', 'images'] as const).filter(
      (flag) => values[flag] !== undefined && !allowedFlags.includes(flag),
    );
    if (extra.length)
      throw new ResumeError(
        'VALIDATION_FAILED',
        `theme ${argument} 不支持 ${extra.map((flag) => '--' + flag).join('、')}`,
      );
    const target = positionals[2];
    if (argument === 'new') {
      process.stdout.write(JSON.stringify(await newTheme(target, values)) + '\n');
      return;
    }
    const root = await openWorkspace(await locateWorkspace(values.workspace));
    const { runtime } = await ensureBridge(root, cli);
    if (argument === 'check') {
      const result = await checkTheme(runtime, root, target, values);
      process.stdout.write(JSON.stringify(result) + '\n');
      if (!result.passed) process.exitCode = 1;
      return;
    }
    if (argument === 'use') {
      const result = await applyTheme(runtime, target, positionals[3]);
      process.stdout.write(
        JSON.stringify({ ...result, ...(result.changed ? { editor: await editorStatus(runtime) } : {}) }) + '\n',
      );
      return;
    }
    process.stdout.write(
      JSON.stringify(
        argument === 'install' ? await installTheme(runtime, target) : await removeTheme(runtime, target),
      ) + '\n',
    );
    return;
  }
  const root = await openWorkspace(await locateWorkspace(values.workspace));
  if (command === 'restore-workspace') {
    if (!values.file) throw new ResumeError('VALIDATION_FAILED', '需要 --file');
    process.stdout.write(JSON.stringify(await restoreWorkspace(root, values.file)) + '\n');
    return;
  }
  if (command === 'unlock') {
    await unlockWorkspace(root);
    process.stdout.write(JSON.stringify({ unlocked: true }) + '\n');
    return;
  }
  if (command === 'serve') {
    const port = values.port === undefined ? undefined : Number(values.port);
    if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535))
      throw new ResumeError('VALIDATION_FAILED', 'port 无效');
    const bridge = await startBridge({
      workspace: root,
      dist: fileURLToPath(new URL('../dist', import.meta.url)),
      port,
      renderer: (service, runtime, themes) => new WorkspaceRenderer(service, runtime, themes),
    });
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      void bridge.close().then(
        () => {
          process.exitCode = 0;
        },
        (error) => {
          process.stderr.write(String(error) + '\n');
          process.exitCode = 1;
        },
      );
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    return;
  }
  let runtime: Runtime;
  if (command === 'preview') {
    const started = await ensureBridge(root, cli, { port: values.port });
    runtime = started.runtime;
    const entry = await editorEntry(runtime);
    // The link goes back to the agent so it can open it where the user is looking; the system browser only on --open.
    // --no-open is what plain preview does now and stays accepted for agents and scripts that still pass it.
    if (values.open && values['no-open'])
      throw new ResumeError('VALIDATION_FAILED', '--open 和 --no-open 不能同时使用');
    let opened = false;
    let warning: string | undefined;
    if (values.open) {
      try {
        await openBrowser(entry.url);
        opened = true;
      } catch (error) {
        warning = error instanceof Error ? error.message : '浏览器打开失败';
        process.stderr.write(warning + '\n');
      }
    }
    process.stdout.write(
      JSON.stringify({
        ...entry,
        origin: runtime.origin,
        workspace: root,
        pid: runtime.pid,
        bridge: 'running',
        opened,
        ...(opened ? {} : { nextAction: OPEN_EDITOR }),
        ...(started.recoveredLock ? { recoveredStaleLock: started.recoveredLock } : {}),
        ...(warning ? { warning } : {}),
      }) + '\n',
    );
    return;
  }
  if (command === 'stop') {
    // The Bridge may already be gone (killed, crashed); then the only thing left to do is clear what it left behind.
    try {
      runtime = await runtimeAt(root);
    } catch (error) {
      const pid = await clearStaleLock(root);
      if (pid) {
        process.stdout.write(JSON.stringify({ stopped: true, pid, clearedStaleLock: true }) + '\n');
        return;
      }
      if (error instanceof ResumeError && error.code === 'BRIDGE_NOT_RUNNING') {
        process.stdout.write(JSON.stringify({ stopped: true, wasRunning: false }) + '\n');
        return;
      }
      throw error;
    }
  } else ({ runtime } = await ensureBridge(root, cli));
  if (command === 'stop') {
    try {
      await bridgeRequest(runtime, '/api/shutdown', 'POST', {});
    } catch (error) {
      if (error instanceof ResumeError && error.code === 'NOT_FOUND')
        throw new ResumeError('STORAGE_FAILED', 'Bridge 版本较旧，请使用旧版 CLI stop 后升级；不自动强杀');
      throw error;
    }
    const deadline = Date.now() + 45000;
    let cleaned: number | undefined;
    while (true) {
      // The Bridge process is gone but could not remove its files (e.g. it lost file access): clean up for it.
      if (!processAlive(runtime.pid)) {
        cleaned = await clearStaleLock(root);
        break;
      }
      try {
        const current = JSON.parse(await readFile(path.join(root, '.lulicv/runtime.json'), 'utf8')) as Runtime;
        if (current.pid !== runtime.pid || current.token !== runtime.token) break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        // Runtime is removed before lock cleanup; stop must wait for both.
        try {
          await lstat(path.join(root, '.lulicv/lock'));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
          throw error;
        }
      }
      if (Date.now() >= deadline)
        throw new ResumeError(
          'STORAGE_FAILED',
          `Bridge 进程 ${runtime.pid} 收到关闭请求后 45 秒仍在运行；检查该进程和 .lulicv/bridge.log，不自动强杀`,
        );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    process.stdout.write(
      JSON.stringify({ stopped: true, pid: runtime.pid, ...(cleaned ? { clearedStaleLock: true } : {}) }) + '\n',
    );
    return;
  }
  if (command === 'import') {
    if (!values['mutation-id'] || !values.file === !values.sample)
      throw new ResumeError('VALIDATION_FAILED', 'import 需要 --mutation-id，以及 --file 或 --sample 其中之一');
    const result = await (
      await bridgeRequest(runtime, '/api/import-resume', 'POST', {
        ...(values.sample ? { sample: true } : { data: JSON.parse(await readFile(values.file!, 'utf8')) }),
        mutationId: values['mutation-id'],
        ...(values.name === undefined ? {} : { name: values.name }),
      })
    ).json();
    process.stdout.write(
      JSON.stringify({
        ...(values.quiet
          ? {
              ...summary((result as { document: ResumeDocument }).document),
              warnings: (result as { warnings: string[] }).warnings,
            }
          : result),
        editor: await editorStatus(runtime),
      }) + '\n',
    );
    return;
  }
  if (command === 'backup') {
    if (!values.output) throw new ResumeError('VALIDATION_FAILED', '需要 --output');
    const output = await writeOutput(
      root,
      values.output,
      Buffer.from(await (await bridgeRequest(runtime, '/api/backup')).arrayBuffer()),
    );
    process.stdout.write(JSON.stringify({ output, workspace: root }) + '\n');
    return;
  }
  if (command === 'privacy') {
    // Agents can turn privacy mode on or hide more fields; turning it off or showing fields is the person's call, in the web page.
    const current = (await (await bridgeRequest(runtime, '/api/privacy')).json()) as PrivacySettings;
    if (argument === undefined) {
      process.stdout.write(JSON.stringify(current) + '\n');
      return;
    }
    if (argument !== 'on')
      throw new ResumeError(
        'VALIDATION_FAILED',
        'privacy 只支持查看或 privacy on；关闭隐私模式、减少隐私字段请用户在网页里操作',
      );
    const fields =
      values.fields === undefined
        ? current.fields
        : values.fields
            .split(',')
            .map((field) => field.trim())
            .filter(Boolean);
    if (values.fields !== undefined && !fields.length)
      throw new ResumeError(
        'VALIDATION_FAILED',
        `--fields 至少一项，可选 ${privateFieldOptions.map((option) => option.id).join(',')}`,
      );
    process.stdout.write(
      JSON.stringify(await (await bridgeRequest(runtime, '/api/privacy', 'PUT', { enabled: true, fields })).json()) +
        '\n',
    );
    return;
  }
  if (command === 'tree') {
    process.stdout.write(JSON.stringify(await (await bridgeRequest(runtime, '/api/tree')).json()) + '\n');
    return;
  }
  if (command === 'list') {
    const documents = (await (await bridgeRequest(runtime, '/api/resumes')).json()) as ResumeDocument[];
    process.stdout.write(JSON.stringify(values.quiet ? documents.map(summary) : documents) + '\n');
    return;
  }
  if (!argument || !/^[a-zA-Z0-9_-]{1,128}$/.test(argument))
    throw new ResumeError('VALIDATION_FAILED', '需要有效简历 ID');
  const route = `/api/resumes/${argument}`;
  let response: Response;
  if (command === 'get') {
    let revision: number | undefined;
    if (values.revision !== undefined) {
      revision = Number(values.revision);
      if (!Number.isSafeInteger(revision) || revision < 1)
        throw new ResumeError('VALIDATION_FAILED', '需要 --revision 正整数');
    }
    const document = (await (
      await bridgeRequest(runtime, revision ? `${route}?revision=${revision}` : route)
    ).json()) as ResumeDocument;
    // The JD can be thousands of characters; --quiet keeps everything else an edit needs.
    if (values.quiet && document.target?.jd) {
      const { jd, ...target } = document.target;
      process.stdout.write(JSON.stringify({ ...document, target: { ...target, jdChars: jd.length } }) + '\n');
    } else process.stdout.write(JSON.stringify(document) + '\n');
    return;
  } else if (command === 'validate') response = await bridgeRequest(runtime, route + '/validate');
  else if (command === 'duplicate') {
    if (!values['mutation-id'])
      throw new ResumeError('VALIDATION_FAILED', 'duplicate 需要 --mutation-id；重试时保持相同标识');
    response = await bridgeRequest(runtime, route + '/duplicate', 'POST', {
      name: values.name,
      mutationId: values['mutation-id'],
      ...(values.revision ? { expectedSourceRevision: Number(values.revision) } : {}),
      ...(values.parent ? { parentId: values.parent } : {}),
    });
  } else if (command === 'history') {
    const [document, { revisions }] = await Promise.all([
      (await bridgeRequest(runtime, route)).json() as Promise<ResumeDocument>,
      (await bridgeRequest(runtime, route + '/history')).json() as Promise<{
        revisions: Array<{
          revision: number;
          source: string;
          createdAt: number;
          created: boolean;
          changes: string[];
          restoredFrom?: number;
        }>;
      }>,
    ]);
    process.stdout.write(
      JSON.stringify({
        id: argument,
        revision: document.revision,
        revisions: revisions.map(({ created, changes, ...revision }) => ({
          ...revision,
          changes: created ? ['创建'] : changes,
        })),
      }) + '\n',
    );
    return;
  } else if (command === 'delete') {
    // Deleting needs the revision the agent read, so it never removes a version it has not seen.
    const revision = Number(values.revision);
    if (!Number.isSafeInteger(revision) || revision < 1)
      throw new ResumeError('VALIDATION_FAILED', 'delete 需要 --revision（最近读取到的 revision）');
    response = await bridgeRequest(runtime, route, 'DELETE', {
      baseRevision: revision,
      mutationId: values['mutation-id'] ?? randomUUID(),
    });
  } else if (command === 'restore') {
    // Like delete, it needs the revision the agent read, so it never throws away a version it has not seen.
    const [to, revision] = [Number(values.to), Number(values.revision)];
    if (!Number.isSafeInteger(to) || to < 1)
      throw new ResumeError('VALIDATION_FAILED', 'restore 需要 --to（要恢复的 revision）');
    if (!Number.isSafeInteger(revision) || revision < 1)
      throw new ResumeError('VALIDATION_FAILED', 'restore 需要 --revision（最近读取到的 revision）');
    response = await bridgeRequest(runtime, route + '/restore', 'POST', {
      baseRevision: revision,
      mutationId: values['mutation-id'] ?? randomUUID(),
      revision: to,
    });
  } else if (command === 'diff' && (values.from || values.to)) {
    if (!values.from || values.source || values.against)
      throw new ResumeError(
        'VALIDATION_FAILED',
        'diff --from N [--to N] 比较同一份简历的两个 revision，不能与 --source / --against 同用',
      );
    const read = async (value?: string) => {
      if (value !== undefined && !/^[1-9]\d*$/.test(value))
        throw new ResumeError('VALIDATION_FAILED', '--from / --to 需要正整数 revision');
      return (await (
        await bridgeRequest(runtime, value ? `${route}?revision=${value}` : route)
      ).json()) as ResumeDocument;
    };
    const [before, after] = await Promise.all([read(values.from), read(values.to)]);
    const paths = diffDocuments(before, after).map((operation) => operation.path);
    process.stdout.write(
      JSON.stringify({
        id: argument,
        from: before.revision,
        to: after.revision,
        changes: summarizeChanges(before, after),
        paths: paths.slice(0, 50),
      }) + '\n',
    );
    return;
  } else if (command === 'diff') {
    if (!values.source === !values.against)
      throw new ResumeError(
        'VALIDATION_FAILED',
        'diff 需要 --source（来源在复制之后改了什么）、--against <id>（这份相对另一份改了什么）或 --from N（同一份的两个 revision）其中之一',
      );
    if (values.against) {
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(values.against))
        throw new ResumeError('VALIDATION_FAILED', '--against 需要有效简历 ID');
      const [mine, other] = await Promise.all(
        [argument, values.against].map(
          async (id) => (await (await bridgeRequest(runtime, `/api/resumes/${id}`)).json()) as ResumeDocument,
        ),
      );
      process.stdout.write(JSON.stringify(compareContent(mine, other)) + '\n');
      return;
    }
    response = await bridgeRequest(runtime, route + '/source-diff');
  } else if (command === 'patch') {
    if (!values.file) throw new ResumeError('VALIDATION_FAILED', '需要 --file');
    const patch = JSON.parse(values.file === '-' ? await readStdin() : await readFile(values.file, 'utf8'));
    // A generated id would make a retry after an unknown result write twice, so the file must carry its own.
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch) || typeof patch.mutationId !== 'string')
      throw new ResumeError(
        'VALIDATION_FAILED',
        'patch 文件需要 {baseRevision, mutationId, operations}；mutationId 由字母、数字、_ 或 - 组成，最多 128 位，重试时保持不变',
      );
    response = await bridgeRequest(runtime, route, 'PATCH', patch);
    if (values.inspect) {
      // Write then look, in one call: the layout of exactly the revision this patch produced.
      const document = (await response.json()) as ResumeDocument;
      const layout = await inspectRevision(runtime, root, argument, document.revision, values);
      process.stdout.write(
        JSON.stringify({
          ...(values.quiet ? summary(document) : document),
          layout,
          editor: await editorStatus(runtime),
        }) + '\n',
      );
      return;
    }
  } else if (command === 'inspect' || command === 'export') {
    // Inspect defaults to the current revision and reports it; export always names the revision the user confirmed.
    const revision =
      command === 'inspect' && values.revision === undefined
        ? ((await (await bridgeRequest(runtime, route)).json()) as ResumeDocument).revision
        : Number(values.revision);
    if (!Number.isSafeInteger(revision) || revision < 1)
      throw new ResumeError('VALIDATION_FAILED', '需要 --revision 正整数');
    if (
      command === 'export' &&
      !values.output &&
      !((await (await bridgeRequest(runtime, '/api/health')).json()) as { privacyMode?: boolean }).privacyMode
    )
      throw new ResumeError('VALIDATION_FAILED', '需要 --output');
    if (command === 'inspect') {
      process.stdout.write(JSON.stringify(await inspectRevision(runtime, root, argument, revision, values)) + '\n');
      return;
    }
    response = await bridgeRequest(runtime, route + '/' + command, 'POST', {
      revision,
      ...(values['max-pages'] ? { maxPages: Number(values['max-pages']) } : {}),
    });
    if (command === 'export' && response.status === 202) {
      // Privacy mode: the person approves in the web page, where the PDF downloads; this waits for the outcome.
      let said = '';
      const state = await awaitExport(runtime, (await response.json()) as ExportApproval, Infinity, (pending) => {
        if (pending.message !== said) {
          said = pending.message;
          process.stderr.write(said + '\n');
        }
      });
      process.stdout.write(
        JSON.stringify({
          id: argument,
          revision,
          pages: state.pages,
          delivered: 'browser',
          message: state.message,
          ...(values.output ? { note: '隐私模式下 PDF 由用户的浏览器下载，没有写入 --output' } : {}),
        }) + '\n',
      );
      return;
    }
    if (command === 'export') {
      const output = await writeOutput(root, values.output!, Buffer.from(await response.arrayBuffer()));
      process.stdout.write(JSON.stringify({ id: argument, revision, output }) + '\n');
      return;
    }
  } else throw new ResumeError('VALIDATION_FAILED', help);
  const result = await response.json();
  // After a write, say whether the person is watching in the editor, so the agent can open it for them.
  const written = command === 'patch' || command === 'duplicate' || command === 'restore';
  process.stdout.write(
    JSON.stringify(
      written
        ? { ...(values.quiet ? summary(result as ResumeDocument) : result), editor: await editorStatus(runtime) }
        : result,
    ) + '\n',
  );
  if (command === 'validate' && (result as { errors: string[] }).errors.length) process.exitCode = 1;
}
main().catch((error) => {
  const command = process.argv[2];
  process.stderr.write(
    JSON.stringify(
      errorResult(
        error,
        command === 'export'
          ? 'export'
          : ['patch', 'import', 'duplicate', 'delete', 'restore'].includes(command)
            ? 'write'
            : 'read',
      ),
    ) + '\n',
  );
  process.exitCode = error instanceof ResumeError && error.code === 'REVISION_CONFLICT' ? 2 : 1;
});
