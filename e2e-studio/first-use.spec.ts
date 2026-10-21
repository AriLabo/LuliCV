import { expect, test } from '@playwright/test';

test('空工作区只预览示例，点了才保存；删掉最后一份回到这里', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '先看看简历效果' })).toBeVisible();
  await expect(page.locator('.page-wrap .rs-name')).toHaveText('林夏');
  // Looking saves nothing: after a reload the workspace is still empty.
  await page.reload();
  await expect(page.getByRole('heading', { name: '先看看简历效果' })).toBeVisible();

  await page.getByRole('button', { name: '新建空白简历' }).click();
  const name = page.getByRole('textbox', { name: '姓名', exact: true });
  await expect(name).toHaveValue('');
  await expect(page.locator('.sample-tag')).toHaveCount(0);
  // Sections still to be filled in are content hints, not layout faults, and print no lone headings.
  await expect(page.getByText('排版检查通过')).toBeVisible();
  await expect(page.locator('.notice-warning')).toHaveCount(0);
  await expect(page.locator('.page-wrap .rs-section-title')).toHaveCount(0);
  await page.locator('.content-hints summary').click();
  await expect(page.locator('.content-hints li', { hasText: '“工作经历”没有内容' })).toBeVisible();
  await page.keyboard.press('Escape');

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByLabel('更多操作').click();
  await page.getByRole('menuitem', { name: '删除简历' }).click();
  await expect(page.getByRole('heading', { name: '先看看简历效果' })).toBeVisible();

  await page.getByRole('button', { name: '使用这份示例' }).click();
  await expect(name).toHaveValue('林夏');
  await expect(page.getByLabel('当前简历').locator('.sample-tag')).toHaveText('示例');
  // The tag says it is the example, so the name does not say it again.
  await expect(page.getByLabel('当前简历')).toHaveText('内容运营示例');
  await page.reload();
  await expect(page.getByLabel('当前简历').locator('.sample-tag')).toHaveText('示例');

  await page.getByLabel('更多操作').click();
  await page.getByRole('menuitem', { name: '取消示例标记' }).click();
  await expect(page.locator('.sample-tag')).toHaveCount(0);
  await page.reload();
  await expect(name).toHaveValue('林夏');
  await expect(page.locator('.sample-tag')).toHaveCount(0);
  await page.getByLabel('更多操作').click();
  await expect(page.getByRole('menuitem', { name: '取消示例标记' })).toHaveCount(0);
});

test('窄屏上示例和新简历的页面都按宽度缩放', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const zoom = () =>
    page.locator('main.preview-pane').evaluate((pane) => Number(pane.style.getPropertyValue('--preview-zoom')));
  await expect.poll(zoom).toBeLessThan(1);
  await page.getByRole('button', { name: '使用这份示例' }).click();
  await expect(page.getByLabel('当前简历').locator('.sample-tag')).toBeVisible();
  await expect.poll(zoom).toBeLessThan(1);
  // The first-visit hint stays on the screen, whole, and covers none of the preview's controls.
  const hint = (await page.getByRole('note').boundingBox())!;
  expect(hint.x).toBeGreaterThanOrEqual(0);
  expect(hint.x + hint.width).toBeLessThanOrEqual(390);
  const toolbar = (await page.locator('.preview-toolbar').boundingBox())!;
  expect(hint.y + hint.height).toBeLessThanOrEqual(toolbar.y);
  await page.getByRole('button', { name: '知道了' }).click();
  await expect(page.getByRole('note')).toHaveCount(0);
});

test('用自己的 JSON 覆盖示例后，就不再标为示例', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '使用这份示例' }).click();
  const tag = page.getByLabel('当前简历').locator('.sample-tag');
  await expect(tag).toHaveText('示例');
  await page.getByText('导出、导入与粘贴 JSON').click();
  const basics = { name: '王五', headline: '', phone: '', email: '', location: '', links: [] };
  await page.getByLabel('粘贴 Resume JSON').fill(JSON.stringify({ schemaVersion: 1, basics, sections: [] }));
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '覆盖当前简历' }).click();
  const name = page.getByRole('textbox', { name: '姓名', exact: true });
  await expect(name).toHaveValue('王五');
  await expect(tag).toHaveCount(0);
  await page.reload();
  await expect(name).toHaveValue('王五');
  await expect(tag).toHaveCount(0);
});

test('空工作区可以直接导入简历 JSON', async ({ page }) => {
  await page.goto('/');
  const basics = { name: '王五', headline: '', phone: '', email: '', location: '', links: [] };
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入简历 JSON' }).click();
  await (
    await chooser
  ).setFiles({
    name: '备份.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, basics, sections: [] })),
  });
  await expect(page.getByRole('textbox', { name: '姓名', exact: true })).toHaveValue('王五');
  await expect(page.locator('.sample-tag')).toHaveCount(0);
});
