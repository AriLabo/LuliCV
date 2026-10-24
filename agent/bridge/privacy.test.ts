import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { initializeWorkspace } from './workspace';
import { startBridge, type Redaction } from './server';
import { bridgeRequest } from '../cli/client';
import { browserCookie } from './testing';
import { cloneSample } from '../../src/core/fixtures';
import type { ResumeDocument } from '../../src/core/types';

// Fictitious values: the sample resume's own, an older phone number, and a link added below.
const real = ['张三', '13800000000', '138 0000 0000', '13700000000', 'example@example.com', 'files.example-zs.net'];
const leaks = (value: unknown) => real.filter((text) => JSON.stringify(value).includes(text));
const fields = ['name', 'phone', 'email', 'photo', 'links'];

async function setup(options: { exportApprovalMs?: number } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'resume-privacy-'));
  await initializeWorkspace(root);
  const dist = path.join(root, 'web');
  await mkdir(dist);
  await writeFile(path.join(dist, 'index.html'), '<html><head></head><body>fixture</body></html>');
  const redactions: Array<Redaction | undefined> = [];
  // The fake renderer echoes real values the way a layout report could quote page text, and "exports" what it lays out.
  const report = {
    pageCount: 1,
    issues: [{ code: 'overflow', page: 1, message: '张三 的联系方式 13800000000 超出页面' }],
  };
  const renderer = (service: {
    get(id: string): Promise<ResumeDocument>;
    renderable(document: ResumeDocument): ResumeDocument;
  }) => ({
    inspect: async () => structuredClone(report),
    preview: async (_id: string, _revision: number, redaction?: Redaction) => {
      redactions.push(redaction);
      return { report: structuredClone(report), pages: ['5byg5LiJ'] };
    },
    export: async (id: string) => ({
      pdf: Buffer.from(JSON.stringify(service.renderable(await service.get(id)).data)),
      report,
    }),
    snapshot: () => {
      throw new Error('unused');
    },
    beginShutdown: () => {},
    close: async () => {},
  });
  const bridge = await startBridge({ workspace: root, dist, renderer: renderer as never, ...options });
  const cookie = await browserCookie(bridge.runtime);
  const browserResponse = async (route: string, method = 'GET', value?: unknown) =>
    fetch(bridge.origin + route, {
      method,
      headers: { Cookie: cookie, ...(value === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: value === undefined ? undefined : JSON.stringify(value),
    });
  const browser = async (route: string, method = 'GET', value?: unknown) =>
    (await browserResponse(route, method, value)).json();
  const agent = async (route: string, method = 'GET', value?: unknown) =>
    (await bridgeRequest(bridge.runtime, route, method, value)).json();
  const refused = (route: string, method = 'GET', value?: unknown) =>
    bridgeRequest(bridge.runtime, route, method, value).then(
      () => 'allowed',
      (error) => error.code as string,
    );
  const exported = async (id: string, revision: number) =>
    JSON.parse(
      await (await browserResponse(`/api/resumes/${id}/export`, 'POST', { revision })).text(),
    ) as ResumeDocument['data'];
  /** A resume with real values and an older revision, written before privacy mode was on. */
  const resume = async (name = '张三 · 后端') => {
    const created = (await agent('/api/resumes', 'POST', { name, data: cloneSample() })) as ResumeDocument;
    await agent(`/api/resumes/${created.id}`, 'PATCH', {
      baseRevision: 1,
      mutationId: 'old-phone',
      operations: [{ op: 'replace', path: '/data/basics/phone', value: '13700000000' }],
    });
    return (await agent(`/api/resumes/${created.id}`, 'PATCH', {
      baseRevision: 2,
      mutationId: 'details',
      operations: [
        { op: 'replace', path: '/data/basics/phone', value: '13800000000' },
        // Room for one more link under the limit of three.
        { op: 'remove', path: '/data/basics/links/0' },
        {
          op: 'add',
          path: '/data/basics/links/-',
          value: { id: 'files', label: '作品', url: 'ftp://files.example-zs.net' },
        },
        { op: 'replace', path: '/data/sections/0/text', value: '联系 张三，电话 138 0000 0000' },
      ],
    })) as ResumeDocument;
  };
  return { root, bridge, browser, browserResponse, agent, refused, exported, resume, redactions };
}

it('moves the values out of the resumes and shows placeholders to everyone; only the export has the real values', async () => {
  const { root, bridge, browser, agent, exported, resume, redactions } = await setup();
  try {
    const before = await resume();
    const route = `/api/resumes/${before.id}`;
    const enabled = await agent('/api/privacy', 'PUT', { enabled: true, fields });
    expect(enabled).toMatchObject({ enabled: true, fields, conflicts: [], restored: [] });
    expect(enabled.moved).toContainEqual({ field: 'phone', label: '电话', resumes: 1, places: 2 });
    expect(leaks(enabled)).toEqual([]);
    expect(await agent('/api/health')).toMatchObject({ privacyMode: true });

    const reads = {
      list: await agent('/api/resumes'),
      tree: await agent('/api/tree'),
      get: await agent(route),
      oldRevision: await agent(`${route}?revision=1`),
      validate: await agent(`${route}/validate`),
      history: await agent(`${route}/history`),
      inspect: await agent(`${route}/inspect`, 'POST', { revision: 4 }),
      preview: await agent(`${route}/preview`, 'POST', { revision: 4 }),
      privacy: await agent('/api/privacy'),
      error: await bridgeRequest(bridge.runtime, '/api/resumes/13800000000').catch((error) => ({
        code: error.code,
        message: error.message,
      })),
      browserGet: await browser(route),
      browserOldRevision: await browser(`${route}?revision=2`),
      browserList: await browser('/api/resumes'),
      browserPrivacy: await browser('/api/privacy'),
    };
    for (const [name, value] of Object.entries(reads)) expect(leaks(value), name).toEqual([]);
    expect(reads.get).toMatchObject({
      revision: 4,
      data: {
        basics: {
          name: '{{private:name}}',
          phone: '{{private:phone}}',
          email: '{{private:email}}',
          links: [{ url: '{{private:link:link-github}}' }, { url: '{{private:link:files}}' }],
        },
      },
      privacy: { mode: true, fields },
    });
    expect(reads.get.data.sections[0].text).toBe('联系 {{private:name}}，电话 {{private:phone}}');
    expect(reads.browserGet).toMatchObject({ data: { basics: { name: '{{private:name}}' } } });
    expect(reads.browserGet.privacy).toBeUndefined();
    expect(reads.error).toEqual({ code: 'NOT_FOUND', message: '{{private:phone}}' });
    expect(reads.preview).toMatchObject({ pages: ['5byg5LiJ'] });
    expect(redactions[0]?.fields).toEqual(fields);
    expect(redactions[0]?.patterns.length).toBeGreaterThan(0);
    // Validation checks the values the export will have, without quoting them.
    expect(reads.validate.errors).toEqual([]);
    // The web page learns how long each value is, to size its label; agents only whether it is filled.
    expect(reads.browserPrivacy.values.fields.name).toEqual({
      filled: true,
      length: 2,
      shape: { han: 2, digit: 0, latin: 0, other: 0 },
    });
    expect(reads.privacy.values.fields).toEqual({
      name: { filled: true },
      phone: { filled: true },
      email: { filled: true },
      photo: { filled: false },
    });

    const pdf = await exported(before.id, 4);
    expect(pdf.basics).toMatchObject({
      name: '张三',
      phone: '13800000000',
      email: 'example@example.com',
      links: [{ url: 'https://github.com/example' }, { url: 'ftp://files.example-zs.net' }],
    });
    expect(pdf.sections[0].text).toBe('联系 张三，电话 13800000000');
  } finally {
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});

it('saves the built-in example in privacy mode as it is, and protects the person’s details typed into it', async () => {
  const { root, bridge, agent, refused, resume } = await setup();
  try {
    const { id } = await resume();
    await agent('/api/privacy', 'PUT', { enabled: true, fields });
    // Only creating the example marks a resume as one: an agent cannot mark the person's own.
    const { revision } = await agent(`/api/resumes/${id}`);
    for (const op of ['add', 'replace'])
      expect(
        await refused(`/api/resumes/${id}`, 'PATCH', {
          baseRevision: revision,
          mutationId: `mark-${op}`,
          operations: [{ op, path: '/sample', value: true }],
        }),
      ).toBe('VALIDATION_FAILED');
    const stored = await agent('/api/privacy');
    const { document } = await agent('/api/import-resume', 'POST', { mutationId: 'try-it', sample: true });
    expect(document).toMatchObject({
      sample: true,
      data: {
        basics: { name: '林夏', email: 'linxia@example.com', links: [{}, { url: 'https://example.com/linxia' }] },
      },
    });
    expect(JSON.stringify(document)).not.toContain('{{private:');
    expect(await agent('/api/privacy')).toEqual(stored);
    const typed = await agent(`/api/resumes/${document.id}`, 'PATCH', {
      baseRevision: 1,
      mutationId: 'mine-now',
      operations: [
        { op: 'replace', path: '/data/basics/name', value: '张三' },
        { op: 'replace', path: '/data/sections/0/text', value: '联系 张三' },
      ],
    });
    expect(typed.data.basics.name).toBe('{{private:name}}');
    expect(typed.data.sections[0].text).toBe('联系 {{private:name}}');
    expect(JSON.stringify(await agent(`/api/resumes/${document.id}`))).not.toContain('张三');
    // Clearing the mark makes it the person's own: their details in place of the example's, none of the example's stored.
    const again = (await agent('/api/import-resume', 'POST', { mutationId: 'try-again', sample: true })).document;
    const cleared = await agent(`/api/resumes/${again.id}`, 'PATCH', {
      baseRevision: 1,
      mutationId: 'keep-it',
      operations: [{ op: 'remove', path: '/sample' }],
    });
    expect(cleared.sample).toBeUndefined();
    expect(cleared.data.basics).toMatchObject({ name: '{{private:name}}', email: '{{private:email}}' });
    expect(await agent('/api/privacy')).toEqual(stored);
  } finally {
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});

it('stores real values written into a resume as placeholders, and refuses ones it cannot place', async () => {
  const { root, bridge, browser, agent, exported, resume } = await setup();
  try {
    const { id } = await resume();
    const route = `/api/resumes/${id}`;
    await agent('/api/privacy', 'PUT', { enabled: true, fields });

    const edited = await agent(route, 'PATCH', {
      baseRevision: 4,
      mutationId: 'edit',
      operations: [
        { op: 'replace', path: '/data/basics/headline', value: '{{private:name}} · 电话 138-0000-0000' },
        {
          op: 'add',
          path: '/data/basics/links/-',
          value: { id: 'blog', label: '博客', url: 'https://blog.example-zs.net' },
        },
      ],
    });
    expect(edited.data.basics.headline).toBe('{{private:name}} · 电话 {{private:phone}}');
    expect(edited.data.basics.links[2].url).toBe('{{private:link:blog}}');
    expect(edited.privacy.changes).toEqual([
      '链接「博客」的地址已收进隐私信息，简历里换成 {{private:link:blog}}',
      '写入的电话已换成 {{private:phone}}',
    ]);
    expect(JSON.stringify(edited)).not.toContain('blog.example-zs.net');
    expect((await exported(id, 5)).basics.links[2].url).toBe('https://blog.example-zs.net');

    // Copying a token is fine, including into a copy's name.
    const copy = await agent(`${route}/duplicate`, 'POST', { name: '{{private:name}} · 前端', mutationId: 'copy' });
    expect(copy.name).toBe('{{private:name}} · 前端');
    expect(
      await agent('/api/resumes', 'POST', { name: '{{private:name}} 的新简历', data: cloneSample() }),
    ).toMatchObject({
      name: '{{private:name}} 的新简历',
    });

    let attempt = 0;
    const write = (value: unknown, path = '/data/basics/phone') =>
      bridgeRequest(bridge.runtime, route, 'PATCH', {
        baseRevision: 5,
        mutationId: `w-${++attempt}`,
        operations: [{ op: 'replace', path, value }],
      }).then(
        () => 'allowed',
        (error) => `${error.code}: ${error.message}`,
      );
    expect(await write('13911112222')).toMatch(/^VALIDATION_FAILED: 电话是隐私字段/);
    expect(await write('{{private:salary}}', '/data/basics/headline')).toMatch(
      /^VALIDATION_FAILED: \{\{private:salary\}\} 不是可用的隐私占位/,
    );
    expect(await write('{{private:link}}', '/data/basics/headline')).toMatch(/^VALIDATION_FAILED/);
    expect(await write('13911112222')).not.toContain('13911112222');
    // The web page follows the same rules.
    expect(
      await browser(route, 'PATCH', {
        baseRevision: 5,
        mutationId: 'browser',
        operations: [{ op: 'replace', path: '/data/basics/phone', value: '13911112222' }],
      }),
    ).toMatchObject({ code: 'VALIDATION_FAILED' });

    // Restoring a revision from before privacy mode stores placeholders, not the old values.
    const restored = await browser(`/api/resumes/${id}/restore`, 'POST', {
      baseRevision: 5,
      mutationId: 'undo',
      revision: 4,
    });
    expect(restored.revision).toBe(6);
    expect(leaks(restored)).toEqual([]);
    await browser('/api/privacy', 'PUT', { enabled: false, fields });
    // Turned off, every resume gets its values back, and a tokenized revision restored later too.
    expect(await agent(route)).toMatchObject({ data: { basics: { name: '张三', phone: '13800000000' } } });
    const undone = await agent(`/api/resumes/${id}/restore`, 'POST', {
      baseRevision: 7,
      mutationId: 'undo-off',
      revision: 6,
    });
    expect(undone.data.basics).toMatchObject({
      name: '张三',
      phone: '13800000000',
      links: [{ url: 'https://github.com/example' }, { url: 'ftp://files.example-zs.net' }],
    });
  } finally {
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});

it('asks the person which value to export when resumes disagree', async () => {
  const { root, bridge, browser, agent, refused, resume } = await setup();
  try {
    await resume();
    const other = (await agent('/api/resumes', 'POST', { name: '张三 · 前端', data: cloneSample() })) as ResumeDocument;
    await agent(`/api/resumes/${other.id}`, 'PATCH', {
      baseRevision: 1,
      mutationId: 'phone',
      operations: [{ op: 'replace', path: '/data/basics/phone', value: '13911112222' }],
    });

    const plan = await browser('/api/privacy/plan', 'POST', { enabled: true, fields });
    expect(plan.conflicts).toEqual([
      {
        field: 'phone',
        label: '电话',
        options: [
          { value: '13800000000', resumes: 1, mentions: 1 },
          { value: '13911112222', resumes: 1, mentions: 0 },
        ],
      },
    ]);
    expect(await browser('/api/privacy')).toMatchObject({ enabled: false });
    expect(await refused('/api/privacy', 'PUT', { enabled: true, fields })).toBe('VALIDATION_FAILED');
    expect(await refused('/api/privacy', 'PUT', { enabled: true, fields, choices: { phone: '13911112222' } })).toBe(
      'PRIVACY_MODE',
    );
    expect(await browser('/api/privacy', 'PUT', { enabled: true, fields, choices: { phone: 'nope' } })).toEqual({
      code: 'VALIDATION_FAILED',
      message: '电话在几份简历里不一样，请选择导出时统一用哪个',
    });
    expect(await browser('/api/privacy')).toMatchObject({ enabled: false });

    const enabled = await browser('/api/privacy', 'PUT', { enabled: true, fields, choices: { phone: '13911112222' } });
    expect(enabled).toMatchObject({ enabled: true, conflicts: [] });
    for (const document of (await agent('/api/resumes')) as ResumeDocument[])
      expect(document.data.basics.phone).toBe('{{private:phone}}');
  } finally {
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});

it('keeps the values with the person: agents cannot read, change, export or turn them off', async () => {
  const { root, bridge, browser, agent, refused, exported, resume } = await setup();
  try {
    const { id } = await resume();
    await agent('/api/privacy', 'PUT', { enabled: true, fields: ['name', 'phone'] });
    expect(await agent('/api/privacy', 'PUT', { enabled: true, fields: ['name', 'phone', 'email'] })).toMatchObject({
      enabled: true,
      fields: ['name', 'phone', 'email'],
    });
    for (const loosen of [
      { enabled: false, fields: ['name', 'phone', 'email'] },
      { enabled: true, fields: ['name'] },
    ])
      expect(await refused('/api/privacy', 'PUT', loosen)).toBe('PRIVACY_MODE');
    expect(await refused('/api/privacy/values', 'PUT', { key: 'phone', value: '13911112222' })).toBe('PRIVACY_MODE');
    expect(await refused(`/api/resumes/${id}/export`, 'POST', { revision: 4 })).toBe('SNAPSHOT_UNAVAILABLE');
    expect(await refused('/api/backup')).toBe('PRIVACY_MODE');
    expect(await refused('/api/render/any-job')).toBe('PRIVACY_MODE');

    // The person replaces a value in the web page; it is never sent back, and the export uses the new one.
    const saved = await browser('/api/privacy/values', 'PUT', { key: 'phone', value: '13911112222' });
    expect(saved.values.fields.phone).toEqual({
      filled: true,
      length: 11,
      shape: { han: 0, digit: 11, latin: 0, other: 0 },
    });
    expect(JSON.stringify(saved)).not.toContain('13911112222');
    expect(await browser('/api/privacy/values', 'PUT', { key: 'location', value: '杭州' })).toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect((await exported(id, 5)).basics.phone).toBe('13911112222');
    // The replaced value stays covered wherever an old revision still has it.
    expect(JSON.stringify(await agent(`/api/resumes/${id}?revision=3`))).not.toContain('13800000000');

    expect(await browser('/api/privacy', 'PUT', { enabled: false, fields: ['name'] })).toMatchObject({
      enabled: false,
    });
    expect(await agent(`/api/resumes/${id}`)).toMatchObject({
      data: { basics: { name: '张三', phone: '13911112222', email: 'example@example.com' } },
    });
    expect((await agent(`/api/resumes/${id}`)).privacy).toBeUndefined();
  } finally {
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});

it('exports for an agent only after the person approves the requested revision, and logs every outcome', async () => {
  const { root, bridge, browser, browserResponse, agent, refused, resume } = await setup({ exportApprovalMs: 1500 });
  const request = async (id: string, revision: number) => {
    const response = await bridgeRequest(bridge.runtime, `/api/resumes/${id}/export`, 'POST', { revision });
    expect(response.status).toBe(202);
    return response.json();
  };
  try {
    const { id } = await resume();
    await agent('/api/privacy', 'PUT', { enabled: true, fields: ['name', 'phone'] });
    let revision = ((await agent(`/api/resumes/${id}`)) as ResumeDocument).revision;
    expect(await refused(`/api/resumes/${id}/export`, 'POST', { revision: revision - 1 })).toBe('SNAPSHOT_UNAVAILABLE');

    // The request waits for the person; asking again joins it, and nothing else can be asked meanwhile.
    const first = await request(id, revision);
    expect(first).toMatchObject({ status: 'pending', id, revision, pages: 1, webOpen: false });
    expect(first.message).toContain('没有打开的履栗网页');
    expect((await request(id, revision)).requestId).toBe(first.requestId);
    const other = (await agent('/api/resumes', 'POST', { name: '备用', data: cloneSample() })) as ResumeDocument;
    expect(await refused(`/api/resumes/${other.id}/export`, 'POST', { revision: 1 })).toBe('EXPORT_PENDING');
    const pending = (await browser('/api/export-requests')).requests;
    expect(pending).toMatchObject([
      {
        requestId: first.requestId,
        resumeId: id,
        revision,
        pages: 1,
        fields: ['name', 'phone'],
        changed: false,
        status: 'pending',
      },
    ]);
    expect(leaks(pending)).toEqual([]);
    expect(await agent(`/api/export-requests/${first.requestId}?wait=50`)).toMatchObject({ status: 'pending' });

    // Only the web page approves; the PDF goes there, and the agent learns the page count.
    expect(await refused(`/api/export-requests/${first.requestId}/approve`, 'POST', {})).toBe('PRIVACY_MODE');
    expect(await refused(`/api/export-requests/${first.requestId}/decline`, 'POST', {})).toBe('PRIVACY_MODE');
    const approved = await browserResponse(`/api/export-requests/${first.requestId}/approve`, 'POST', {});
    expect(approved.headers.get('x-resume-pages')).toBe('1');
    expect(JSON.parse(await approved.text()).basics.phone).toBe('13800000000');
    const done = await agent(`/api/export-requests/${first.requestId}?wait=1000`);
    expect(done).toMatchObject({
      requestId: first.requestId,
      status: 'approved',
      id,
      revision,
      pages: 1,
      message: 'PDF 已交给用户的浏览器下载，共 1 页；用户没收到文件（比如在保存对话框里取消了）可以再请求一次',
    });
    expect((await browser(`/api/export-requests/${first.requestId}/approve`, 'POST', {})).code).toBe('EXPORT_DECLINED');

    // Declined: the waiting agent hears it at once.
    const second = await request(id, revision);
    expect(second.requestId).not.toBe(first.requestId);
    const waiting = refused(`/api/export-requests/${second.requestId}?wait=5000`);
    expect(await browser(`/api/export-requests/${second.requestId}/decline`, 'POST', {})).toEqual({
      status: 'declined',
    });
    expect(await waiting).toBe('EXPORT_DECLINED');

    // A save after the request: the requested revision can no longer be approved.
    const third = await request(id, revision);
    revision = (
      (await agent(`/api/resumes/${id}`, 'PATCH', {
        baseRevision: revision,
        mutationId: 'headline',
        operations: [{ op: 'replace', path: '/data/basics/headline', value: '后端工程师' }],
      })) as ResumeDocument
    ).revision;
    expect((await browser('/api/export-requests')).requests).toMatchObject([
      { requestId: third.requestId, changed: true },
    ]);
    expect((await browser(`/api/export-requests/${third.requestId}/approve`, 'POST', {})).code).toBe(
      'REVISION_CONFLICT',
    );
    await browser(`/api/export-requests/${third.requestId}/decline`, 'POST', {});

    // Nobody answers: the request expires and counts as declined.
    const fourth = await request(id, revision);
    expect(await refused(`/api/export-requests/${fourth.requestId}?wait=5000`)).toBe('EXPORT_DECLINED');
    expect((await browser('/api/export-requests')).requests).toEqual([]);

    // The person's own export is logged too, with the name as stored.
    await browserResponse(`/api/resumes/${id}/export`, 'POST', { revision });
    const log = (await browser('/api/export-log')).exports;
    expect(
      log.map((entry: { outcome: string; revision: number; pages?: number }) => [
        entry.outcome,
        entry.revision,
        entry.pages,
      ]),
    ).toEqual([
      ['web', revision, 1],
      ['expired', revision, undefined],
      ['declined', revision - 1, undefined],
      ['declined', revision - 1, undefined],
      ['approved', revision - 1, 1],
    ]);
    expect(leaks(log)).toEqual([]);
  } finally {
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});
