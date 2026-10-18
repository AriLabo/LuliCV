import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initializeWorkspace } from '../agent/bridge/workspace';
import { startBridge } from '../agent/bridge/server';
import { WorkspaceRenderer, coverPrivate, coverTargets } from '../agent/renderer/renderer';
import { bridgeRequest } from '../agent/cli/client';
import { defaultPrivacy, emptyStore, planPrivacy, PrivacyView, type PrivacySettings } from '../src/core/privacy';
import type { ResumeDocument } from '../src/core/types';

const settings: PrivacySettings = { enabled: true, fields: ['name', 'phone', 'email', 'photo', 'location', 'links'] };
const { fields } = settings;

test('page images for agents cover every private value, in its own field and in free text; layout and export use the real values', async ({
  page,
}) => {
  const root = await mkdtemp(path.join(tmpdir(), 'resume-privacy-'));
  await initializeWorkspace(root);
  // What the render page is handed, to check that layout gets the real values while the resume keeps placeholders.
  const laidOut: ResumeDocument[] = [];
  const bridge = await startBridge({
    workspace: root,
    dist: path.resolve('dist'),
    renderer: (service, runtime) => {
      const renderer = new WorkspaceRenderer(service, runtime);
      const snapshot = renderer.snapshot.bind(renderer);
      renderer.snapshot = (key) => {
        const document = snapshot(key);
        laidOut.push(document);
        return document;
      };
      return renderer;
    },
  });
  try {
    const created = await bridge.service.create();
    const resume = await bridge.service.patch(created.id, {
      baseRevision: 1,
      mutationId: 'fixture',
      operations: [
        {
          op: 'replace',
          path: '/data/sections/0/text',
          value: '欢迎联系张三，电话 138-0000-0000，邮箱 Example@Example.com。',
        },
      ],
    });

    // The cover runs on the scaled preview in the studio page, before privacy mode, so the bar positions over real text can be checked.
    const { store } = planPrivacy(
      { settings: defaultPrivacy, store: emptyStore(), documents: [resume], history: [resume] },
      settings,
    );
    const entry = (await (await bridgeRequest(bridge.runtime, '/api/preview-entry', 'POST', {})).json()) as {
      url: string;
    };
    await page.goto(entry.url);
    const article = page.locator('article[data-a4-page]').first();
    await expect(article).toContainText('欢迎联系张三');
    await page.evaluate(coverPrivate, coverTargets({ fields, patterns: new PrivacyView(settings, store).patterns() }));
    const uncovered = await page.evaluate(() => {
      const covers = Array.from(document.querySelectorAll('[data-private-cover]')).map((cover) =>
        cover.getBoundingClientRect(),
      );
      const covered = (rect: DOMRect) =>
        covers.some(
          (cover) =>
            cover.left <= rect.left + 0.5 &&
            cover.top <= rect.top + 0.5 &&
            cover.right >= rect.right - 0.5 &&
            cover.bottom >= rect.bottom - 0.5,
        );
      const missing: string[] = [];
      for (const element of Array.from(
        document.querySelectorAll('article[data-a4-page] .rs-name, article[data-a4-page] .rs-contact-value'),
      )) {
        const range = document.createRange();
        range.selectNodeContents(element);
        if (!Array.from(range.getClientRects()).every(covered)) missing.push(element.textContent ?? '');
      }
      const walker = document.createTreeWalker(document.querySelector('article[data-a4-page]')!, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode())
        for (const text of ['张三', '138-0000-0000', 'Example@Example.com']) {
          const at = node.textContent!.indexOf(text);
          if (at < 0) continue;
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + text.length);
          if (!Array.from(range.getClientRects()).every(covered)) missing.push(text);
        }
      return { covers: covers.length, missing };
    });
    expect(uncovered.covers).toBeGreaterThanOrEqual(6);
    expect(uncovered.missing).toEqual([]);
    await page.locator('article[data-a4-page]').first().screenshot({ path: 'test-results/privacy-cover.png' });

    await bridgeRequest(bridge.runtime, '/api/privacy', 'PUT', settings);
    // The studio page follows: it shows labels in place of the values, never the raw tokens.
    await expect(article.locator('[data-private="name"]').first()).toBeVisible();
    await expect(article).toContainText('欢迎联系姓名');
    await expect(article).not.toContainText('{{private:');
    await expect(article).not.toContainText('张三');
    // The real renderer lays out the real values, takes the redaction path, and still returns every page.
    const preview = (await (
      await bridgeRequest(bridge.runtime, `/api/resumes/${resume.id}/preview`, 'POST', { revision: 3 })
    ).json()) as { pages: string[]; report: { pageCount: number }; privacy: { mode: boolean } };
    expect(preview).toMatchObject({ privacy: { mode: true } });
    expect(preview.pages).toHaveLength(preview.report.pageCount);
    expect(JSON.stringify(preview.report)).not.toContain('张三');
    expect(laidOut.at(-1)?.data.basics.name).toBe('张三');
    expect(laidOut.at(-1)?.data.sections[0].text).toBe('欢迎联系张三，电话 13800000000，邮箱 example@example.com。');
    expect((await bridge.service.get(resume.id)).data.basics.name).toBe('{{private:name}}');
  } finally {
    await page.close();
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('people turn privacy mode on, fill the values, edit around placeholders, export with the real values, and turn it off', async ({
  page,
}) => {
  const root = await mkdtemp(path.join(tmpdir(), 'resume-privacy-ui-'));
  await initializeWorkspace(root);
  const bridge = await startBridge({
    workspace: root,
    dist: path.resolve('dist'),
    renderer: (service, runtime) => new WorkspaceRenderer(service, runtime),
  });
  try {
    const first = await bridge.service.create();
    const resume = await bridge.service.patch(first.id, {
      baseRevision: 1,
      mutationId: 'fixture-a',
      operations: [
        { op: 'replace', path: '/data/basics/name', value: '张三' },
        { op: 'replace', path: '/data/basics/phone', value: '13800000000' },
        { op: 'replace', path: '/data/sections/0/text', value: '欢迎联系张三。' },
        { op: 'replace', path: '/data/basics/links', value: [] },
      ],
    });
    const second = await bridge.service.create();
    await bridge.service.patch(second.id, {
      baseRevision: 1,
      mutationId: 'fixture-b',
      operations: [
        { op: 'replace', path: '/data/basics/name', value: '张小三' },
        { op: 'replace', path: '/data/basics/links', value: [] },
      ],
    });
    const entry = (await (await bridgeRequest(bridge.runtime, '/api/preview-entry', 'POST', {})).json()) as {
      url: string;
    };
    await page.goto(entry.url);
    // Work on the first resume.
    await page.locator('[data-resume-id]').first().waitFor();
    await page.evaluate((id) => localStorage.setItem('cvslate:active', id), resume.id);
    await page.reload();
    const article = page.locator('article[data-a4-page]').first();
    await expect(article).toContainText('欢迎联系张三');

    // Turning it on: pick the fields, see what moves, settle the name that differs between resumes.
    await page.locator('.preview-toolbar').getByRole('button', { name: '开启隐私模式' }).click();
    const dialog = page.getByRole('dialog', { name: '开启隐私模式' });
    await expect(dialog.getByRole('checkbox', { name: '姓名' })).toBeChecked();
    await dialog.getByRole('button', { name: '下一步' }).click();
    await expect(dialog).toContainText('姓名在几份简历里不一样');
    const enable = dialog.getByRole('button', { name: '开启隐私模式' });
    await expect(enable).toBeDisabled();
    await dialog.getByRole('radio', { name: /^张三/ }).check();
    await expect(dialog).toContainText('换成占位');
    await expect(dialog).toContainText('2 份简历，正文里 1 处');
    await page.screenshot({ path: 'test-results/privacy-plan.png' });
    await enable.click();

    const vault = page.getByRole('dialog', { name: '隐私信息' });
    await expect(vault.locator('[data-private-value="name"]')).toContainText('已填写 · 2 个字');
    await expect(vault.locator('[data-private-value="phone"]')).toContainText('已填写 · 11 位');
    await expect(vault).not.toContainText('张三');
    // Write-only: replacing a value starts from an empty input.
    await vault.getByRole('button', { name: '重新填写电话' }).click();
    const input = vault.getByRole('textbox', { name: '填写电话' });
    await expect(input).toHaveValue('');
    await input.fill('13900000000');
    // Typed values are drawn as dots until the user asks to see them; each new entry starts hidden again.
    const masking = () =>
      input.evaluate((element) => getComputedStyle(element).getPropertyValue('-webkit-text-security'));
    expect(await masking()).toBe('disc');
    await vault.getByRole('button', { name: '显示', exact: true }).click();
    expect(await masking()).toBe('none');
    await expect(input).toBeFocused();
    await vault.getByRole('button', { name: '取消' }).click();
    await vault.getByRole('button', { name: '重新填写电话' }).click();
    expect(await masking()).toBe('disc');
    await input.fill('13900000000');
    await vault.getByRole('button', { name: '保存' }).click();
    await expect(vault.locator('[data-private-value="phone"]')).toContainText('已填写 · 11 位');
    await page.screenshot({ path: 'test-results/privacy-vault.png' });
    await vault.getByRole('button', { name: '完成' }).click();

    // The page holds placeholders only: labels in the preview, 【】 in the editor, the lit entry in the preview toolbar.
    await expect(page.getByRole('button', { name: /隐私模式已开启/ })).toBeVisible();
    await expect(article.locator('[data-private="name"]').first()).toBeVisible();
    await expect(article).not.toContainText('张三');
    await expect(page.locator('[data-private-field="name"]')).toContainText('【姓名】');
    const summary = page.getByRole('textbox', { name: '内容' }).first();
    await expect(summary).toHaveValue('欢迎联系【姓名】。');
    // The page asks the Bridge how many pages the real values take; it agrees here, so no note is shown.
    const inspected = page.waitForResponse(
      (response) => response.url().endsWith('/inspect') && response.status() === 200,
    );
    await summary.fill('欢迎联系【姓名】，电话【手机号】。');
    await inspected;
    await expect(page.locator('[data-real-pages]')).toHaveCount(0);
    await expect
      .poll(async () => (await bridge.service.get(resume.id)).data.sections[0].text)
      .toBe('欢迎联系{{private:name}}，电话{{private:phone}}。');
    expect((await bridge.service.get(second.id)).data.basics.name).toBe('{{private:name}}');
    await page.screenshot({ path: 'test-results/privacy-studio.png' });

    // Export goes through the Bridge, which fills in the real values; the file name leaves the name out.
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 PDF' }).click();
    const file = await download;
    expect(file.suggestedFilename()).not.toContain('private');
    expect((await readFile((await file.path())!)).subarray(0, 5).toString()).toBe('%PDF-');

    // Links join later; a new address is stored once, when the field is left, not at every keystroke.
    await page.getByRole('button', { name: /隐私模式已开启/ }).click();
    // The box stays as it is until the change is confirmed.
    await vault.getByRole('checkbox', { name: '链接网址（个人网站、GitHub 等）' }).click();
    const change = page.getByRole('dialog', { name: '确认改动' });
    await change.getByRole('button', { name: '确定' }).click();
    await expect(vault.locator('[data-private-row="links"]')).toContainText('添加链接后出现在这里');
    await vault.getByRole('button', { name: '完成' }).click();
    await page.getByText('＋ 添加链接').click();
    await page.getByRole('menuitem', { name: '作品集' }).click();
    const link = page.locator('.link-editor').last();
    await expect(link.getByRole('textbox', { name: '名称' })).toHaveValue('作品集');
    await link.getByRole('textbox', { name: '网址' }).pressSequentially('https://www.zhihu.com/people/demo');
    await link.getByRole('textbox', { name: '名称' }).click();
    await expect(link).toContainText('【链接·作品集】');
    // The page never holds the address, yet shows the icon the PDF will: the Bridge says which platform it is on.
    await expect(link.getByRole('combobox', { name: '图标', exact: true }).locator('option:checked')).toHaveText(
      '自动（知乎）',
    );
    await expect(
      page.locator('.page-wrap .rs-contact[data-kind="link"]').last().locator('.rs-contact-icon'),
    ).toHaveAttribute('data-icon', 'zhihu');
    await expect
      .poll(async () => (await bridge.service.get(resume.id)).data.basics.links.at(-1)?.url)
      .toMatch(/^\{\{private:link:[\w-]+\}\}$/);
    await page.getByRole('button', { name: /隐私模式已开启/ }).click();
    await expect(vault.locator('.privacy-vault__sub')).toHaveCount(1);
    await expect(vault.locator('.privacy-vault__sub')).toContainText('已填写 · 33 个字符');

    // Turning it off takes a second confirmation and writes the values back.
    await vault.getByRole('button', { name: '关闭隐私模式…' }).click();
    const off = page.getByRole('dialog', { name: '关闭隐私模式' });
    await off.getByRole('button', { name: '关闭隐私模式' }).click();
    await expect(off).toBeHidden();
    await expect(page.locator('.preview-toolbar').getByRole('button', { name: '开启隐私模式' })).toBeVisible();
    await expect(article).toContainText('欢迎联系张三，电话13900000000。');
    expect((await bridge.service.get(second.id)).data.basics.name).toBe('张三');
    expect((await bridge.service.get(resume.id)).data.basics.links.at(-1)?.url).toBe(
      'https://www.zhihu.com/people/demo',
    );
  } finally {
    await page.close();
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('agents export only after the person approves in the web page; the PDF downloads there and every outcome is logged', async ({
  page,
}) => {
  const root = await mkdtemp(path.join(tmpdir(), 'resume-privacy-export-'));
  await initializeWorkspace(root);
  const bridge = await startBridge({
    workspace: root,
    dist: path.resolve('dist'),
    renderer: (service, runtime) => new WorkspaceRenderer(service, runtime),
  });
  const agent = (route: string, method = 'GET', value?: unknown) => bridgeRequest(bridge.runtime, route, method, value);
  try {
    const created = await bridge.service.create();
    await bridge.service.patch(created.id, {
      baseRevision: 1,
      mutationId: 'fixture',
      operations: [
        { op: 'replace', path: '/name', value: '后端 · 示例科技' },
        { op: 'replace', path: '/data/basics/name', value: '张三' },
        { op: 'replace', path: '/data/basics/phone', value: '13800000000' },
      ],
    });
    await agent('/api/privacy', 'PUT', { enabled: true, fields: ['name', 'phone', 'email', 'photo'] });
    const entry = (await (await agent('/api/preview-entry', 'POST', {})).json()) as { url: string };
    await page.goto(entry.url);
    await expect(page.getByRole('button', { name: /隐私模式已开启/ })).toBeVisible();
    let { revision } = await bridge.service.get(created.id);

    // The request shows up in the open page; declining is the default.
    const first = (await (await agent(`/api/resumes/${created.id}/export`, 'POST', { revision })).json()) as {
      requestId: string;
      webOpen: boolean;
    };
    expect(first.webOpen).toBe(true);
    const dialog = page.getByRole('dialog', { name: 'agent 请求导出 PDF' });
    await expect(dialog).toContainText('后端 · 示例科技');
    await expect(dialog).toContainText(`第 ${revision} 版 · 1 页`);
    await expect(dialog.locator('.export-approval__chip')).toHaveText(['姓名', '手机号', '邮箱']);
    await expect(dialog).toContainText(/\d:\d\d 后自动拒绝/);
    await expect(dialog.getByRole('button', { name: '拒绝', exact: true })).toBeFocused();
    await page.screenshot({ path: 'test-results/export-approval.png' });

    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: '批准并导出' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('后端-·-示例科技.pdf');
    expect((await readFile((await file.path())!)).subarray(0, 5).toString()).toBe('%PDF-');
    await expect(dialog).toBeHidden();
    expect(await (await agent(`/api/export-requests/${first.requestId}?wait=1000`)).json()).toMatchObject({
      status: 'approved',
      pages: 1,
      message: 'PDF 已交给用户的浏览器下载，共 1 页；用户没收到文件（比如在保存对话框里取消了）可以再请求一次',
    });

    // A save after the request: approval is off, and closing the dialog declines.
    const second = (await (await agent(`/api/resumes/${created.id}/export`, 'POST', { revision })).json()) as {
      requestId: string;
    };
    await expect(dialog).toBeVisible();
    revision = (
      await bridge.service.patch(created.id, {
        baseRevision: revision,
        mutationId: 'after-request',
        operations: [{ op: 'replace', path: '/data/basics/headline', value: '后端工程师' }],
      })
    ).revision;
    await expect(dialog).toContainText('这份简历在请求后改过，请拒绝，让 agent 重新检查后再导出');
    await expect(dialog.getByRole('button', { name: '批准并导出' })).toBeDisabled();
    await page.screenshot({ path: 'test-results/export-approval-changed.png' });
    const waiting = agent(`/api/export-requests/${second.requestId}?wait=10000`).then(
      () => 'approved',
      (error) => error.code as string,
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(await waiting).toBe('EXPORT_DECLINED');

    // Narrow screens keep every part of the dialog reachable.
    await page.setViewportSize({ width: 375, height: 760 });
    await agent(`/api/resumes/${created.id}/export`, 'POST', { revision });
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: 'test-results/export-approval-narrow.png' });
    await dialog.getByRole('button', { name: '拒绝并关闭' }).click();
    await expect(dialog).toBeHidden();
    await page.setViewportSize({ width: 1280, height: 800 });

    // The log, from the privacy dialog: what happened and to which revision, newest first.
    await page.getByRole('button', { name: /隐私模式已开启/ }).click();
    const vault = page.getByRole('dialog', { name: '隐私信息' });
    await vault.getByRole('button', { name: '导出记录' }).click();
    const log = page.getByRole('dialog', { name: '导出记录' });
    await expect(log.locator('tbody tr')).toHaveCount(3);
    await expect(log.locator('tbody tr').nth(0)).toContainText(`第 ${revision} 版`);
    await expect(log.locator('tbody tr').nth(0)).toContainText('agent 请求，你拒绝了');
    await expect(log.locator('tbody tr').nth(2)).toContainText(`第 ${revision - 1} 版 · 1 页`);
    await expect(log.locator('tbody tr').nth(2)).toContainText('agent 请求，你批准了');
    await expect(log).not.toContainText('张三');
    await page.screenshot({ path: 'test-results/export-log.png' });
    await log.getByRole('button', { name: '返回' }).click();
    await expect(vault.locator('[data-private-value="name"]')).toBeVisible();
  } finally {
    await page.close();
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});
