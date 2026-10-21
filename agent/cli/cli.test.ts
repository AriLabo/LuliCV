import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { expect, it } from 'vitest';
import { initializeWorkspace } from '../bridge/workspace';
import { startBridge } from '../bridge/server';
import { browserCookie } from '../bridge/testing';
const execute = promisify(execFile);
const { rawPlugin } = await import(
  /* @vite-ignore */ (await import('node:url')).pathToFileURL(path.join(process.cwd(), 'scripts/esbuild-raw.mjs')).href
);
it('CLI uses the existing bridge, emits JSON and exits 2 on stale revision', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'resume-cli-'));
  await initializeWorkspace(root);
  const dist = path.join(root, 'web');
  await mkdir(dist);
  await writeFile(path.join(dist, 'index.html'), '<head></head>');
  const binary = path.join(root, 'cli.mjs');
  await build({
    entryPoints: ['agent/cli/index.ts'],
    outfile: binary,
    plugins: [rawPlugin],
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    target: 'node22',
  });
  // Resolve external dependencies from the project while keeping test state outside the checkout.
  const { symlink } = await import('node:fs/promises');
  await symlink(
    path.resolve('node_modules'),
    path.join(root, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const bridge = await startBridge({ workspace: root, dist });
  // A stand-in for the system opener (`open` / `xdg-open`) that records the url it was given instead of opening it.
  const opener = path.join(root, 'opener'),
    openedUrl = path.join(root, 'opened-url');
  await mkdir(opener);
  for (const name of ['open', 'xdg-open'])
    await writeFile(path.join(opener, name), '#!/bin/sh\nprintf "%s" "$1" > "$OPENED_URL"\n', { mode: 0o755 });
  const env = { ...process.env, PATH: opener + path.delimiter + process.env.PATH, OPENED_URL: openedUrl };
  const run = (...args: string[]) => execute(process.execPath, [binary, ...args, '--workspace', root], { env });
  try {
    const document = await bridge.service.create();
    // Plain preview hands the link back so the agent opens it where the user is looking; nothing is launched.
    const preview = JSON.parse((await run('preview')).stdout);
    expect(preview).toMatchObject({
      pid: process.pid,
      bridge: 'running',
      opened: false,
      nextAction: expect.stringContaining('浏览器工具'),
    });
    expect(preview.nextAction).toContain('可点击的链接');
    expect(preview.nextAction).not.toContain('--open');
    expect(preview).not.toHaveProperty('warning');
    expect(JSON.parse((await run('preview', '--no-open')).stdout)).toMatchObject({
      opened: false,
      nextAction: preview.nextAction,
    });
    await expect(readFile(openedUrl)).rejects.toMatchObject({ code: 'ENOENT' });
    if (process.platform !== 'win32') {
      const launched = JSON.parse((await run('preview', '--open')).stdout);
      expect(launched).toMatchObject({ opened: true });
      expect(launched).not.toHaveProperty('nextAction');
      expect(await readFile(openedUrl, 'utf8')).toBe(launched.url);
    }
    await expect(run('preview', '--open', '--no-open')).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('不能同时使用'),
    });
    expect(preview.url).toContain('#preview=');
    expect(preview.url).not.toContain(bridge.runtime.token);
    const ticket = new URLSearchParams(new URL(preview.url).hash.slice(1)).get('preview')!;
    expect(
      (await fetch(bridge.origin + '/api/session', { method: 'POST', headers: { 'X-Resume-Preview': ticket } })).status,
    ).toBe(200);
    expect(JSON.parse((await run('list')).stdout)).toHaveLength(1);
    const patch = path.join(root, 'patch.json');
    await writeFile(
      patch,
      JSON.stringify({
        baseRevision: 1,
        mutationId: 'cli-test',
        operations: [{ op: 'replace', path: '/name', value: 'CLI changed' }],
      }),
    );
    const patched = JSON.parse((await run('patch', document.id, '--file', patch)).stdout);
    expect(patched).toMatchObject({
      revision: 2,
      name: 'CLI changed',
      editor: { open: false, url: expect.stringContaining('#preview='), nextAction: expect.any(String) },
    });
    expect(patched.editor.url).not.toContain(bridge.runtime.token);
    expect(JSON.parse((await run('get', document.id)).stdout)).toMatchObject({ revision: 2 });
    expect(JSON.parse((await run('validate', document.id)).stdout).errors).toEqual([]);
    await writeFile(
      patch,
      JSON.stringify({
        baseRevision: 1,
        mutationId: 'stale-cli',
        operations: [{ op: 'replace', path: '/name', value: 'old' }],
      }),
    );
    await expect(run('patch', document.id, '--file', patch)).rejects.toMatchObject({
      code: 2,
      stdout: '',
      stderr: expect.stringContaining('REVISION_CONFLICT'),
    });
    // Without its own mutationId a patch could not be retried safely, so the CLI refuses rather than inventing one.
    for (const body of [
      { baseRevision: 2, operations: [{ op: 'replace', path: '/name', value: 'no id' }] },
      [{ op: 'replace', path: '/name', value: 'bare' }],
    ]) {
      await writeFile(patch, JSON.stringify(body));
      await expect(run('patch', document.id, '--file', patch)).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringMatching(/VALIDATION_FAILED.*mutationId/),
      });
    }
    // With the editor open the person already watches every write, so no link is handed out.
    const watching = new AbortController();
    await fetch(bridge.origin + '/api/events', {
      headers: { Cookie: await browserCookie(bridge.runtime) },
      signal: watching.signal,
    });
    const copy = JSON.parse(
      (await run('duplicate', document.id, '--name', 'Job version', '--mutation-id', 'cli-duplicate')).stdout,
    );
    expect(copy.editor).toEqual({ open: true });
    watching.abort();
    expect(copy).toMatchObject({ revision: 1, name: 'Job version' });
    // Flags a command does not use are rejected instead of silently ignored.
    await expect(run('validate', document.id, '--quiet')).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('validate 不支持 --quiet'),
    });
    expect(JSON.parse((await run('get', document.id, '--revision', '1')).stdout)).toMatchObject({
      revision: 1,
      name: document.name,
    });
    await writeFile(
      patch,
      JSON.stringify({
        baseRevision: 1,
        mutationId: 'cli-tailor',
        operations: [
          { op: 'replace', path: '/data/basics/phone', value: '138-0000-9999' },
          { op: 'add', path: '/target', value: { company: '示例公司', role: '工程师', jd: '很长的岗位描述' } },
        ],
      }),
    );
    await run('patch', copy.id, '--file', patch);
    const quiet = JSON.parse((await run('get', copy.id, '--quiet')).stdout);
    expect(quiet.target).toEqual({ company: '示例公司', role: '工程师', jdChars: 7 });
    expect(JSON.parse((await run('diff', copy.id, '--against', document.id)).stdout)).toMatchObject({
      id: copy.id,
      against: document.id,
      changes: ['基本信息 · 电话'],
    });
    await expect(run('diff', copy.id)).rejects.toMatchObject({ code: 1 });
    // A mistyped flag is reported as an input error, not an environment failure.
    await expect(run('get', copy.id, '--quiett')).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringMatching(/VALIDATION_FAILED.*--quiett/),
    });
    expect(JSON.parse((await run('version')).stdout)).toEqual({ version: 'dev', commit: '' });
    const history = JSON.parse((await run('history', copy.id)).stdout);
    expect(history).toMatchObject({ id: copy.id, revision: 2 });
    expect(history.revisions.map((revision: { revision: number }) => revision.revision)).toEqual([2, 1]);
    expect(history.revisions[0].changes).toEqual(expect.arrayContaining(['基本信息 · 电话', '投递目标']));
    expect(JSON.parse((await run('diff', copy.id, '--from', '1')).stdout)).toMatchObject({
      from: 1,
      to: 2,
      changes: expect.arrayContaining(['基本信息 · 电话', '投递目标']),
    });
    await expect(run('delete', copy.id, '--revision', '1')).rejects.toMatchObject({ code: 2 });
    expect(JSON.parse((await run('delete', copy.id, '--revision', '2')).stdout)).toEqual({ deleted: true });
    expect(JSON.parse((await run('list')).stdout)).toHaveLength(1);
    // As in the editor, the last one can go too; the workspace is then empty and works as before.
    expect(JSON.parse((await run('delete', document.id, '--revision', '2')).stdout)).toEqual({ deleted: true });
    expect(JSON.parse((await run('list')).stdout)).toEqual([]);
    expect(JSON.parse((await run('preview', '--no-open')).stdout)).toMatchObject({ url: expect.any(String) });
    const sample = JSON.parse((await run('import', '--sample', '--mutation-id', 'cli-sample', '--quiet')).stdout);
    expect(sample).toMatchObject({ name: '内容运营', revision: 1, sample: true, warnings: [] });
    expect(JSON.parse((await run('list')).stdout)).toEqual([expect.objectContaining({ id: sample.id, sample: true })]);
    expect(JSON.parse((await run('validate', sample.id)).stdout)).toMatchObject({ errors: [] });
    await expect(run('import', '--sample', '--file', patch, '--mutation-id', 'cli-both')).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('--file 或 --sample'),
    });
  } finally {
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
it('CLI starts and stops its daemon and backs up the SQLite workspace', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'resume-daemon-'));
  await initializeWorkspace(root);
  const { symlink, realpath } = await import('node:fs/promises');
  await mkdir(path.join(root, 'dist'));
  await writeFile(path.join(root, 'dist/index.html'), '<head></head>');
  await mkdir(path.join(root, 'agent-dist'));
  const binary = path.join(root, 'agent-dist/cli.mjs');
  await build({
    entryPoints: ['agent/cli/index.ts'],
    outfile: binary,
    plugins: [rawPlugin],
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    target: 'node22',
  });
  await symlink(
    path.resolve('node_modules'),
    path.join(root, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const run = (...args: string[]) => execute(process.execPath, [binary, ...args, '--workspace', root]);
  let pid: number | undefined;
  try {
    // Any command that needs the Bridge starts it; preview then reuses it.
    expect(JSON.parse((await run('tree')).stdout)).toHaveProperty('resumes');
    const started = JSON.parse((await run('preview', '--no-open')).stdout);
    pid = started.pid;
    expect(started.url).toMatch(/^http:\/\/127\.0\.0\.1:/);
    expect(pid).not.toBe(process.pid);
    const runtime = JSON.parse(await readFile(path.join(root, '.cvslate/runtime.json'), 'utf8'));
    const created = await fetch(runtime.origin + '/api/resumes', {
      method: 'POST',
      headers: { Authorization: `Bearer ${runtime.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '岗位版' }),
    });
    expect(created.status).toBe(201);
    const document = (await created.json()) as { id: string };
    expect(JSON.parse((await run('get', document.id)).stdout).name).toBe('岗位版');
    const output = path.join(root, 'backup.db');
    expect(JSON.parse((await run('backup', '--output', output)).stdout).output).toBe(await realpath(output));
    await expect(run('backup', '--output', path.join(root, 'cvslate.db'))).rejects.toMatchObject({ code: 1 });
    expect(JSON.parse((await run('stop')).stdout).pid).toBe(pid);
    await expect
      .poll(async () => {
        try {
          await readFile(path.join(root, '.cvslate/runtime.json'));
          return false;
        } catch (error) {
          return (error as NodeJS.ErrnoException).code === 'ENOENT';
        }
      })
      .toBe(true);
    pid = undefined;
    expect(JSON.parse((await run('stop')).stdout)).toEqual({ stopped: true, wasRunning: false });
    expect(JSON.parse((await run('restore-workspace', '--file', output)).stdout).restored).toBe(true);
  } finally {
    if (pid) {
      // Best effort: it may have exited already, and a cleanup error must not hide the test's own failure.
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* see above */
      }
    }
    await rm(root, { recursive: true, force: true });
  }
}, 20000);

it('stop does not report success between runtime removal and lock cleanup', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'resume-stop-boundary-'));
  await initializeWorkspace(root);
  const { readFile, symlink } = await import('node:fs/promises');
  const { createServer } = await import('node:http');
  const workspaceId = JSON.parse(await readFile(path.join(root, 'cvslate.json'), 'utf8')).workspaceId;
  const binary = path.join(root, 'cli.mjs');
  await build({
    entryPoints: ['agent/cli/index.ts'],
    outfile: binary,
    plugins: [rawPlugin],
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    target: 'node22',
  });
  await symlink(
    path.resolve('node_modules'),
    path.join(root, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const lock = path.join(root, '.cvslate/lock');
  await mkdir(lock);
  const runtimeFile = path.join(root, '.cvslate/runtime.json');
  let cleanup: Promise<void> | undefined;
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/health') response.end(JSON.stringify({ workspaceId, pid: process.pid }));
    else {
      request.resume();
      cleanup = (async () => {
        await rm(runtimeFile);
        await new Promise((resolve) => setTimeout(resolve, 350));
        await rm(lock, { recursive: true });
      })();
      response.writeHead(202);
      response.end('{}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server missing');
    await writeFile(
      runtimeFile,
      JSON.stringify({
        pid: process.pid,
        token: 'a'.repeat(64),
        workspaceId,
        origin: `http://127.0.0.1:${address.port}`,
      }),
    );
    const result = await execute(process.execPath, [binary, 'stop', '--workspace', root]);
    expect(JSON.parse(result.stdout).stopped).toBe(true);
    const { access } = await import('node:fs/promises');
    await expect(access(lock)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await cleanup;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

it('theme new, check, install, themes and remove work as one loop', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'resume-cli-theme-'));
  await initializeWorkspace(root);
  const dist = path.join(root, 'web');
  await mkdir(dist);
  await writeFile(path.join(dist, 'index.html'), '<head></head>');
  const binary = path.join(root, 'cli.mjs');
  await build({
    entryPoints: ['agent/cli/index.ts'],
    outfile: binary,
    plugins: [rawPlugin],
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    target: 'node22',
  });
  const { symlink, readFile } = await import('node:fs/promises');
  await symlink(
    path.resolve('node_modules'),
    path.join(root, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const bridge = await startBridge({ workspace: root, dist });
  const run = (...args: string[]) => execute(process.execPath, [binary, ...args, '--workspace', root], { cwd: root });
  try {
    const folder = path.join(root, 'drafts/ink');
    const created = JSON.parse(
      (await run('theme', 'new', 'ink-demo', '--from', 'editorial', '--name', '墨水', '--output', folder)).stdout,
    );
    expect(created).toMatchObject({ theme: 'ink-demo', from: 'editorial', directory: folder });
    expect(JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8'))).toMatchObject({
      id: 'ink-demo',
      name: '墨水',
      version: '0.1.0',
    });
    expect(await readFile(path.join(folder, 'theme.css'), 'utf8')).toContain('.rs-theme--ink-demo');
    await expect(run('theme', 'new', 'ink-demo', '--output', folder)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('已存在'),
    });
    await expect(run('theme', 'new', 'standard')).rejects.toMatchObject({
      stderr: expect.stringContaining('内置主题'),
    });
    await expect(run('theme', 'install', folder, '--images', root)).rejects.toMatchObject({
      stderr: expect.stringContaining('theme install 不支持 --images'),
    });
    // Static problems fail the check before anything is rendered.
    const css = await readFile(path.join(folder, 'theme.css'), 'utf8');
    await writeFile(path.join(folder, 'theme.css'), css + '\n.rs-name { background: url(https://example.com/x.png) }');
    const failed = await run('theme', 'check', folder).then(
      () => undefined,
      (error) => error as { code: number; stdout: string },
    );
    expect(failed?.code).toBe(1);
    expect(JSON.parse(failed!.stdout)).toMatchObject({
      valid: false,
      passed: false,
      errors: [expect.stringContaining('https://example.com')],
    });
    await expect(run('theme', 'install', folder)).rejects.toMatchObject({
      stderr: expect.stringContaining('VALIDATION_FAILED'),
    });
    await writeFile(path.join(folder, 'theme.css'), css);
    expect(JSON.parse((await run('theme', 'install', folder)).stdout)).toMatchObject({
      installed: 'ink-demo',
      name: '墨水',
      replaced: false,
    });
    const listed = JSON.parse((await run('themes')).stdout);
    expect(listed.themes.at(-1)).toMatchObject({ id: 'ink-demo', source: 'installed' });
    // Switching theme takes the theme's colour and font but keeps the person's spacing and own stylesheet, like the editor.
    const resume = await bridge.service.create();
    const own = '.rs-contact[data-kind="link"] { flex-shrink: 0; margin-right: 100%; }';
    await expect(
      bridge.service.patch(resume.id, {
        baseRevision: 1,
        mutationId: 'cli-theme-css-bad',
        operations: [{ op: 'add', path: '/appearance/css', value: `@import "x.css"; ${own}` }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const spaced = await bridge.service.patch(resume.id, {
      baseRevision: 1,
      mutationId: 'cli-theme-spacing',
      operations: [
        { op: 'replace', path: '/appearance/layout/pageMarginMm', value: 11 },
        { op: 'add', path: '/appearance/css', value: own },
      ],
    });
    expect(JSON.parse((await run('theme', 'use', resume.id, 'editorial')).stdout)).toMatchObject({
      revision: spaced.revision + 1,
      theme: 'editorial',
      changed: true,
      preset: 'navy',
      fontFamily: 'misans',
    });
    expect(JSON.parse((await run('theme', 'use', resume.id, 'minimal')).stdout)).not.toHaveProperty('fontFamily');
    expect((await bridge.service.get(resume.id)).appearance).toMatchObject({
      themeId: 'minimal',
      preset: 'ink',
      layout: { pageMarginMm: 11, accentColor: '#222222' },
      css: own,
    });
    expect(JSON.parse((await run('theme', 'use', resume.id, 'minimal')).stdout)).toMatchObject({
      changed: false,
      revision: spaced.revision + 2,
    });
    await expect(run('theme', 'use', resume.id, 'missing-theme')).rejects.toMatchObject({
      stderr: expect.stringContaining('ink-demo'),
    });
    expect(JSON.parse((await run('theme', 'use', resume.id, 'ink-demo')).stdout)).toMatchObject({
      theme: 'ink-demo',
      changed: true,
    });
    expect(JSON.parse((await run('theme', 'remove', 'ink-demo')).stdout)).toMatchObject({
      removed: 'ink-demo',
      usedBy: [{ id: resume.id }],
    });
    expect(JSON.parse((await run('themes')).stdout).themes.map((theme: { id: string }) => theme.id)).toEqual([
      'standard',
      'editorial',
      'minimal',
    ]);
  } finally {
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});
it('CLI and MCP exports in privacy mode wait for the person and return only the page count', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'resume-cli-privacy-'));
  await initializeWorkspace(root);
  const dist = path.join(root, 'web');
  await mkdir(dist);
  await writeFile(path.join(dist, 'index.html'), '<head></head>');
  const cli = path.join(root, 'cli.mjs');
  await build({
    entryPoints: ['agent/cli/index.ts'],
    outfile: cli,
    plugins: [rawPlugin],
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    target: 'node22',
  });
  const mcp = path.join(root, 'mcp.mjs');
  await build({
    entryPoints: ['agent/mcp/index.ts'],
    outfile: mcp,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    target: 'node22',
  });
  const { symlink } = await import('node:fs/promises');
  await symlink(
    path.resolve('node_modules'),
    path.join(root, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const renderer = () => ({
    inspect: async () => ({ pageCount: 2 }),
    export: async () => ({ pdf: Buffer.from('%PDF-fixture'), report: { pageCount: 2 } }),
    snapshot: () => {
      throw new Error('unused');
    },
    beginShutdown: () => {},
    close: async () => {},
  });
  const bridge = await startBridge({ workspace: root, dist, renderer: renderer as never });
  const { bridgeRequest } = await import('./client');
  const { Client } = await import('@modelcontextprotocol/client');
  const { StdioClientTransport } = await import('@modelcontextprotocol/client/stdio');
  const client = new Client({ name: 'integration', version: '1.0.0' });
  try {
    const document = await bridge.service.create();
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [mcp, '--workspace', root] }));
    const call = async (args: Record<string, unknown>) => {
      const response = await client.callTool({ name: 'export_resume_pdf', arguments: args });
      return { error: !!response.isError, ...(response.structuredContent as Record<string, unknown>) };
    };
    expect(await call({ id: document.id, revision: 1 })).toMatchObject({ error: true, message: '需要 filename' });
    await bridgeRequest(bridge.runtime, '/api/privacy', 'PUT', { enabled: true, fields: ['name'] });
    const { revision } = await bridge.service.get(document.id);
    // The person, in the web page: answers the next request that shows up.
    const cookie = await browserCookie(bridge.runtime);
    const answer = async (action: 'approve' | 'decline') => {
      for (let attempt = 0; attempt < 200; attempt++) {
        const { requests } = (await (
          await fetch(bridge.origin + '/api/export-requests', { headers: { Cookie: cookie } })
        ).json()) as { requests: Array<{ requestId: string }> };
        if (requests.length) {
          await fetch(`${bridge.origin}/api/export-requests/${requests[0].requestId}/${action}`, {
            method: 'POST',
            headers: { Cookie: cookie, 'Content-Type': 'application/json' },
            body: '{}',
          });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('no export request');
    };

    const [exported] = await Promise.all([
      execute(process.execPath, [
        cli,
        'export',
        document.id,
        '--revision',
        String(revision),
        '--output',
        'out.pdf',
        '--workspace',
        root,
      ]),
      answer('approve'),
    ]);
    expect(JSON.parse(exported.stdout)).toEqual({
      id: document.id,
      revision,
      pages: 2,
      delivered: 'browser',
      message: 'PDF 已交给用户的浏览器下载，共 2 页；用户没收到文件（比如在保存对话框里取消了）可以再请求一次',
      note: '隐私模式下 PDF 由用户的浏览器下载，没有写入 --output',
    });
    expect(exported.stderr).toContain('没有打开的 CVSlate 网页');
    const [declined] = await Promise.allSettled([
      execute(process.execPath, [cli, 'export', document.id, '--revision', String(revision), '--workspace', root]),
      answer('decline'),
    ]);
    expect(declined).toMatchObject({
      status: 'rejected',
      reason: { code: 1, stderr: expect.stringContaining('EXPORT_DECLINED') },
    });

    const [approved] = await Promise.all([call({ id: document.id, revision }), answer('approve')]);
    expect(approved).toEqual({
      error: false,
      status: 'approved',
      id: document.id,
      revision,
      pages: 2,
      delivered: 'browser',
      message: 'PDF 已交给用户的浏览器下载，共 2 页；用户没收到文件（比如在保存对话框里取消了）可以再请求一次',
    });
    const [refused] = await Promise.all([
      call({ id: document.id, revision, filename: 'resume.pdf' }),
      answer('decline'),
    ]);
    expect(refused).toMatchObject({ error: true, code: 'EXPORT_DECLINED' });
  } finally {
    await client.close();
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
// A workspace the Bridge cannot write to (as in a sandboxed client) must say why, without paths or secrets.
it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
  'a Bridge that fails to start logs the system cause and the CLI reports it',
  async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'resume-start-'));
    const root = path.join(base, 'workspace');
    await initializeWorkspace(root);
    const { symlink, readFile, chmod } = await import('node:fs/promises');
    await mkdir(path.join(base, 'dist'));
    await writeFile(path.join(base, 'dist/index.html'), '<head></head>');
    await mkdir(path.join(base, 'agent-dist'));
    const binary = path.join(base, 'agent-dist/cli.mjs');
    await build({
      entryPoints: ['agent/cli/index.ts'],
      outfile: binary,
      plugins: [rawPlugin],
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      target: 'node22',
    });
    await symlink(
      path.resolve('node_modules'),
      path.join(base, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    // The log directory stays writable; the workspace folder itself does not.
    await chmod(root, 0o555);
    try {
      const failure = await execute(process.execPath, [binary, 'tree', '--workspace', root]).then(
        () => undefined,
        (error: { code: number; stderr: string }) => error,
      );
      expect(failure?.code).toBe(1);
      const reported = JSON.parse(failure!.stderr.trim().split('\n').at(-1)!);
      expect(reported).toMatchObject({
        code: 'STORAGE_FAILED',
        message: expect.stringMatching(/^Bridge 启动失败：本地运行环境出错：.+（完整日志见 \.cvslate\/bridge\.log）$/),
      });
      const logged = JSON.parse(
        (await readFile(path.join(root, '.cvslate/bridge.log'), 'utf8')).trim().split('\n').at(-1)!,
      );
      expect(logged).toMatchObject({
        code: 'STORAGE_FAILED',
        message: expect.stringMatching(/^本地运行环境出错：(SQLite：|.+（E[A-Z]+)/),
      });
      expect(reported.message).toContain(logged.message);
      // Neither carries a path (which would include the user name) or a token.
      for (const text of [failure!.stderr, await readFile(path.join(root, '.cvslate/bridge.log'), 'utf8')]) {
        expect(text).not.toContain(base);
        expect(text).not.toContain(tmpdir());
        expect(text).not.toMatch(/[0-9a-f]{32}/);
      }
    } finally {
      await chmod(root, 0o755);
      await rm(base, { recursive: true, force: true });
    }
  },
  60000,
);
