import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, rm, readFile, writeFile, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { initializeWorkspace } from '../agent/bridge/workspace';
import { startBridge } from '../agent/bridge/server';
import { WorkspaceRenderer } from '../agent/renderer/renderer';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { bridgeRequest } from '../agent/cli/client';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cloneSample } from '../src/core/fixtures';
import { themeCatalog } from '../src/core/document';
import { themeSamples } from '../src/core/theme-samples';

test('inspect passes a blank resume: sections still to be filled in are content hints, not layout issues', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'resume-blank-'));
  await initializeWorkspace(root);
  const bridge = await startBridge({
    workspace: root,
    dist: path.resolve('dist'),
    renderer: (service, runtime) => new WorkspaceRenderer(service, runtime),
  });
  try {
    const document = await bridge.service.create({});
    const run = (...args: string[]) =>
      promisify(execFile)(process.execPath, [path.resolve('agent-dist/cli.mjs'), ...args, '--workspace', root]);
    const report = JSON.parse((await run('inspect', document.id)).stdout);
    expect(report).toMatchObject({ pageCount: 1, layoutValid: true, issues: [] });
    const validated = JSON.parse((await run('validate', document.id)).stdout);
    expect(JSON.stringify(validated)).toContain('“工作经历”没有内容');
  } finally {
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('inspect and PDF use the same two-page snapshot while editing continues', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'resume-pdf-'));
  await initializeWorkspace(root);
  const bridge = await startBridge({
    workspace: root,
    dist: path.resolve('dist'),
    renderer: (service, runtime) => new WorkspaceRenderer(service, runtime),
  });
  const client = new Client({ name: 'pdf-e2e', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve('agent-dist/mcp.mjs'), '--workspace', root],
    stderr: 'pipe',
  });
  await client.connect(transport);
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });
  try {
    const document = await bridge.service.create({ data: cloneSample() });
    const entry = document.data.sections[1].entries[0];
    const operations = Array.from({ length: 15 }, (_, index) => ({
      op: 'add' as const,
      path: '/data/sections/1/entries/-',
      value: { ...structuredClone(entry), id: `pdf-entry-${index}` },
    }));
    await bridge.service.patch(document.id, { baseRevision: 1, mutationId: 'two-pages', operations });
    const inspected = await call('inspect_resume_layout', { id: document.id, revision: 2, maxPages: 2 });
    expect(inspected.isError).not.toBe(true);
    const report = inspected.structuredContent;
    expect(report).toMatchObject({ revision: 2, pageCount: 2, layoutValid: true, constraints: { satisfied: true } });
    expect((report as { pageFill: number[] }).pageFill).toHaveLength(2);
    const cli = await promisify(execFile)(process.execPath, [
      path.resolve('agent-dist/cli.mjs'),
      'inspect',
      document.id,
      '--revision',
      '2',
      '--max-pages',
      '1',
      '--images',
      path.join(root, 'page-images'),
      '--workspace',
      root,
    ]);
    const imaged = JSON.parse(cli.stdout) as {
      pageCount: number;
      constraints: { satisfied: boolean };
      images: string[];
    };
    expect(imaged).toMatchObject({ pageCount: 2, constraints: { maxPages: 1, satisfied: false } });
    expect(imaged.images).toHaveLength(2);
    for (const image of imaged.images)
      expect((await readFile(image)).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    const exporting = call('export_resume_pdf', { id: document.id, revision: 2, filename: '中文简历.pdf' });
    await bridge.service.patch(document.id, {
      baseRevision: 2,
      mutationId: 'while-exporting',
      operations: [{ op: 'replace', path: '/data/basics/name', value: '导出期间的新姓名' }],
    });
    const response = await exporting;
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toMatchObject({
      revision: 2,
      output: await realpath(path.join(root, 'exports/中文简历.pdf')),
    });
    const bytes = await readFile(path.join(root, 'exports/中文简历.pdf'));
    expect((await call('export_resume_pdf', { id: document.id, revision: 2, filename: '中文简历.pdf' })).isError).toBe(
      true,
    );
    expect(await readFile(path.join(root, 'exports/中文简历.pdf'))).toEqual(bytes);
    const loadingTask = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
    const pdf = await loadingTask.promise;
    try {
      expect(pdf.numPages).toBe(2);
      let text = '';
      const links: string[] = [];
      for (let index = 1; index <= pdf.numPages; index++) {
        const page = await pdf.getPage(index);
        const content = await page.getTextContent();
        text += content.items.flatMap((item) => ('str' in item ? [item.str] : [])).join('');
        for (const annotation of await page.getAnnotations()) if (annotation.url) links.push(annotation.url);
        const viewport = page.getViewport({ scale: 1 });
        expect(viewport.width).toBeCloseTo(595.28, 0);
        expect(viewport.height).toBeCloseTo(841.89, 0);
      }
      expect(text).toContain('张三');
      expect(text).toContain('工作经历');
      expect(text).not.toContain('导出期间的新姓名');
      expect(links).toContain('mailto:example@example.com');
      expect(links.some((link) => link.startsWith('https://example.com'))).toBe(true);
    } finally {
      await loadingTask.destroy();
    }
    expect(
      (await call('export_resume_pdf', { id: document.id, revision: 1, filename: 'old.pdf' })).structuredContent,
    ).toMatchObject({ code: 'SNAPSHOT_UNAVAILABLE' });
    await rm(path.join(root, 'exports'), { recursive: true });
    await symlink(path.dirname(root), path.join(root, 'exports'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(
      (await call('export_resume_pdf', { id: document.id, revision: 2, filename: 'escape.pdf' })).structuredContent,
    ).toMatchObject({ code: 'VALIDATION_FAILED' });
    // patch --inspect writes and reports the layout of the revision it produced, in one call.
    const tighter = path.join(root, 'tighter.json');
    await writeFile(
      tighter,
      JSON.stringify({
        baseRevision: 3,
        mutationId: 'cli-tighter',
        operations: [{ op: 'replace', path: '/appearance/layout/baseFontPt', value: 9 }],
      }),
    );
    const patched = JSON.parse(
      (
        await promisify(execFile)(process.execPath, [
          path.resolve('agent-dist/cli.mjs'),
          'patch',
          document.id,
          '--file',
          tighter,
          '--quiet',
          '--inspect',
          '--max-pages',
          '2',
          '--workspace',
          root,
        ])
      ).stdout,
    );
    expect(patched).toMatchObject({
      id: document.id,
      revision: 4,
      layout: { revision: 4, layoutValid: true, constraints: { maxPages: 2 } },
    });
    expect(patched).not.toHaveProperty('data');
    // inspect without --revision checks the current revision and says which one.
    expect(
      JSON.parse(
        (
          await promisify(execFile)(process.execPath, [
            path.resolve('agent-dist/cli.mjs'),
            'inspect',
            document.id,
            '--workspace',
            root,
          ])
        ).stdout,
      ),
    ).toMatchObject({ revision: 4, layoutValid: true });
  } finally {
    await client.close();
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});
/*
 * Parsers that read a PDF's text stream (pdf.js, PyMuPDF's default get_text, applicant tracking systems) see the text in
 * the order Chromium drew it. Every theme, with and without a photo, keeps that order the reading order: the header
 * first with its detail separators in place, then each section title just before its own content.
 */
test('PDF text follows reading order in every theme', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'resume-text-order-'));
  await initializeWorkspace(root);
  let renderer: WorkspaceRenderer | undefined;
  const bridge = await startBridge({
    workspace: root,
    dist: path.resolve('dist'),
    renderer: (service, runtime) => (renderer = new WorkspaceRenderer(service, runtime)),
  });
  try {
    for (const theme of themeCatalog) {
      const photo = themeSamples(theme as Parameters<typeof themeSamples>[0]).find((sample) => sample.id === 'photo')!;
      const variants: { label: string; photo: boolean; settings: Record<string, string> }[] = [
        { label: 'plain', photo: false, settings: {} },
        { label: 'photo', photo: true, settings: {} },
        ...(theme.id === 'standard' ? [{ label: 'center', photo: true, settings: { header: 'center' } }] : []),
      ];
      for (const variant of variants) {
        const data = structuredClone(photo.document.data);
        if (!variant.photo) delete data.basics.photo;
        Object.assign(data.basics, { gender: '男', birthDate: '1998.05', politicalStatus: '群众' });
        const appearance = structuredClone(photo.document.appearance);
        appearance.layout.photoEnabled = variant.photo;
        appearance.settings = variant.settings;
        const document = await bridge.service.create({ data, appearance });
        const { pdf: bytes } = await renderer!.export(document.id, document.revision);
        const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
        try {
          const page = await (await loading.promise).getPage(1);
          const text = (await page.getTextContent()).items
            .flatMap((item) => ('str' in item ? [item.str] : []))
            .join('')
            .replace(/\s+/g, '');
          const contacts = variant.settings.header === 'center' ? ['13800000000|example@example.com|上海'] : [];
          const order = [
            '张三',
            ...contacts,
            '男|1998.05|群众',
            '个人简介',
            '专注于可靠',
            '工作经历',
            '示例科技有限公司',
            '负责核心业务平台',
            '项目经历',
            '本地知识工作台',
            '教育背景',
            '示例大学',
            '专业技能',
            'TypeScript',
          ];
          let at = 0;
          for (const part of order) {
            const found = text.indexOf(part, at);
            expect(found, `${theme.id} ${variant.label}: “${part}” out of order in ${text}`).toBeGreaterThanOrEqual(0);
            at = found + part.length;
          }
          expect(text.split('|').length - 1, `${theme.id} ${variant.label}: separators`).toBe(contacts.length ? 6 : 2);
        } finally {
          await loading.destroy();
        }
      }
    }
  } finally {
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('broken photo decode fails inspect instead of reporting ready', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'resume-photo-'));
  await initializeWorkspace(root);
  const bridge = await startBridge({
    workspace: root,
    dist: path.resolve('dist'),
    renderer: (service, runtime) => new WorkspaceRenderer(service, runtime),
  });
  try {
    const document = await bridge.service.create({ data: cloneSample() });
    await bridge.service.patch(document.id, {
      baseRevision: 1,
      mutationId: 'photo',
      operations: [
        { op: 'add', path: '/data/basics/photo', value: 'data:image/png;base64,AAAA' },
        { op: 'replace', path: '/appearance/layout/photoEnabled', value: true },
      ],
    });
    await expect(
      bridgeRequest(bridge.runtime, `/api/resumes/${document.id}/inspect`, 'POST', { revision: 2 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  } finally {
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});
test('a page asset that fails to load fails inspect at once instead of waiting out the timeout', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'resume-assets-'));
  await initializeWorkspace(root);
  const dist = path.join(root, 'web');
  await mkdir(dist);
  await writeFile(
    path.join(dist, 'index.html'),
    '<html><head><script type="module" src="/assets/missing.js"></script></head><body><div id="root"></div></body></html>',
  );
  const bridge = await startBridge({
    workspace: root,
    dist,
    renderer: (service, runtime) => new WorkspaceRenderer(service, runtime),
  });
  try {
    const document = await bridge.service.create({ data: cloneSample() });
    const started = Date.now();
    await expect(
      bridgeRequest(bridge.runtime, `/api/resumes/${document.id}/inspect`, 'POST', { revision: 1 }),
    ).rejects.toMatchObject({ code: 'STORAGE_FAILED', message: expect.stringContaining('/assets/missing.js') });
    expect(Date.now() - started).toBeLessThan(15000);
  } finally {
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});
test('full collaboration flow: duplicate, Agent, Human, conflict recovery, and two-page delivery', async ({ page }) => {
  const root = await mkdtemp(path.join(tmpdir(), 'resume-demo-'));
  await initializeWorkspace(root);
  const bridge = await startBridge({
    workspace: root,
    dist: path.resolve('dist'),
    renderer: (service, runtime) => new WorkspaceRenderer(service, runtime),
  });
  try {
    const master = await bridge.service.create({ name: '虚构母版 · 压力测试', data: cloneSample() });
    const entry = master.data.sections[1].entries[0];
    await bridge.service.patch(master.id, {
      baseRevision: 1,
      mutationId: 'demo-fixture',
      operations: Array.from({ length: 15 }, (_, index) => ({
        op: 'add',
        path: '/data/sections/1/entries/-',
        value: { ...structuredClone(entry), id: `demo-${index}` },
      })),
    });
    const job = (await (
      await bridgeRequest(bridge.runtime, `/api/resumes/${master.id}/duplicate`, 'POST', {
        name: 'Agent 应用工程师 · 演示岗位版',
      })
    ).json()) as { id: string };
    await page.goto(
      ((await (await bridgeRequest(bridge.runtime, '/api/preview-entry', 'POST', {})).json()) as { url: string }).url,
    );
    await page.locator('[data-resume-row]', { hasText: 'Agent 应用工程师 · 演示岗位版' }).click();
    const name = page.getByRole('textbox', { name: '姓名', exact: true });
    await expect(name).toHaveValue('张三');
    await bridgeRequest(bridge.runtime, `/api/resumes/${job.id}`, 'PATCH', {
      baseRevision: 1,
      mutationId: 'demo-agent-first',
      operations: [{ op: 'replace', path: '/data/basics/headline', value: '软件工程师 · Agent 应用开发' }],
    });
    await expect(page.getByRole('textbox', { name: '目标职位', exact: true })).toHaveValue(
      '软件工程师 · Agent 应用开发',
    );
    await name.fill('人和 Agent 协作');
    await expect(page.getByText('已保存到本机 · r3')).toBeVisible();
    await bridgeRequest(bridge.runtime, `/api/resumes/${job.id}`, 'PATCH', {
      baseRevision: 3,
      mutationId: 'demo-agent-continue',
      operations: [{ op: 'replace', path: '/data/basics/location', value: '上海 · 本地工作区' }],
    });
    await expect(page.getByRole('textbox', { name: '地点', exact: true }).first()).toHaveValue('上海 · 本地工作区');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/resumes/*', async (route) => {
      if (route.request().method() === 'PATCH') await gate;
      await route.continue();
    });
    await name.fill('人工草稿保持完整');
    await bridgeRequest(bridge.runtime, `/api/resumes/${job.id}`, 'PATCH', {
      baseRevision: 4,
      mutationId: 'demo-conflict',
      operations: [{ op: 'replace', path: '/data/basics/name', value: 'Agent 已提交版本' }],
    });
    await expect(page.getByRole('button', { name: '草稿另存为新简历' })).toBeVisible();
    release();
    await page.unrouteAll({ behavior: 'wait' });
    await page.getByRole('button', { name: '草稿另存为新简历' }).click();
    await expect(page.getByLabel('当前简历')).toContainText('草稿');
    await expect(name).toHaveValue('人工草稿保持完整');
    const id = (await page.getByLabel('当前简历').getAttribute('data-resume-id'))!;
    expect((await bridge.service.get(job.id)).data.basics.name).toBe('Agent 已提交版本');
    expect((await bridge.service.get(master.id)).data.basics.name).toBe('张三');
    const report = await (
      await bridgeRequest(bridge.runtime, `/api/resumes/${id}/inspect`, 'POST', { revision: 1, maxPages: 2 })
    ).json();
    expect(report).toMatchObject({ pageCount: 2, layoutValid: true, constraints: { satisfied: true } });
    const response = await bridgeRequest(bridge.runtime, `/api/resumes/${id}/export`, 'POST', { revision: 1 });
    const data = new Uint8Array(await response.arrayBuffer());
    const loading = getDocument({ data: data.slice(), useSystemFonts: true });
    try {
      const pdf = await loading.promise;
      expect(pdf.numPages).toBe(2);
      const content = await (await pdf.getPage(1)).getTextContent();
      expect(content.items.flatMap((item) => ('str' in item ? [item.str] : [])).join('')).toContain('人工草稿保持完整');
    } finally {
      await loading.destroy();
    }
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir('output', { recursive: true });
    await writeFile('output/workspace-demo.pdf', data);
    await writeFile('output/workspace-demo-report.json', JSON.stringify(report, null, 2));
  } finally {
    await page.close();
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});
