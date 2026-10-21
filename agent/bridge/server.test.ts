import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { request } from 'node:http';
import { once } from 'node:events';
import { connect } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { initializeWorkspace } from './workspace';
import { startBridge } from './server';
import { bridgeRequest } from '../cli/client';
import { cloneSample } from '../../src/core/fixtures';
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'resume-bridge-'));
  await initializeWorkspace(root);
  const dist = path.join(root, 'web');
  await mkdir(dist);
  await writeFile(path.join(dist, 'index.html'), '<html><head></head><body>fixture</body></html>');
  const bridge = await startBridge({ workspace: root, dist });
  return { root, bridge, dist };
}
it('authenticates local clients, validates host/origin and serves no workspace files', async () => {
  const { root, bridge } = await setup();
  try {
    expect((await fetch(bridge.origin + '/api/resumes')).status).toBe(403);
    expect(
      (
        await fetch(bridge.origin + '/api/resumes', {
          headers: { Authorization: `Bearer ${bridge.runtime.token}`, Origin: 'https://evil.example' },
        })
      ).status,
    ).toBe(403);
    const badHost = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        bridge.origin + '/api/resumes',
        { headers: { Authorization: `Bearer ${bridge.runtime.token}`, Host: 'evil.example' } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(badHost).toBe(403);
    expect((await fetch(bridge.origin + '/.cvslate/runtime.json')).status).toBe(404);
    // The CLI token, which agents can read from runtime.json, neither passes as a browser cookie nor buys one.
    const port = new URL(bridge.origin).port;
    expect(
      (
        await fetch(bridge.origin + '/api/resumes', {
          headers: { Cookie: `resume_session_${port}=${bridge.runtime.token}` },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(bridge.origin + '/api/session', {
          method: 'POST',
          headers: { Authorization: `Bearer ${bridge.runtime.token}` },
        })
      ).status,
    ).toBe(403);
    expect(
      (await fetch(bridge.origin + '/api/resumes', { headers: { Authorization: bridge.runtime.token } })).status,
    ).toBe(403);
    const { url } = (await (await bridgeRequest(bridge.runtime, '/api/preview-entry', 'POST', {})).json()) as {
      url: string;
    };
    const session = await fetch(bridge.origin + '/api/session', {
      method: 'POST',
      headers: { 'X-Resume-Preview': new URLSearchParams(new URL(url).hash.slice(1)).get('preview')! },
    });
    const cookie = session.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Max-Age=7776000');
    expect(cookie.split(';')[0]).not.toContain(bridge.runtime.token);
    expect((await fetch(bridge.origin + '/api/resumes', { headers: { Cookie: cookie.split(';')[0] } })).status).toBe(
      200,
    );
    expect(
      (
        await fetch(bridge.origin + '/api/session', { method: 'POST', headers: { Cookie: cookie.split(';')[0] } })
      ).headers.get('set-cookie'),
    ).toBeNull();
    // Only a hash of the cookie is stored.
    expect(
      JSON.stringify(
        new DatabaseSync(path.join(root, 'cvslate.db'), { readOnly: true })
          .prepare('SELECT * FROM browser_sessions')
          .all(),
      ),
    ).not.toContain(cookie.split(';')[0].split('=')[1]);
    expect(await (await fetch(bridge.origin)).text()).toContain('cvslate');
  } finally {
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});
it('exposes the same CAS and validation guarantees through HTTP', async () => {
  const { root, bridge } = await setup();
  try {
    const document = (await (
      await bridgeRequest(bridge.runtime, '/api/resumes', 'POST', { name: 'HTTP fixture' })
    ).json()) as { id: string };
    const route = `/api/resumes/${document.id}`;
    const write = {
      baseRevision: 1,
      mutationId: 'http',
      operations: [{ op: 'replace', path: '/name', value: 'changed' }],
    };
    expect(await (await bridgeRequest(bridge.runtime, route, 'PATCH', write)).json()).toMatchObject({
      revision: 2,
      name: 'changed',
    });
    expect(await (await bridgeRequest(bridge.runtime, route, 'PATCH', write)).json()).toMatchObject({ revision: 2 });
    await expect(
      bridgeRequest(bridge.runtime, route, 'PATCH', { ...write, mutationId: 'stale' }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT', currentRevision: 2 });
    await expect(
      bridgeRequest(bridge.runtime, route, 'PATCH', {
        ...write,
        mutationId: 'invalid',
        baseRevision: 2,
        operations: [
          { op: 'replace', path: '/name', value: 'bad' },
          { op: 'remove', path: '/data/basics/name' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await (await bridgeRequest(bridge.runtime, route)).json()).toMatchObject({ revision: 2, name: 'changed' });
  } finally {
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});
it('creation and duplicate HTTP retries after restart return the original document', async () => {
  const fixture = await setup();
  let bridge = fixture.bridge;
  try {
    const input = { name: 'HTTP 母版', mutationId: 'http-create' };
    const created = (await (await bridgeRequest(bridge.runtime, '/api/resumes', 'POST', input)).json()) as {
      id: string;
    };
    const route = `/api/resumes/${created.id}/duplicate`;
    const copyInput = { name: 'HTTP 岗位版', mutationId: 'http-copy', expectedSourceRevision: 1 };
    const copy = await (await bridgeRequest(bridge.runtime, route, 'POST', copyInput)).json();
    await bridge.service.delete(created.id, { baseRevision: 1, mutationId: 'delete-http' });
    await bridge.close();
    bridge = await startBridge({ workspace: fixture.root, dist: fixture.dist });
    expect(await (await bridgeRequest(bridge.runtime, '/api/resumes', 'POST', input)).json()).toEqual(created);
    expect(await (await bridgeRequest(bridge.runtime, route, 'POST', copyInput)).json()).toEqual(copy);
    await expect(
      bridgeRequest(bridge.runtime, '/api/resumes', 'POST', { ...input, name: 'changed' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  } finally {
    await bridge.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

it('authenticated shutdown rejects new work, waits for active requests and releases runtime and lock', async () => {
  const { root, bridge } = await setup();
  const { access } = await import('node:fs/promises');
  try {
    expect(
      (
        await fetch(bridge.origin + '/api/shutdown', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(bridge.origin + '/api/shutdown', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${bridge.runtime.token}`,
            Origin: 'https://example.com',
            'Content-Type': 'application/json',
          },
          body: '{}',
        })
      ).status,
    ).toBe(403);
    expect((await bridgeRequest(bridge.runtime, '/api/health')).status).toBe(200);
    const stopped = await bridgeRequest(bridge.runtime, '/api/shutdown', 'POST', {});
    expect(stopped.status).toBe(202);
    await bridge.close();
    await expect(access(path.join(root, '.cvslate/runtime.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(path.join(root, '.cvslate/lock'))).rejects.toMatchObject({ code: 'ENOENT' });
    const restarted = await startBridge({ workspace: root, dist: path.join(root, 'web') });
    await restarted.close();
  } finally {
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});

it('shutdown is not held open by a peer that disappears mid-request', async () => {
  const { root, bridge } = await setup();
  const port = Number(new URL(bridge.origin).port);
  const socket = connect(port, '127.0.0.1');
  try {
    await once(socket, 'connect');
    // A browser that goes offline mid-write leaves the socket established with an unfinished
    // request: the handler stays suspended in body() and the connection is not idle. Shutdown
    // must not wait for such a peer to finish; the assertion fails instead of hanging.
    socket.write(
      `PATCH /api/resumes/fixture HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nAuthorization: Bearer ${bridge.runtime.token}\r\nContent-Type: application/json\r\nContent-Length: 4096\r\n\r\n{"partial":`,
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    const outcome = await Promise.race([
      bridge.close().then(() => 'closed' as const),
      new Promise<'stalled'>((resolve) => setTimeout(() => resolve('stalled'), 2000)),
    ]);
    expect(outcome).toBe('closed');
  } finally {
    socket.destroy();
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});

it('SSE descriptions associate the same mutation ID with each resume independently', async () => {
  const { root, bridge } = await setup();
  const controller = new AbortController();
  try {
    const first = await bridge.service.create({ data: cloneSample() }),
      second = await bridge.service.create({ data: cloneSample() });
    const events = await fetch(bridge.origin + '/api/events', {
      headers: { Authorization: `Bearer ${bridge.runtime.token}` },
      signal: controller.signal,
    });
    const reader = events.body!.getReader();
    await reader.read();
    const original = bridge.repository.transact.bind(bridge.repository);
    let entered = 0;
    let ready!: () => void;
    let release!: () => void;
    const both = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    bridge.repository.transact = async (...args) => {
      if (++entered === 2) ready();
      await gate;
      return original(...args);
    };
    const a = bridgeRequest(bridge.runtime, `/api/resumes/${first.id}`, 'PATCH', {
      baseRevision: 1,
      mutationId: 'shared',
      operations: [{ op: 'replace', path: '/name', value: 'A' }],
    });
    const b = bridgeRequest(bridge.runtime, `/api/resumes/${second.id}`, 'PATCH', {
      baseRevision: 1,
      mutationId: 'shared',
      operations: [{ op: 'replace', path: '/data/basics/name', value: 'B' }],
    });
    await both;
    release();
    await Promise.all([a, b]);
    let text = '';
    while ((text.match(/event: commit/g) ?? []).length < 2)
      text += new TextDecoder().decode((await reader.read()).value);
    const commits = text
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice(6)));
    expect(commits.find((event) => event.resumeId === first.id).paths).toEqual(['/name']);
    expect(commits.find((event) => event.resumeId === second.id).paths).toEqual(['/data/basics/name']);
  } finally {
    controller.abort();
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});

it('issues one-use browser entries without exposing the CLI token, enforces origin, expiry and restart, and keeps browsers signed in', async () => {
  const fixture = await setup();
  let bridge = fixture.bridge;
  const entry = async () =>
    (await (await bridgeRequest(bridge.runtime, '/api/preview-entry', 'POST', {})).json()) as {
      url: string;
      expiresAt: number;
    };
  const exchange = (ticket: string, origin?: string) =>
    fetch(bridge.origin + '/api/session', {
      method: 'POST',
      headers: { 'X-Resume-Preview': ticket, ...(origin ? { Origin: origin } : {}) },
    });
  try {
    expect(
      (
        await fetch(bridge.origin + '/api/preview-entry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(403);
    const first = await entry();
    expect(first.url).not.toContain(bridge.runtime.token);
    const ticket = new URLSearchParams(new URL(first.url).hash.slice(1)).get('preview')!;
    expect((await exchange(ticket, 'https://evil.example')).status).toBe(403);
    const session = await exchange(ticket, bridge.origin);
    expect(session.status).toBe(200);
    const cookie = session.headers.get('set-cookie')!.split(';')[0];
    expect((await fetch(bridge.origin + '/api/resumes', { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await exchange(ticket)).status).toBe(403);
    const expired = await entry();
    const { vi } = await import('vitest');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(expired.expiresAt + 1);
    try {
      expect((await exchange(new URLSearchParams(new URL(expired.url).hash.slice(1)).get('preview')!)).status).toBe(
        403,
      );
    } finally {
      clock.mockRestore();
    }
    const stale = await entry();
    await bridge.close();
    bridge = await startBridge({ workspace: fixture.root, dist: fixture.dist });
    expect((await exchange(new URLSearchParams(new URL(stale.url).hash.slice(1)).get('preview')!)).status).toBe(403);
    // The browser stays signed in across restarts, until the sign-in expires.
    expect((await fetch(bridge.origin + '/api/resumes', { headers: { Cookie: cookie } })).status).toBe(200);
    const later = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 91 * 24 * 60 * 60 * 1000);
    try {
      expect((await fetch(bridge.origin + '/api/resumes', { headers: { Cookie: cookie } })).status).toBe(403);
    } finally {
      later.mockRestore();
    }
  } finally {
    await bridge.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});
it('serves an agent-readable tree with purposes, targets and content changes in sources', async () => {
  const { root, bridge } = await setup();
  const call = async (route: string, method = 'GET', value?: unknown) =>
    (await bridgeRequest(bridge.runtime, route, method, value)).json() as Promise<Record<string, any>>;
  try {
    const master = await bridge.service.create({ name: '完整经历', data: cloneSample() });
    const direction = await call(`/api/resumes/${master.id}/duplicate`, 'POST', {
      name: '后端方向',
      mutationId: 'tree-direction',
    });
    await call(`/api/resumes/${direction.id}`, 'PATCH', {
      baseRevision: 1,
      mutationId: 'tree-purpose',
      operations: [{ op: 'add', path: '/purpose', value: '投后端、高并发岗位' }],
    });
    const job = await call(`/api/resumes/${master.id}/duplicate`, 'POST', {
      name: '云帆网络 · 后台开发',
      mutationId: 'tree-job',
      parentId: direction.id,
    });
    await call(`/api/resumes/${job.id}`, 'PATCH', {
      baseRevision: 1,
      mutationId: 'tree-target',
      operations: [
        { op: 'add', path: '/target', value: { company: '云帆网络', role: '后台开发', jd: '负责实时协作服务' } },
      ],
    });
    expect(
      (
        await bridgeRequest(bridge.runtime, `/api/resumes/${master.id}/duplicate`, 'POST', {
          name: 'x',
          mutationId: 'tree-bad',
          parentId: job.id,
        }).catch((error) => error)
      ).code,
    ).toBe('VALIDATION_FAILED');
    // The master gains a new bullet and a theme change; only the content change counts.
    await call(`/api/resumes/${master.id}`, 'PATCH', {
      baseRevision: 1,
      mutationId: 'master-edit',
      operations: [
        { op: 'add', path: '/data/sections/1/entries/0/bullets/-', value: '新增的成果' },
        { op: 'replace', path: '/appearance/themeId', value: 'minimal' },
      ],
    });
    const { resumes } = await call('/api/tree');
    expect(resumes).toHaveLength(1);
    expect(resumes[0]).toMatchObject({
      id: master.id,
      kind: 'base',
      children: [
        {
          id: direction.id,
          purpose: '投后端、高并发岗位',
          sourceChanges: 1,
          children: [{ id: job.id, kind: 'job', target: { company: '云帆网络', role: '后台开发' }, sourceChanges: 1 }],
        },
      ],
    });
    expect(resumes[0].children[0].children[0].target).not.toHaveProperty('jd');
    const diff = await call(`/api/resumes/${job.id}/source-diff`);
    expect(diff).toMatchObject({ sourceId: master.id, sourceName: '完整经历', fromRevision: 1, toRevision: 2 });
    expect(diff.changes).toEqual(['「工作经历」 · 「示例科技有限公司」 · 要点']);
    expect(await call(`/api/resumes/${master.id}/source-diff`)).toMatchObject({ sourceId: null, changes: [] });
    // Carrying the change over clears it for that copy only.
    const bullets = (await call(`/api/resumes/${master.id}`)).data.sections[1].entries[0].bullets;
    await call(`/api/resumes/${job.id}`, 'PATCH', {
      baseRevision: 2,
      mutationId: 'job-port',
      operations: [{ op: 'replace', path: '/data/sections/1/entries/0/bullets', value: bullets }],
    });
    expect((await call(`/api/resumes/${job.id}/source-diff`)).changes).toEqual([]);
    expect((await call(`/api/resumes/${direction.id}/source-diff`)).changes).toHaveLength(1);
    // Declining marks the source's changes as seen; it can only move forward to a revision the source has.
    const bad = await bridgeRequest(bridge.runtime, `/api/resumes/${direction.id}`, 'PATCH', {
      baseRevision: 2,
      mutationId: 'ack-bad',
      operations: [{ op: 'replace', path: '/source/revision', value: 3 }],
    }).catch((error) => error);
    expect(bad.code).toBe('VALIDATION_FAILED');
    expect(
      (
        await bridgeRequest(bridge.runtime, `/api/resumes/${direction.id}`, 'PATCH', {
          baseRevision: 2,
          mutationId: 'ack-id',
          operations: [{ op: 'replace', path: '/source/id', value: job.id }],
        }).catch((error) => error)
      ).code,
    ).toBe('VALIDATION_FAILED');
    await call(`/api/resumes/${direction.id}`, 'PATCH', {
      baseRevision: 2,
      mutationId: 'ack',
      operations: [{ op: 'replace', path: '/source/revision', value: 2 }],
    });
    expect((await call(`/api/resumes/${direction.id}/source-diff`)).changes).toEqual([]);
    expect((await call('/api/tree')).resumes[0].children[0]).not.toHaveProperty('sourceChanges');
    // Past revisions stay readable.
    expect(await call(`/api/resumes/${direction.id}?revision=1`)).toMatchObject({ revision: 1, name: '后端方向' });
    expect(await call(`/api/resumes/${direction.id}?revision=1`)).not.toHaveProperty('purpose');
    expect(
      (await bridgeRequest(bridge.runtime, `/api/resumes/${direction.id}?revision=9`).catch((error) => error)).code,
    ).toBe('VALIDATION_FAILED');
  } finally {
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});
it('labels each past revision from its own before and after, even after later edits', async () => {
  const { root, bridge } = await setup();
  const call = async (route: string, method = 'GET', value?: unknown) =>
    (await bridgeRequest(bridge.runtime, route, method, value)).json() as Promise<Record<string, any>>;
  try {
    const document = await bridge.service.create({ name: '完整经历', data: cloneSample() });
    await call(`/api/resumes/${document.id}`, 'PATCH', {
      baseRevision: 1,
      mutationId: 'drop-summary',
      operations: [{ op: 'remove', path: '/data/sections/0' }],
    });
    await call(`/api/resumes/${document.id}`, 'PATCH', {
      baseRevision: 2,
      mutationId: 'drop-skill',
      operations: [{ op: 'remove', path: '/data/sections/3/entries/0' }],
    });
    await call(`/api/resumes/${document.id}`, 'PATCH', {
      baseRevision: 3,
      mutationId: 'rename',
      operations: [{ op: 'replace', path: '/name', value: '后来改名' }],
    });
    const { revisions } = await call(`/api/resumes/${document.id}/history`);
    expect(
      revisions.map(({ revision, created, changes }: Record<string, unknown>) => [revision, created, changes]),
    ).toEqual([
      [4, false, ['简历名称']],
      [3, false, ['「专业技能」 · 「工程」（已删除）']],
      [2, false, ['「个人简介」栏目（已删除）']],
      [1, true, []],
    ]);
    // `paths` keeps its earlier meaning for clients that read it.
    expect(revisions[0].paths).toEqual(['/name']);
    expect(revisions[3].paths).toEqual(['/']);
  } finally {
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});
it('keeps a source deletion, addition or move pending until the copy has the same', async () => {
  const { root, bridge } = await setup();
  const call = async (route: string, method = 'GET', value?: unknown) =>
    (await bridgeRequest(bridge.runtime, route, method, value)).json() as Promise<Record<string, any>>;
  const pending = async (id: string) => (await call(`/api/resumes/${id}/source-diff`)).changes;
  const counted = async () => (await call('/api/tree')).resumes[0].children[0].sourceChanges;
  try {
    const master = await bridge.service.create({ name: '完整经历', data: cloneSample() });
    const copy = await call(`/api/resumes/${master.id}/duplicate`, 'POST', { name: '投递版', mutationId: 'copy' });
    const awards = {
      id: 'awards',
      type: 'custom',
      title: '获奖情况',
      visible: true,
      layout: { pageBreakBefore: false },
      entries: [],
    };
    const reversed = [...master.data.sections[4].entries].reverse();
    expect(reversed.length).toBeGreaterThan(1);
    // Dropping the first section shifts every index after it; only the three real changes count.
    await call(`/api/resumes/${master.id}`, 'PATCH', {
      baseRevision: 1,
      mutationId: 'source-edit',
      operations: [
        { op: 'remove', path: '/data/sections/0' },
        { op: 'add', path: '/data/sections/-', value: awards },
        { op: 'replace', path: '/data/sections/3/entries', value: reversed },
      ],
    });
    expect(await pending(copy.id)).toEqual([
      '「个人简介」栏目（已删除）',
      '「专业技能」 · 条目顺序',
      '「获奖情况」栏目（新增）',
    ]);
    expect(await counted()).toBe(3);
    // Each change the copy makes too stops being pending, whatever its position in the copy.
    await call(`/api/resumes/${copy.id}`, 'PATCH', {
      baseRevision: 1,
      mutationId: 'port-delete',
      operations: [{ op: 'remove', path: '/data/sections/0' }],
    });
    expect(await pending(copy.id)).toEqual(['「专业技能」 · 条目顺序', '「获奖情况」栏目（新增）']);
    await call(`/api/resumes/${copy.id}`, 'PATCH', {
      baseRevision: 2,
      mutationId: 'port-move',
      operations: [{ op: 'replace', path: '/data/sections/3/entries', value: reversed }],
    });
    expect(await pending(copy.id)).toEqual(['「获奖情况」栏目（新增）']);
    expect(await counted()).toBe(1);
    await call(`/api/resumes/${copy.id}`, 'PATCH', {
      baseRevision: 3,
      mutationId: 'port-add',
      operations: [{ op: 'add', path: '/data/sections/-', value: awards }],
    });
    expect(await pending(copy.id)).toEqual([]);
    expect(await counted()).toBeUndefined();
  } finally {
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});
it('keeps serving the web app from memory after losing file access and says why rendering cannot run', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'resume-bridge-'));
  await initializeWorkspace(root);
  const dist = path.join(root, 'web');
  await mkdir(dist);
  await writeFile(path.join(dist, 'index.html'), '<html><head></head><body>fixture</body></html>');
  const inspect = async () => {
    throw new Error('renderer should not be reached');
  };
  const bridge = await startBridge({
    workspace: root,
    dist,
    renderer: () =>
      ({
        inspect,
        export: inspect,
        snapshot: () => {
          throw new Error('unused');
        },
        beginShutdown: () => {},
        close: async () => {},
      }) as never,
  });
  try {
    expect(await (await bridgeRequest(bridge.runtime, '/api/health')).json()).toMatchObject({ fileAccess: true });
    // Simulates a sandbox revoking file access from a background Bridge: the installation disappears from under it.
    await rm(dist, { recursive: true });
    expect(await (await fetch(bridge.origin + '/')).text()).toContain('fixture');
    expect((await fetch(bridge.origin + '/../cvslate.json')).status).toBe(404);
    expect(await (await bridgeRequest(bridge.runtime, '/api/health')).json()).toMatchObject({ fileAccess: false });
    const document = await bridge.service.create({ data: cloneSample() });
    const failure = await bridgeRequest(bridge.runtime, `/api/resumes/${document.id}/inspect`, 'POST', {
      revision: 1,
    }).catch((error) => error);
    expect(failure).toMatchObject({ code: 'STORAGE_FAILED', message: expect.stringContaining('无法读取安装文件') });
  } finally {
    await bridge.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

it('installs, serves, replaces and removes workspace themes, and skips broken ones at startup', async () => {
  const { root, bridge: first, dist } = await setup();
  let bridge = first;
  const controller = new AbortController();
  const { access, readdir, readFile } = await import('node:fs/promises');
  const { themeCatalog } = await import('../../src/core/document');
  const manifest = { ...themeCatalog[0], id: 'ink-demo', name: '墨水示例' };
  try {
    const events = await fetch(bridge.origin + '/api/events', {
      headers: { Authorization: `Bearer ${bridge.runtime.token}` },
      signal: controller.signal,
    });
    const reader = events.body!.getReader();
    await reader.read();
    expect(await (await fetch(bridge.origin)).headers.get('content-security-policy')).toContain("default-src 'self'");
    await expect(
      bridgeRequest(bridge.runtime, '/api/themes', 'POST', { manifest: { ...manifest, id: 'standard' }, css: '' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: expect.stringContaining('内置主题') });
    await expect(
      bridgeRequest(bridge.runtime, '/api/themes', 'POST', {
        manifest,
        css: '.rs-name { background: url(https://example.com/a.png) }',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const installed = await (
      await bridgeRequest(bridge.runtime, '/api/themes', 'POST', {
        manifest,
        css: '.rs-name { color: var(--rs-accent); } .rs-titel { color: #e11d48; }',
      })
    ).json();
    expect(installed).toMatchObject({
      theme: { id: 'ink-demo' },
      replaced: false,
      warnings: [expect.stringContaining('.rs-titel'), expect.stringContaining('#e11d48')],
    });
    let text = '';
    while (!text.includes('event: themes')) text += new TextDecoder().decode((await reader.read()).value);
    expect(text).toContain('"installed":"ink-demo"');
    const listed = await (await bridgeRequest(bridge.runtime, '/api/themes')).json();
    expect(listed.themes.map((theme: { id: string; source: string }) => `${theme.id}:${theme.source}`)).toEqual([
      'standard:builtin',
      'editorial:builtin',
      'minimal:builtin',
      'ink-demo:installed',
    ]);
    expect(await (await bridgeRequest(bridge.runtime, '/api/themes/ink-demo/theme.css')).text()).toContain(
      'var(--rs-accent)',
    );
    expect(JSON.parse(await readFile(path.join(root, 'themes/ink-demo/manifest.json'), 'utf8')).name).toBe('墨水示例');
    expect(
      (
        await (
          await bridgeRequest(bridge.runtime, '/api/themes', 'POST', {
            manifest: { ...manifest, version: '1.0.1' },
            css: '.rs-name { color: black; }',
          })
        ).json()
      ).replaced,
    ).toBe(true);
    expect(await (await bridgeRequest(bridge.runtime, '/api/themes/ink-demo/theme.css')).text()).toBe(
      '.rs-name { color: black; }',
    );
    // A broken package on disk is reported, not served, and does not stop the Bridge.
    await mkdir(path.join(root, 'themes/broken-demo'));
    await writeFile(path.join(root, 'themes/broken-demo/manifest.json'), '{');
    await bridge.close();
    bridge = await startBridge({ workspace: root, dist });
    const restarted = await (await bridgeRequest(bridge.runtime, '/api/themes')).json();
    expect(restarted.themes.at(-1)).toMatchObject({ id: 'ink-demo', version: '1.0.1' });
    expect(restarted.invalid).toEqual([{ folder: 'broken-demo', errors: [expect.stringContaining('manifest.json')] }]);
    const resume = await bridge.service.create({
      name: '主题使用者',
      appearance: { ...(await bridge.service.create({ data: cloneSample() })).appearance, themeId: 'ink-demo' },
    });
    expect(await (await bridgeRequest(bridge.runtime, '/api/themes/ink-demo', 'DELETE', {})).json()).toEqual({
      removed: 'ink-demo',
      usedBy: [{ id: resume.id, name: '主题使用者' }],
    });
    await expect(access(path.join(root, 'themes/ink-demo'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(
      (await readdir(path.join(root, '.cvslate/trash'))).filter((name) => name.startsWith('theme-ink-demo-')),
    ).toHaveLength(2);
    await bridgeRequest(bridge.runtime, '/api/themes/broken-demo', 'DELETE', {});
    await expect(bridgeRequest(bridge.runtime, '/api/themes/ink-demo', 'DELETE', {})).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(bridgeRequest(bridge.runtime, '/api/themes/ink-demo/theme.css')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await (await bridgeRequest(bridge.runtime, '/api/themes')).json()).invalid).toEqual([]);
    expect(
      await (
        await bridgeRequest(bridge.runtime, '/api/themes/check', 'POST', {
          manifest: { ...manifest, engine: 2 },
          css: '',
        })
      ).json(),
    ).toMatchObject({ valid: false, errors: [expect.stringContaining('engine')] });
  } finally {
    controller.abort();
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});
