import { test, expect, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initializeWorkspace } from '../agent/bridge/workspace';
import { startBridge } from '../agent/bridge/server';
import { bridgeRequest } from '../agent/cli/client';
import { cloneSample } from '../src/core/fixtures';

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'resume-web-'));
  await initializeWorkspace(root);
  const bridge = await startBridge({ workspace: root, dist: path.resolve('dist') });
  const document = await bridge.service.create({ data: cloneSample() });
  const entry = (await (await bridgeRequest(bridge.runtime, '/api/preview-entry', 'POST', {})).json()) as {
    url: string;
  };
  return { root, bridge, document, url: entry.url };
}

const INTERCEPTION_TIMEOUT_MS = 10_000;

/**
 * 拦截自动保存 PATCH 并把请求「扣住」，让测试可以在保存仍在途中时继续操作界面。
 *
 * - `waitUntilHeld()` 只在路由处理器真正挂起该请求之后才返回，因此它证明的是「拦截已生效」，
 *   而不是「请求已发出」。等待超时会抛出带诊断信息的错误，避免只留下 30 秒的整体超时。
 * - `release()` 幂等，可在 finally 中无条件调用，测试提前失败也不会留下未完成的路由拦截。
 */
async function gateAutosaveRequests(page: Page, options: { hold?: 'first' | 'all' } = {}) {
  const holdAll = options.hold === 'all';
  let sawPatch = false;
  page.on('request', (request) => {
    if (request.method() === 'PATCH') sawPatch = true;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markHeld!: () => void;
  const held = new Promise<void>((resolve) => {
    markHeld = resolve;
  });
  let armed = true;
  await page.route('**/api/resumes/*', async (route) => {
    if (route.request().method() === 'PATCH' && (holdAll || armed)) {
      armed = false;
      markHeld();
      await gate;
    }
    await route.continue();
  });
  return {
    release,
    async waitUntilHeld(label: string) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `等待「${label}」被拦截超时（${INTERCEPTION_TIMEOUT_MS}ms）：${sawPatch ? 'PATCH 已发出，但路由没有暂停它' : 'PATCH 从未发出，自动保存没有被触发'}`,
              ),
            ),
          INTERCEPTION_TIMEOUT_MS,
        );
      });
      try {
        await Promise.race([held, expired]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
test('Agent commit updates Web, clears old undo, and subsequent human edits persist', async ({ page }) => {
  const fixture = await setup();
  const { bridge, document } = fixture;
  try {
    await page.goto(fixture.url);
    await expect(page).toHaveURL(bridge.origin + '/');
    const name = page.getByRole('textbox', { name: '姓名', exact: true });
    await expect(name).toHaveValue('张三');
    await name.fill('用户先改');
    await expect(page.getByText('已保存到本机 · r2')).toBeVisible();
    await bridgeRequest(bridge.runtime, `/api/resumes/${document.id}`, 'PATCH', {
      baseRevision: 2,
      mutationId: 'agent-change',
      operations: [{ op: 'replace', path: '/data/basics/name', value: 'Agent 修改' }],
    });
    await expect(name).toHaveValue('Agent 修改');
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
    await expect(page.getByRole('status')).toContainText('Agent 修改了基本信息 · 姓名');
    await name.fill('用户接着改');
    await expect(page.getByText('已保存到本机 · r4')).toBeVisible();
    expect((await bridge.service.get(document.id)).data.basics.name).toBe('用户接着改');
    await page.reload();
    await expect(name).toHaveValue('用户接着改');
  } finally {
    await page.close();
    await bridge.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});
test('in-flight human input survives conflict and reload; saving draft never overwrites Agent', async ({ page }) => {
  const fixture = await setup();
  const { bridge, document } = fixture;
  try {
    await page.goto(fixture.url);
    const name = page.getByRole('textbox', { name: '姓名', exact: true });
    await expect(name).toHaveValue('张三');
    const gate = await gateAutosaveRequests(page, { hold: 'all' });
    try {
      await name.fill('不能丢的草稿');
      await gate.waitUntilHeld('冲突前的草稿自动保存');
      await bridgeRequest(bridge.runtime, `/api/resumes/${document.id}`, 'PATCH', {
        baseRevision: 1,
        mutationId: 'conflict-agent',
        operations: [{ op: 'replace', path: '/data/basics/name', value: 'Agent 最新' }],
      });
      await expect(page.getByRole('button', { name: '草稿另存为新简历' })).toBeVisible();
      await expect(name).toHaveValue('不能丢的草稿');
    } finally {
      gate.release();
      await page.unrouteAll({ behavior: 'wait' });
    }
    await page.reload();
    await expect(name).toHaveValue('不能丢的草稿');
    await page.getByRole('button', { name: '草稿另存为新简历' }).click();
    await expect(page.getByLabel('当前简历')).toContainText('草稿');
    await expect(page.locator('[data-resume-row]')).toHaveCount(2);
    await expect(name).toHaveValue('不能丢的草稿');
    expect((await bridge.service.get(document.id)).data.basics.name).toBe('Agent 最新');
  } finally {
    await page.close();
    await bridge.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});
test('typing during an in-flight successful save queues the next draft without reverting characters', async ({
  page,
}) => {
  const fixture = await setup();
  const { bridge, document } = fixture;
  try {
    await page.goto(fixture.url);
    const name = page.getByRole('textbox', { name: '姓名', exact: true });
    await expect(name).toHaveValue('张三');
    const gate = await gateAutosaveRequests(page, { hold: 'first' });
    try {
      await name.fill('第一批');
      await gate.waitUntilHeld('第一次自动保存');
      await name.fill('第二批继续输入');
    } finally {
      gate.release();
      await page.unrouteAll({ behavior: 'wait' });
    }
    await expect(name).toHaveValue('第二批继续输入');
    await expect(page.getByText('已保存到本机 · r3')).toBeVisible();
    expect((await bridge.service.get(document.id)).data.basics.name).toBe('第二批继续输入');
  } finally {
    await page.close();
    await bridge.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});
test('SSE reconnect refetches changes made while the browser was offline', async ({ page, context }) => {
  const fixture = await setup();
  const { bridge, document } = fixture;
  try {
    await page.goto(fixture.url);
    const name = page.getByRole('textbox', { name: '姓名', exact: true });
    await expect(name).toHaveValue('张三');
    await context.setOffline(true);
    await bridgeRequest(bridge.runtime, `/api/resumes/${document.id}`, 'PATCH', {
      baseRevision: 1,
      mutationId: 'offline-agent',
      operations: [{ op: 'replace', path: '/data/basics/name', value: '断线期间的新版本' }],
    });
    await context.setOffline(false);
    await expect(name).toHaveValue('断线期间的新版本', { timeout: 15000 });
    await expect(page.getByText('已保存到本机 · r2')).toBeVisible();
  } finally {
    await page.close();
    await bridge.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});
test('editor tabs share one event stream, so a seventh tab still opens and every tab follows agent commits', async ({
  page,
  context,
}) => {
  const fixture = await setup();
  const { bridge, document } = fixture;
  // Chromium keeps at most six HTTP/1.1 connections per host; one stream per tab used to leave the seventh tab waiting.
  let streams = 0;
  context.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/events') streams += 1;
  });
  const pages = [page];
  try {
    await page.goto(fixture.url);
    await expect(page.getByRole('textbox', { name: '姓名', exact: true })).toHaveValue('张三');
    for (let index = 1; index < 7; index += 1) {
      const tab = await context.newPage();
      pages.push(tab);
      await tab.goto(bridge.origin + '/');
      await expect(tab.getByRole('textbox', { name: '姓名', exact: true })).toHaveValue('张三');
    }
    expect(streams).toBe(1);
    await bridgeRequest(bridge.runtime, `/api/resumes/${document.id}`, 'PATCH', {
      baseRevision: 1,
      mutationId: 'agent-to-all-tabs',
      operations: [{ op: 'replace', path: '/data/basics/name', value: '所有标签页都看到' }],
    });
    for (const tab of pages)
      await expect(tab.getByRole('textbox', { name: '姓名', exact: true })).toHaveValue('所有标签页都看到');
    // Closing the tab that holds the stream hands it to another tab, which reconnects once.
    await pages.shift()!.close();
    await expect.poll(() => streams).toBe(2);
    await bridgeRequest(bridge.runtime, `/api/resumes/${document.id}`, 'PATCH', {
      baseRevision: 2,
      mutationId: 'agent-after-handover',
      operations: [{ op: 'replace', path: '/data/basics/name', value: '接手之后也能看到' }],
    });
    for (const tab of pages)
      await expect(tab.getByRole('textbox', { name: '姓名', exact: true })).toHaveValue('接手之后也能看到');
    expect(streams).toBe(2);
  } finally {
    for (const tab of pages) await tab.close();
    await bridge.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});
test('Bridge restart retains browser origin and restores a conflicting unsaved draft', async ({ page, context }) => {
  const fixture = await setup();
  let bridge = fixture.bridge;
  try {
    await page.goto(fixture.url);
    const name = page.getByRole('textbox', { name: '姓名', exact: true });
    await expect(name).toHaveValue('张三');
    await context.setOffline(true);
    await name.fill('重启后仍需保留的草稿');
    await expect(page.getByRole('alert')).toContainText('Failed to fetch');
    await bridge.close();
    bridge = await startBridge({ workspace: fixture.root, dist: path.resolve('dist') });
    expect(bridge.origin).toBe(fixture.bridge.origin);
    await bridge.service.patch(fixture.document.id, {
      baseRevision: 1,
      mutationId: 'after-restart',
      operations: [{ op: 'replace', path: '/data/basics/name', value: '重启后的远端版本' }],
    });
    await context.setOffline(false);
    await page.goto(`${bridge.origin}/?restart=1`);
    await expect(name).toHaveValue('重启后仍需保留的草稿');
    await expect(page.getByRole('button', { name: '草稿另存为新简历' })).toBeVisible();
    expect((await bridge.service.get(fixture.document.id)).data.basics.name).toBe('重启后的远端版本');
  } finally {
    await page.close();
    await bridge.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});
test('resume tree creates a job version under a direction and shows source changes', async ({ page }) => {
  const fixture = await setup();
  const { bridge, document } = fixture;
  try {
    const direction = await bridge.service.duplicate(document.id, '后端方向', { mutationId: 'e2e-direction' });
    await page.goto(fixture.url);
    await expect(page.getByRole('textbox', { name: '姓名', exact: true })).toHaveValue('张三');
    const tree = page.getByRole('tree', { name: '简历树' });
    await expect(tree.locator('[data-resume-row]')).toHaveCount(2);
    await tree.locator('[data-resume-row]', { hasText: '后端方向' }).click();
    await page.getByLabel('定位', { exact: true }).fill('投后端、高并发岗位');
    await expect.poll(async () => (await bridge.service.get(direction.id)).purpose).toBe('投后端、高并发岗位');
    await page.getByRole('button', { name: '＋ 为新公司做一份' }).click();
    await page.getByLabel('目标公司').fill('示例科技');
    await page.getByLabel('目标岗位').fill('后端工程师');
    await expect(page.locator('.tree-create').getByLabel('放在')).toHaveValue(direction.id);
    await page.getByRole('button', { name: '创建投递版' }).click();
    await expect(page.getByLabel('当前简历')).toContainText('示例科技 · 后端工程师');
    await expect(page.locator('.crumbs')).toContainText('后端方向');
    const id = (await page.getByLabel('当前简历').getAttribute('data-resume-id'))!;
    await expect
      .poll(async () => (await bridge.service.get(id)).target)
      .toEqual({ company: '示例科技', role: '后端工程师', jd: '' });
    expect(await bridge.service.get(id)).toMatchObject({ parentId: direction.id, source: { id: direction.id } });
    await page.getByLabel('JD 原文', { exact: true }).fill('负责订单系统');
    await expect.poll(async () => (await bridge.service.get(id)).target?.jd).toBe('负责订单系统');
    // The direction gains content; its job version now shows the change.
    const latest = await bridge.service.get(direction.id);
    await bridge.service.patch(direction.id, {
      baseRevision: latest.revision,
      mutationId: 'e2e-direction-edit',
      operations: [{ op: 'add', path: '/data/sections/1/entries/0/bullets/-', value: '新增的成果' }],
    });
    await expect(page.locator('.notice-source')).toContainText('「后端方向」在复制这份之后又改了 1 处内容');
    await page.getByRole('button', { name: '查看改动' }).click();
    await expect(page.locator('.notice-list')).toContainText('「工作经历」 · 「示例科技有限公司」 · 要点');
    await expect(tree.locator('[data-resume-row]', { hasText: '示例科技' }).locator('.dot--stale')).toHaveCount(1);
  } finally {
    await page.close();
    await bridge.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});
test('change history lists human and agent revisions; notices stay visible in preview', async ({ page }) => {
  const fixture = await setup();
  const { bridge, document } = fixture;
  try {
    await page.setViewportSize({ width: 820, height: 1000 });
    await page.goto(fixture.url);
    await expect(page.getByRole('tab', { name: '预览' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('note')).toContainText('点“编辑”修改内容');
    await page.getByRole('tab', { name: '编辑' }).click();
    await expect(page.getByRole('note')).toHaveCount(0);
    await page.getByRole('textbox', { name: '姓名', exact: true }).fill('人工修改');
    await expect(page.getByText('已保存到本机 · r2')).toBeVisible();
    await page.getByRole('tab', { name: '预览' }).click();
    await bridgeRequest(bridge.runtime, `/api/resumes/${document.id}`, 'PATCH', {
      baseRevision: 2,
      mutationId: 'history-agent',
      operations: [{ op: 'replace', path: '/data/basics/headline', value: 'Agent 标题' }],
    });
    await expect(page.getByRole('status')).toContainText('Agent 修改了基本信息 · 目标职位');
    await expect(page.getByRole('status')).toBeVisible();
    await page.getByRole('button', { name: '修改记录' }).click();
    const items = page.locator('[data-history-source]');
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toHaveAttribute('data-history-source', 'agent');
    await expect(items.nth(0)).toContainText('基本信息 · 目标职位');
    await expect(items.nth(1)).toHaveAttribute('data-history-source', 'human');
    await expect(items.nth(1)).toContainText('基本信息 · 姓名');
    await expect(items.nth(2)).toContainText('创建了这份简历');
    await page.reload();
    await expect(page.getByRole('note')).toHaveCount(0);
  } finally {
    await page.close();
    await bridge.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});
