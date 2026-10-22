import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { expect, it } from 'vitest';
import { initializeWorkspace } from '../bridge/workspace';
import { startBridge } from '../bridge/server';
import { runtimeAt } from '../cli/client';
import { cloneSample } from '../../src/core/fixtures';

it('real stdio clients share one writer, deduplicate across restarts and return conflicts safely', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lulicv-mcp-'));
  await initializeWorkspace(root);
  const dist = path.join(root, 'web');
  await mkdir(dist);
  await writeFile(path.join(dist, 'index.html'), '<head></head>');
  const binary = path.join(root, 'mcp.mjs');
  await build({
    entryPoints: ['agent/mcp/index.ts'],
    outfile: binary,
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
  expect(await readFile(binary, 'utf8')).not.toMatch(/node:sqlite|DatabaseSync|startBridge/);
  let bridge = await startBridge({ workspace: root, dist });
  const clients: Client[] = [];
  let diagnostics = '';
  const connect = async () => {
    const client = new Client({ name: 'integration', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [binary, '--workspace', root],
      stderr: 'pipe',
    });
    transport.stderr?.on('data', (chunk) => {
      diagnostics += chunk.toString();
    });
    await client.connect(transport);
    clients.push(client);
    return client;
  };
  const call = (client: Client, name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: args });
  const data = (response: Awaited<ReturnType<typeof call>>) => response.structuredContent as Record<string, unknown>;
  // Each write result carries a fresh editor link while no editor is open; the rest must replay exactly.
  const written = (response: Awaited<ReturnType<typeof call>>) => {
    const { editor, ...rest } = data(response);
    expect(editor).toMatchObject({ open: false, url: expect.stringContaining('#preview=') });
    return rest;
  };
  try {
    const doc = await bridge.service.create({ data: cloneSample() });
    const first = await connect(),
      second = await connect();
    const tools = await first.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
      [
        'get_resume_schema',
        'import_resume',
        'list_themes',
        'list_resumes',
        'get_resume',
        'duplicate_resume',
        'patch_resume',
        'validate_resume',
        'inspect_resume_layout',
        'export_resume_pdf',
      ].sort(),
    );
    const summary = data(await call(first, 'list_resumes', {}));
    expect(summary.resumes).toEqual([{ id: doc.id, name: doc.name, revision: 1, updatedAt: doc.updatedAt }]);
    expect(data(await call(first, 'get_resume', { id: doc.id }))).toMatchObject({ revision: 1 });
    const duplicate = { id: doc.id, sourceRevision: 1, mutationId: 'mcp-job-version', name: '岗位版本' };
    const copies = await Promise.all([
      call(first, 'duplicate_resume', duplicate),
      call(second, 'duplicate_resume', duplicate),
    ]);
    expect(written(copies[0])).toEqual(written(copies[1]));
    expect(await bridge.service.list()).toHaveLength(2);
    expect(data(await call(first, 'get_resume_schema', {}))).toHaveProperty('schema');
    expect(data(await call(first, 'list_themes', {}))).toHaveProperty('themes');
    const importInput = { mutationId: 'mcp-import', data: { ...doc.data, sections: [] }, name: '核对导入' };
    const imported = written(await call(first, 'import_resume', importInput));
    expect(imported).toMatchObject({ document: { name: '核对导入', data: { sections: [] } }, warnings: [] });
    expect(written(await call(second, 'import_resume', importInput))).toEqual(imported);
    expect(written(await call(first, 'import_resume', { mutationId: 'mcp-sample', sample: true }))).toMatchObject({
      document: { name: '内容运营', sample: true },
    });
    const patch = {
      id: doc.id,
      baseRevision: 1,
      mutationId: 'mcp-change',
      operations: [{ op: 'replace', path: '/name', value: '人工与 Agent' }],
    };
    expect(data(await call(first, 'patch_resume', patch))).toMatchObject({ revision: 2 });
    expect(data(await call(first, 'patch_resume', patch))).toMatchObject({ revision: 2 });
    const conflict = await call(second, 'patch_resume', { ...patch, mutationId: 'stale-mcp' });
    expect(conflict.isError).toBe(true);
    expect(data(conflict)).toMatchObject({ code: 'REVISION_CONFLICT', currentRevision: 2 });
    expect(
      (
        await call(first, 'patch_resume', {
          ...patch,
          baseRevision: 2,
          mutationId: 'forbidden',
          operations: [{ op: 'replace', path: '/revision', value: 99 }],
        })
      ).isError,
    ).toBe(true);
    expect(
      (await call(first, 'patch_resume', { ...patch, operations: [{ op: 'destroy', path: '/name' }] })).isError,
    ).toBe(true);
    expect(data(await call(first, 'validate_resume', { id: doc.id }))).toMatchObject({ errors: [] });
    expect(
      (await call(first, 'export_resume_pdf', { id: doc.id, revision: 2, filename: '../escape.pdf' })).isError,
    ).toBe(true);
    const oldToken = bridge.runtime.token;
    await bridge.close();
    expect((await call(first, 'get_resume', { id: doc.id })).isError).toBe(true);
    bridge = await startBridge({ workspace: root, dist });
    expect(bridge.runtime.token).not.toBe(oldToken);
    expect(data(await call(first, 'get_resume', { id: doc.id }))).toMatchObject({ revision: 2 });
    expect(written(await call(second, 'duplicate_resume', duplicate))).toEqual(written(copies[0]));
    expect(written(await call(second, 'import_resume', importInput))).toEqual(imported);
    await first.close();
    expect(await bridge.service.get(doc.id)).toMatchObject({ revision: 2 });
    expect((await runtimeAt(root)).pid).toBe(process.pid);
    expect(diagnostics).not.toContain(oldToken);
    expect(diagnostics).not.toContain(bridge.runtime.token);
    expect(diagnostics).toBe('');
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
}, 20000);

it('rejects untrusted runtime destinations before issuing HTTP requests', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'resume-runtime-'));
  await initializeWorkspace(root);
  const manifest = JSON.parse(await readFile(path.join(root, 'lulicv.json'), 'utf8'));
  try {
    const runtime = {
      pid: 123,
      token: 'a'.repeat(64),
      workspaceId: manifest.workspaceId,
      origin: 'http://127.0.0.1:1',
    };
    for (const changed of [
      { origin: 'https://example.com' },
      { origin: 'http://secret@127.0.0.1:1' },
      { origin: 'http://127.0.0.1:1/escape' },
      { origin: 'http://127.0.0.1:1/?token=secret' },
      { origin: 'http://127.0.0.1:1/#secret' },
      { workspaceId: 'another' },
      { pid: 0 },
      { token: [runtime.token] },
    ]) {
      await writeFile(path.join(root, '.lulicv/runtime.json'), JSON.stringify({ ...runtime, ...changed }));
      await expect(runtimeAt(root)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('checks health identity without following untrusted redirects', async () => {
  const { createServer } = await import('node:http');
  const root = await mkdtemp(path.join(tmpdir(), 'resume-health-'));
  await initializeWorkspace(root);
  const manifest = JSON.parse(await readFile(path.join(root, 'lulicv.json'), 'utf8'));
  let health = { workspaceId: manifest.workspaceId as string, pid: process.pid };
  let redirect = false;
  const server = createServer((_request, response) => {
    if (redirect) {
      response.writeHead(302, { Location: 'https://example.com' });
      response.end();
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(health));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  try {
    await writeFile(
      path.join(root, '.lulicv/runtime.json'),
      JSON.stringify({
        origin: `http://127.0.0.1:${address.port}`,
        token: 'a'.repeat(64),
        pid: process.pid,
        workspaceId: manifest.workspaceId,
      }),
    );
    health = { ...health, workspaceId: 'another' };
    await expect(runtimeAt(root)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    health = { ...health, workspaceId: manifest.workspaceId, pid: process.pid + 1 };
    await expect(runtimeAt(root)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    redirect = true;
    await expect(runtimeAt(root)).rejects.toBeInstanceOf(TypeError);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await rm(root, { recursive: true, force: true });
  }
});
