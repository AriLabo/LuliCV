import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initializeWorkspace } from '../agent/bridge/workspace';
import { startBridge } from '../agent/bridge/server';
import { WorkspaceRenderer } from '../agent/renderer/renderer';
import { bridgeRequest } from '../agent/cli/client';
import { themeCatalog } from '../src/core/document';
import { cloneSample } from '../src/core/fixtures';

const standard = themeCatalog.find((theme) => theme.id === 'standard')!;
const ink = (css: string) => ({ manifest: { ...standard, id: 'ink-demo', name: '墨水', version: '0.1.0' }, css });

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'resume-themes-'));
  await initializeWorkspace(root);
  const bridge = await startBridge({
    workspace: root,
    dist: path.resolve('dist'),
    renderer: (service, runtime, themes) => new WorkspaceRenderer(service, runtime, themes),
  });
  return { root, bridge, css: await readFile(path.resolve('src/themes/standard/theme.css'), 'utf8') };
}

test('theme check lays out every sample within its page budget', async () => {
  const { root, bridge, css } = await setup();
  try {
    const result = (await (
      await bridgeRequest(bridge.runtime, '/api/themes/check', 'POST', { ...ink(css), images: true }, 180_000)
    ).json()) as {
      valid: boolean;
      samples: Array<{
        sample: string;
        maxPages: number;
        report: { pageCount: number; issues: unknown[] };
        pages?: string[];
      }>;
    };
    expect(result.valid).toBe(true);
    expect(result.samples.map((sample) => sample.sample)).toEqual(['short', 'two-page', 'photo', 'long-text']);
    for (const sample of result.samples) {
      expect(sample.report.issues, sample.sample).toEqual([]);
      expect(sample.report.pageCount, sample.sample).toBe(sample.maxPages);
      expect(sample.pages).toHaveLength(sample.report.pageCount);
    }
  } finally {
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('an installed theme is used by inspect and appears in the editor without a reload', async ({ page }) => {
  const { root, bridge, css } = await setup();
  try {
    const document = await bridge.service.create({ data: cloneSample() });
    const inspect = async (revision: number) =>
      (
        (await (
          await bridgeRequest(bridge.runtime, `/api/resumes/${document.id}/inspect`, 'POST', { revision })
        ).json()) as { pageCount: number }
      ).pageCount;
    const baseline = await inspect(1);
    const entry = (await (await bridgeRequest(bridge.runtime, '/api/preview-entry', 'POST', {})).json()) as {
      url: string;
    };
    await page.goto(entry.url);
    const trigger = page.getByRole('button', { name: /^主题：/ });
    const panel = page.getByRole('region', { name: '选择主题' });
    await trigger.click();
    await expect(panel.getByRole('heading', { name: '已安装' })).toHaveCount(0);
    // Installed while the editor is open: the SSE themes event brings it in.
    await bridgeRequest(
      bridge.runtime,
      '/api/themes',
      'POST',
      ink(css + '\n.rs-name { color: rgb(12, 34, 56); }\n.rs-bullet p { font-size: 40pt; }'),
    );
    await expect(panel.getByRole('heading', { name: '已安装' })).toBeVisible();
    await panel.getByRole('button', { name: '墨水', exact: true }).click();
    await expect(page.locator('[data-a4-page="1"] .rs-name')).toHaveCSS('color', 'rgb(12, 34, 56)');
    await expect.poll(async () => (await bridge.service.get(document.id)).appearance.themeId).toBe('ink-demo');
    const revision = (await bridge.service.get(document.id)).revision;
    expect(await inspect(revision)).toBeGreaterThan(baseline);
    // Removed while in use: the resume keeps its theme id and renders with the standard theme.
    await bridgeRequest(bridge.runtime, '/api/themes/ink-demo', 'DELETE', {});
    await expect(trigger).toHaveAccessibleName('主题：ink-demo（未安装）');
    await expect(panel.getByText('当前简历使用的主题「ink-demo」未安装')).toBeVisible();
    await expect(panel.getByRole('heading', { name: '已安装' })).toHaveCount(0);
    await expect(page.locator('[data-a4-page="1"] .rs-name')).not.toHaveCSS('color', 'rgb(12, 34, 56)');
    await page.reload();
    await expect(trigger).toHaveAccessibleName('主题：ink-demo（未安装）');
    expect(await inspect(revision)).toBe(baseline);
  } finally {
    await page.close();
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('a resume stylesheet reaches the preview, thumbnails and renderer, and the person can remove it', async ({
  page,
}) => {
  const { root, bridge } = await setup();
  try {
    const document = await bridge.service.create({ data: cloneSample() });
    const inspect = async (revision: number) =>
      (
        (await (
          await bridgeRequest(bridge.runtime, `/api/resumes/${document.id}/inspect`, 'POST', { revision })
        ).json()) as { pageCount: number }
      ).pageCount;
    const baseline = await inspect(1);
    const css = '.rs-name { color: rgb(12, 34, 56); }\n.rs-bullet p { font-size: 40pt; }';
    await bridgeRequest(bridge.runtime, `/api/resumes/${document.id}`, 'PATCH', {
      baseRevision: 1,
      mutationId: 'own-css',
      operations: [{ op: 'add', path: '/appearance/css', value: css }],
    });
    expect(await inspect(2)).toBeGreaterThan(baseline);
    const entry = (await (await bridgeRequest(bridge.runtime, '/api/preview-entry', 'POST', {})).json()) as {
      url: string;
    };
    await page.goto(entry.url);
    const name = page.locator('[data-a4-page="1"] .rs-name');
    await expect(name).toHaveCSS('color', 'rgb(12, 34, 56)');
    // It stays when the theme changes, so every thumbnail shows it; nothing outside the resume pages is touched.
    await page.getByRole('button', { name: /^主题：/ }).click();
    const thumbnails = page.getByRole('region', { name: '选择主题' }).locator('.theme-thumb__page .rs-name');
    await expect(thumbnails).toHaveCount(themeCatalog.length);
    for (const thumbnail of await thumbnails.all()) await expect(thumbnail).toHaveCSS('color', 'rgb(12, 34, 56)');
    await page.keyboard.press('Escape');
    await page.getByText('页面与排版').click();
    const note = page.locator('.custom-css');
    await expect(note.getByText('这份简历有自定义样式')).toBeVisible();
    await note.getByRole('button', { name: '还原' }).click();
    await expect(name).not.toHaveCSS('color', 'rgb(12, 34, 56)');
    await expect(note).toHaveCount(0);
    await expect.poll(async () => (await bridge.service.get(document.id)).appearance).not.toHaveProperty('css');
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(name).toHaveCSS('color', 'rgb(12, 34, 56)');
    await expect.poll(async () => (await bridge.service.get(document.id)).appearance.css).toBe(css);
  } finally {
    await page.close();
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});
