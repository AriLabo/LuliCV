import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { normalizeDocument } from '../src/core/document';
import { sampleRecord } from '../src/core/fixtures';
import type { ResumeDocument } from '../src/core/types';

// The editor starts empty; each test here begins with the test sample saved, as if the person had made it.
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '先看看简历效果' })).toBeVisible();
  await page.evaluate(async (document: ResumeDocument) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('lulicv', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction('documents', 'readwrite');
    tx.objectStore('documents').put(document, document.id);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, normalizeDocument(sampleRecord()));
});

// Screenshots cover the A4 page only; the sticky preview toolbar must not overlap it.
async function hideChrome(page: Page) {
  await page.locator('.preview-pane .studio-chrome').evaluateAll((elements) =>
    elements.forEach((element) => {
      (element as HTMLElement).style.display = 'none';
    }),
  );
}

async function showChrome(page: Page) {
  await page.locator('.preview-pane .studio-chrome').evaluateAll((elements) =>
    elements.forEach((element) => {
      (element as HTMLElement).style.display = '';
    }),
  );
}

// A fictitious, light silhouette used wherever a test needs a photo.
const PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAHgAAACcCAMAAACDb590AAAASFBMVEXr7/Tr7vPq7vPp7vPq7fLp7fLp7fHo7fLp7PHo7PHn7PHl6e/i5+3a3+bR19/Gzti8xdC6ws65ws65wc24wc23wc23wMy2wMxjrbEbAAADzklEQVR42u2b23LjIAyGMWvSGoeDKcHv/6YLJN3tAQfhSE53Fs10pnff/CChk8OmJxnr4A7u4A7u4A7u4A7u4A7u4A7uYDKwnES2+M+hYMHH+ZxMDvx0HJjLs9Y2m9FqjroPAfNJGeuDzxbWxeozF/Tgk1TGBe8Wd7XF+RDRghrM54h1X8x7qxgteFTmGzbZxepZEIK5skVutNW0kZvAQlnvtiyYmQrMz3e4UbNmNGAxm3tc56wSJOBRr3e5LtiGqIKDxf2Dzr6tRwIw15cK1/kGyQxRcJKMDpZchyo3SgYHM1ixNACwWxRHBoNO2i0B7F4Mz7XazhoIloMOyzPA8Yo9RPHbonDBsCuOl7xqLp8CDh38z4JnGDi+1rjgmIwD7AE5Iz8gHPqAIINjnQfhxopPviCDYZcMvmJ4WhwhZ91QgoDBXMFOmqDKhFQC4DqgpdhTAME0nURdMlxwC5irimO3CG7rnVSFO9O0MJXDjs05J1Kc2rZN8qWN26g4kp1fEPQ2jyJOU3Em4FfTOn5pnvrwNPRxy5fZi57HiRg8jVOeN3m3JHM+pGkTfz1isscnpa29rCGk8ZrZNV/bOctMk0ydTc1yD3b/9FYIPnAe//bOb/fPq2W2/2dQ3sEdTAV+X8KkNcxRcSzz43FbwuQ1zK5HpBksbs+lte9rmPRsDryV3QjmPC9+YoLwN7slCjVxwtVATkshp8QPvXhKjatrTVKsCftp8fNpEuCuaZlgXn3N/+5O45b3T9gtzOu14qk1i6kG4pjgcdYWNooIBlhtgsDibFYHmgikxYSaTkjgatP0WbQzkJKzDk6l9MW1WIAU2VVwbh5cm0HaClbnBtdsgEaKUXAhmmuK93EBZPb4qGdfm87w4qiNzKi4tZEIw3cs2BCIETgWyMG2waNyj9q9a2aPLgPuk7c3fptg4E5v9zSX0Xj0n7fTNCt+1LNqns3QnyxgMDNiwZuSGa3gbcllsMQTvCWZkcXwh6UfHKw9nuCNWGbF7GARwa6852RF11ocJtgAj1qgulZ2r18wMO5Jb+yUWfGk31AFewO74xG2sX3Qrxn5ScezLu1YGenr8fcLoDpYxgoA96TLH+J8B6NfcfmSGf0VXxfpdfAZH1yK5EPApWqTFXwLnVvyrgIY3beK3vVjwNBva9DBJNFU+jCFHeHUpXjq4A7u4A4GgtcqeEJvI5IVPkL+lp0Gmuz0o/Px+px8LLA7p+u4Sz6lvH1alQkCQz/TfzCaCnE84HsXqHei8C5f+Ab5kP541QOgP35Bv+TirzYKzjXgjyIKG4Lfx4d1VDvKFrsAAAAASUVORK5CYII=',
  'base64',
);

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByText('排版检查通过')).toBeVisible();
  await expect(page.locator('[data-a4-page]')).toHaveCount(1);
}

async function addPhoto(page: Page) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByText('选择本地照片').click();
  await (await chooser).setFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: PHOTO });
  await expect(page.locator('.page-wrap .rs-photo')).toBeVisible();
}

const themeTrigger = (page: Page) => page.getByRole('button', { name: /^主题：/ });

// Applies a theme from the panel, closes it, and dismisses the switch note so it does not cover the page.
async function chooseTheme(page: Page, name: string) {
  await themeTrigger(page).click();
  await page.getByRole('region', { name: '选择主题' }).getByRole('button', { name, exact: true }).click();
  await page.getByRole('button', { name: '完成' }).click();
  await page.getByRole('button', { name: '关闭换主题提示' }).click();
}

async function setting(page: Page, label: string, value: string) {
  await page.getByText('页面与排版').click();
  await page.locator('.layout-popover').getByLabel(label).selectOption(value);
  await page.keyboard.press('Escape');
}

test('标准主题 一页 / 标准密度 / 无照片', async ({ page }) => {
  await ready(page);
  await expect(page.locator('.page-wrap.rs-theme--standard .rs-name')).toHaveText('张三');
  await page.locator('.preview-toolbar').evaluate((element) => {
    (element as HTMLElement).style.display = 'none';
  });
  await expect(page.locator('[data-a4-page="1"]')).toHaveScreenshot('standard-balanced-no-photo.png');
});

test('标准主题的页眉、联系方式和标题线设置只改外观并保持真实链接', async ({ page }) => {
  await ready(page);
  await setting(page, '页眉', 'center');
  await setting(page, '联系方式', 'icons');
  await setting(page, '栏目标题线', 'short');
  const root = page.locator('.page-wrap.rs-theme--standard');
  await expect(root).toHaveClass(/rs-set-header-center/);
  await expect(root.locator('.rs-header')).toHaveCSS('text-align', 'center');
  await expect(root.locator('.rs-contact-icon').first()).toBeVisible();
  await expect(root.locator('a.rs-contact[href^="mailto:"]')).toHaveCount(1);
  await expect(page.getByText('排版检查通过')).toBeVisible();
  await addPhoto(page);
  await page.getByText('页面与排版').click();
  await expect(page.getByRole('checkbox', { name: '显示照片' })).toBeChecked();
  await page.keyboard.press('Escape');
  await page.locator('.preview-toolbar').evaluate((element) => {
    (element as HTMLElement).style.display = 'none';
  });
  await expect(page.locator('[data-a4-page="1"]')).toHaveScreenshot('standard-options-photo.png');
  await mkdir(path.resolve('tmp/pdfs'), { recursive: true });
  const pdf = await page.pdf({
    path: path.resolve('tmp/pdfs/standard-options.pdf'),
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
  });
  expect(pdf.byteLength).toBeGreaterThan(10_000);
});

test('三页母版会舒展页内节奏但保留安全页底', async ({ page }) => {
  await ready(page);
  const section = page.locator('[data-section-type="experience"]');
  for (let index = 0; index < 30; index += 1)
    await section.getByRole('button', { name: '复制', exact: true }).first().click();
  await expect.poll(() => page.locator('[data-a4-page]').count()).toBeGreaterThanOrEqual(3);
  const pageCount = await page.locator('[data-a4-page]').count();
  await expect(page.locator('.page-wrap--balanced-flow')).toHaveCount(pageCount);
  await expect(page.getByText('排版检查通过')).toBeVisible();
  const bottomSpaces = await page.locator('[data-page-inner]').evaluateAll((pages) =>
    pages.map((inner) => {
      const innerRect = inner.getBoundingClientRect();
      const finalBlock = inner.lastElementChild?.lastElementChild ?? inner.lastElementChild;
      return finalBlock ? innerRect.bottom - finalBlock.getBoundingClientRect().bottom : innerRect.height;
    }),
  );
  expect(bottomSpaces.every((space) => space >= 45 && space <= 180)).toBe(true);
});

test('霞鹜新晰黑使用本地字体且保持一页排版', async ({ page }) => {
  await ready(page);
  await themeTrigger(page).click();
  await page.getByRole('button', { name: '霞鹜新晰黑（仅常规字重）' }).click();
  await page.getByRole('button', { name: '完成' }).click();
  await expect(page.locator('[data-a4-page]')).toHaveCount(1);
  await expect(page.getByText('排版检查通过')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const fontFamily = await page
    .locator('.page-wrap.rs-theme--standard')
    .evaluate((element) => getComputedStyle(element).fontFamily);
  expect(fontFamily).toContain('LXGW Neo XiHei Local');
  expect(await page.evaluate(() => document.fonts.check('16px "LXGW Neo XiHei Local"', '张三项目经验'))).toBe(true);
  await page.locator('.preview-toolbar').evaluate((element) => {
    (element as HTMLElement).style.display = 'none';
  });
  await expect(page.locator('[data-a4-page="1"]')).toHaveScreenshot('standard-xihei.png');
});

test('编辑主题保持真实内容、链接与编号栏目', async ({ page }) => {
  await ready(page);
  await chooseTheme(page, '编辑');
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('[data-a4-page]')).toHaveCount(1);
  const root = page.locator('.page-wrap.rs-theme--editorial');
  await expect(root.locator('.rs-name')).toHaveText('张三');
  await expect(root.locator('a.rs-contact[href^="mailto:"]')).toHaveCount(1);
  await expect(root.locator('.rs-section-index')).toHaveText(['01 /', '02 /', '03 /', '04 /', '05 /']);
  await expect(page.getByText('排版检查通过')).toBeVisible();
  await page.locator('.preview-toolbar').evaluate((element) => {
    (element as HTMLElement).style.display = 'none';
  });
  await expect(page.locator('[data-a4-page="1"]')).toHaveScreenshot('editorial-balanced-no-photo.png');
  await page.locator('.preview-toolbar').evaluate((element) => {
    (element as HTMLElement).style.display = '';
  });
  await addPhoto(page);
  await page.locator('.preview-toolbar').evaluate((element) => {
    (element as HTMLElement).style.display = 'none';
  });
  await expect(page.locator('[data-a4-page="1"]')).toHaveScreenshot('editorial-photo.png');
});

test('编辑主题多页时保持栏目编号与完整内容', async ({ page }) => {
  await ready(page);
  await chooseTheme(page, '编辑');
  const section = page.locator('[data-section-type="experience"]');
  for (let index = 0; index < 15; index += 1)
    await section.getByRole('button', { name: '复制', exact: true }).first().click();
  await expect(page.locator('[data-a4-page]')).toHaveCount(2);
  await expect(page.getByText('排版检查通过')).toBeVisible();
  await expect(page.locator('.page-wrap .rs-section-index')).toHaveText(['01 /', '02 /', '03 /', '04 /', '05 /']);
  await expect(page.locator('[data-a4-page="2"] .resume-block').first()).toBeVisible();
});

test('简约主题使用内置字体', async ({ page }) => {
  await ready(page);
  await chooseTheme(page, '简约');
  await expect(page.getByText('排版检查通过')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.locator('.page-wrap.rs-theme--minimal').evaluate((element) => getComputedStyle(element).fontFamily),
  ).toMatch(/^"Noto Sans SC"/);
  await page.locator('.preview-toolbar').evaluate((element) => {
    (element as HTMLElement).style.display = 'none';
  });
  await expect(page.locator('[data-a4-page="1"]')).toHaveScreenshot('minimal-balanced-no-photo.png');
});

test('商务主题使用通栏页眉和带图标的联系方式', async ({ page }) => {
  await ready(page);
  await chooseTheme(page, '商务');
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('[data-a4-page]')).toHaveCount(1);
  await expect(page.getByText('排版检查通过')).toBeVisible();
  const root = page.locator('.page-wrap.rs-theme--business');
  await expect(root.locator('.rs-contact-icon').first()).toBeVisible();
  // The band is the header's ::before, which reaches out into the page margin.
  const [band, sheet] = await Promise.all([
    root.locator('.rs-header').evaluate((element) => {
      const box = element.getBoundingClientRect();
      const scale = box.width / (element as HTMLElement).offsetWidth;
      const style = getComputedStyle(element, '::before');
      const left = box.left + parseFloat(style.left) * scale;
      return { x: left, width: box.right - parseFloat(style.right) * scale - left };
    }),
    page.locator('[data-a4-page="1"]').boundingBox(),
  ]);
  expect(Math.abs(band.x - sheet!.x)).toBeLessThan(1);
  expect(Math.abs(band.width - sheet!.width)).toBeLessThan(1);
  await page.locator('.preview-toolbar').evaluate((element) => {
    (element as HTMLElement).style.display = 'none';
  });
  await expect(page.locator('[data-a4-page="1"]')).toHaveScreenshot('business-balanced-no-photo.png');
});

test('时间线主题把日期放在左栏', async ({ page }) => {
  await ready(page);
  await chooseTheme(page, '时间线');
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('[data-a4-page]')).toHaveCount(1);
  await expect(page.getByText('排版检查通过')).toBeVisible();
  const head = page.locator('.page-wrap.rs-theme--timeline .rs-entry-head').first();
  const [date, title] = await Promise.all([
    head.locator('.rs-entry-date').boundingBox(),
    head.locator('.rs-entry-title').boundingBox(),
  ]);
  expect(date!.x + date!.width).toBeLessThan(title!.x);
  await page.locator('.preview-toolbar').evaluate((element) => {
    (element as HTMLElement).style.display = 'none';
  });
  await expect(page.locator('[data-a4-page="1"]')).toHaveScreenshot('timeline-balanced-no-photo.png');
});

test('标准主题两页并且没有溢出或空白页', async ({ page }) => {
  await ready(page);
  const section = page.locator('[data-section-type="experience"]');
  for (let index = 0; index < 15; index += 1)
    await section.getByRole('button', { name: '复制', exact: true }).first().click();
  await expect(page.locator('[data-a4-page]')).toHaveCount(2);
  await expect(page.getByText('排版检查通过')).toBeVisible();
  await page.addStyleTag({
    content:
      '.app-shell,.workspace,.preview-pane{height:auto!important;overflow:visible!important}.workspace{display:block!important}.topbar,.editor-pane,.preview-toolbar{display:none!important}',
  });
  await expect(page.locator('[data-a4-page="1"]')).toHaveScreenshot('standard-two-pages-page-1.png');
  await expect(page.locator('[data-a4-page="2"] .resume-block').first()).toBeVisible();
  await expect(page.locator('[data-a4-page="2"]')).toHaveScreenshot('standard-two-pages-page-2.png');
  await mkdir(path.resolve('tmp/pdfs'), { recursive: true });
  await page.pdf({
    path: path.resolve('tmp/pdfs/standard-two-page.pdf'),
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
  });
});

test('栏目可以从新页开始，再点一次恢复', async ({ page }) => {
  await ready(page);
  const toggle = page.locator('[data-section-type="education"]').getByRole('button', { name: '从新页开始' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-a4-page]')).toHaveCount(2);
  await expect(page.locator('[data-a4-page="2"]')).toContainText('教育背景');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-a4-page]')).toHaveCount(1);
});

test('Chromium 打印生成真实文本 A4 PDF', async ({ page }) => {
  await ready(page);
  const outputDir = path.resolve('output/pdf');
  await mkdir(outputDir, { recursive: true });
  const pdf = await page.pdf({
    path: path.join(outputDir, 'lulicv-standard-sample.pdf'),
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
  });
  expect(pdf.byteLength).toBeGreaterThan(10_000);
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
});

test('Comfortable 与 Dense 都保持可读且分页稳定', async ({ page }) => {
  await ready(page);
  await page.getByLabel('密度').selectOption('comfortable');
  await expect(page.locator('[data-a4-page]')).toHaveCount(1);
  await hideChrome(page);
  await expect(page.locator('[data-a4-page="1"]')).toHaveScreenshot('standard-comfortable.png');
  await showChrome(page);
  await page.getByLabel('密度').selectOption('dense');
  await expect(page.locator('[data-a4-page]')).toHaveCount(1);
  await hideChrome(page);
  await expect(page.locator('[data-a4-page="1"]')).toHaveScreenshot('standard-dense.png');
});

test('长 bullet 和中英文混排不裁剪', async ({ page }) => {
  await ready(page);
  const firstBullet = page.locator('[data-section-type="experience"] textarea').nth(1);
  await firstBullet.fill(
    '负责 Agent orchestration 与 TypeScript runtime 的端到端设计；在 macOS / Windows 环境验证中文 CJK 换行、English identifiers、超长公司名称与可复制链接。'.repeat(
      8,
    ),
  );
  await expect(page.getByText('排版检查通过')).toBeVisible();
  await hideChrome(page);
  await expect(page.locator('[data-a4-page="1"]')).toHaveScreenshot('standard-mixed-long-bullet.png');
});

test('选中文字可以局部加粗并作为纯文本标记保存', async ({ page }) => {
  await ready(page);
  await chooseTheme(page, '编辑');
  const bullet = page.getByLabel('第 1 条要点').first();
  await bullet.fill('使用 React 完成关键链路，命中率达到 90%');
  await bullet.evaluate((element) => (element as HTMLTextAreaElement).setSelectionRange(3, 8));
  await bullet.locator('..').getByRole('button', { name: '加粗第 1 条要点中的选中文字' }).click();
  await expect(bullet).toHaveValue('使用 **React** 完成关键链路，命中率达到 90%');
  await expect(page.locator('.page-wrap .resume-inline-strong', { hasText: 'React' })).toBeVisible();
  await expect(page.locator('.page-wrap')).not.toContainText('**React**');
  await expect(page.getByText('排版检查通过')).toBeVisible();
});

test('要点和说明里打的换行在页面上照样换行', async ({ page }) => {
  await ready(page);
  await page.getByLabel('第 1 条要点').first().fill('搭建内容日历\n选题来自评论区高频问题');
  // innerText follows the rendered white-space, so a collapsed newline would come back as a space.
  await expect
    .poll(() => page.locator('.page-wrap .rs-bullet p').first().innerText())
    .toBe('搭建内容日历\n选题来自评论区高频问题');
  await expect(page.getByText('排版检查通过')).toBeVisible();
});

test('Command/Ctrl + Z 可撤销编辑并重做', async ({ page }) => {
  await ready(page);
  const name = page.getByLabel('姓名');
  const originalName = await name.inputValue();
  await name.fill('撤销测试姓名');
  await expect(page.getByRole('button', { name: '撤销' })).toBeEnabled();

  await name.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await expect(name).toHaveValue(originalName);
  await expect(page.getByRole('button', { name: '重做' })).toBeEnabled();

  await name.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y');
  await expect(name).toHaveValue('撤销测试姓名');
  await expect(page.locator('.page-wrap h1')).toContainText('撤销测试姓名');
});

test('本地照片可以开启并关闭', async ({ page }) => {
  await ready(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByText('选择本地照片').click();
  await (await chooser).setFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: PHOTO });
  await expect(page.getByRole('img', { name: '已选择的本地照片' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('照片已加载');
  await expect(page.locator('.page-wrap .rs-photo')).toBeVisible();
  await page.getByText('页面与排版').click();
  await expect(page.getByRole('checkbox', { name: '显示照片' })).toBeChecked();
  await hideChrome(page);
  await expect(page.locator('[data-a4-page="1"]')).toHaveScreenshot('standard-photo.png');
  await showChrome(page);
  await page.getByRole('checkbox', { name: '显示照片' }).uncheck();
  await expect(page.locator('.rs-photo')).toHaveCount(0);
  await page.getByRole('button', { name: '移除照片' }).click();
  await expect(page.getByRole('img', { name: '已选择的本地照片' })).toHaveCount(0);
  // Clicking in the editor closed the layout popover; reopen it to check the toggle.
  await page.getByText('页面与排版').click();
  await expect(page.getByRole('checkbox', { name: '显示照片' })).toBeDisabled();
});

test('链接从常用名称里添加，最多 3 个，名称和网址有长度上限', async ({ page }) => {
  await ready(page);
  const links = page.locator('.link-editor');
  const add = page.getByText('＋ 添加链接');
  // The sample already has 个人网站 and GitHub.
  await expect(links).toHaveCount(2);
  await add.click();
  await page.getByRole('menuitem', { name: '作品集' }).click();
  await expect(links.last().getByRole('textbox', { name: '名称' })).toHaveValue('作品集');
  await links
    .last()
    .getByRole('textbox', { name: '网址' })
    .fill(`https://example.com/${'a'.repeat(600)}`);
  await expect(links.last().getByRole('textbox', { name: '网址' })).toHaveValue(
    `https://example.com/${'a'.repeat(480)}`,
  );
  await expect(add).toHaveCount(0);
  await expect(page.getByText('最多 3 个链接')).toBeVisible();
  await links.last().getByRole('button', { name: '删除' }).click();
  await add.click();
  await page.getByRole('menuitem', { name: '其他链接' }).click();
  await links.last().getByRole('textbox', { name: '名称' }).fill('一'.repeat(31));
  await expect(links.last().getByRole('textbox', { name: '名称' })).toHaveValue('一'.repeat(30));
  await expect(add).toHaveCount(0);
});

test('账号链接可以只显示名称，网址较长时编辑器提示', async ({ page }) => {
  await ready(page);
  await page.getByText('＋ 添加链接').click();
  await page.getByRole('menuitem', { name: '其他链接' }).click();
  const link = page.locator('.link-editor').last();
  const contact = page.locator('.page-wrap .rs-contact[data-kind="link"]').last();
  await expect(link.getByRole('combobox', { name: '显示', exact: true })).toHaveValue('label');
  await link.getByRole('textbox', { name: '名称' }).fill('小红书 @林夏的耳饰铺');
  await expect(contact.locator('.rs-contact-value')).toHaveText('小红书 @林夏的耳饰铺');
  await expect(contact).not.toHaveAttribute('href');
  await link
    .getByRole('textbox', { name: '网址' })
    .fill('https://www.xiaohongshu.com/user/profile/5f2a9c1e0000000001008a3b');
  await expect(contact).toHaveAttribute('href', 'https://www.xiaohongshu.com/user/profile/5f2a9c1e0000000001008a3b');
  await expect(contact.locator('.rs-contact-value')).toHaveText('小红书 @林夏的耳饰铺');
  await expect(link.getByText('打印到纸上看不到网址')).toBeVisible();
  await link.getByRole('combobox', { name: '显示', exact: true }).selectOption('both');
  await expect(contact.locator('.rs-contact-value')).toHaveText(
    '小红书 @林夏的耳饰铺 xiaohongshu.com/user/profile/5f2a9c1e0000000001008a3b',
  );
  await expect(link.getByRole('combobox', { name: '显示', exact: true })).toHaveAccessibleDescription(
    '网址较长，可以改成只显示名称',
  );
});

test('链接图标默认按网址和名称自动选，也可以自己选或不显示', async ({ page }) => {
  await ready(page);
  await page.getByText('＋ 添加链接').click();
  await page.getByRole('menuitem', { name: '其他链接' }).click();
  const link = page.locator('.link-editor').last();
  const icon = link.getByRole('combobox', { name: '图标', exact: true });
  const contactIcon = page.locator('.page-wrap .rs-contact[data-kind="link"]').last().locator('.rs-contact-icon');
  await link.getByRole('textbox', { name: '名称' }).fill('小红书 @林夏的耳饰铺');
  await expect(icon.locator('option:checked')).toHaveText('自动（小红书）');
  await expect(contactIcon).toHaveAttribute('data-icon', 'xiaohongshu');
  await link.getByRole('textbox', { name: '网址' }).fill('https://github.com/linxia-demo');
  await expect(icon.locator('option:checked')).toHaveText('自动（GitHub）');
  await expect(contactIcon).toHaveAttribute('data-icon', 'github');
  await icon.selectOption('globe');
  await expect(contactIcon).toHaveAttribute('data-icon', 'globe');
  await icon.selectOption('none');
  await expect(contactIcon).toHaveCount(0);
  await icon.selectOption('');
  await expect(contactIcon).toHaveAttribute('data-icon', 'github');
});

test('补充信息按需添加，清空或移除后收起，页面上排成一行', async ({ page }) => {
  await ready(page);
  const section = page.getByTestId('basic-section');
  const details = page.locator('.page-wrap .rs-details');
  await expect(details).toHaveCount(0);
  await section.getByRole('button', { name: '＋ 性别' }).click();
  await expect(section.getByLabel('性别', { exact: true })).toBeFocused();
  await section.getByLabel('性别', { exact: true }).selectOption('男');
  await section.getByRole('button', { name: '＋ 籍贯' }).click();
  await page.keyboard.type('上海');
  await section.getByRole('button', { name: '＋ 出生年月' }).click();
  await page.keyboard.type('2000.05');
  await expect(section.getByRole('button', { name: '＋ 出生年月' })).toHaveCount(0);
  // Page order is fixed whatever the order they were added in; only 籍贯 shows its label.
  await expect(details).toHaveText('男2000.05籍贯上海', { useInnerText: true });
  await expect(details.locator('.rs-detail-label:visible')).toHaveText(['籍贯']);
  await section.getByRole('button', { name: '＋ 工作年限' }).click();
  await section.getByRole('button', { name: '＋ 政治面貌' }).click();
  // 工作年限 was left empty, so it folded away and is offered again.
  await expect(section.getByRole('button', { name: '＋ 工作年限' })).toBeVisible();
  await page.keyboard.press('Tab');
  await section.getByLabel('出生年月', { exact: true }).fill('');
  // Clearing a field to retype keeps it open until it loses focus.
  await expect(section.getByLabel('出生年月', { exact: true })).toBeVisible();
  await section.getByLabel('出生年月', { exact: true }).blur();
  await section.getByRole('button', { name: '移除籍贯' }).click();
  await expect(details).toHaveText('男', { useInnerText: true });
  await expect(section.locator('[data-detail]')).toHaveCount(1);
});

test('切换 Theme 不修改内容', async ({ page }) => {
  await ready(page);
  const name = page.getByLabel('姓名');
  await name.fill('主题无关内容');
  await chooseTheme(page, '简约');
  await expect(name).toHaveValue('主题无关内容');
  await expect(page.locator('.page-wrap.rs-theme--minimal .rs-name')).toHaveText('主题无关内容');
  await chooseTheme(page, '标准');
  await expect(name).toHaveValue('主题无关内容');
  await expect(page.locator('.page-wrap.rs-theme--standard .rs-name')).toHaveText('主题无关内容');
});

test('主题面板悬停只预览不保存，点击应用后可一步撤销', async ({ page }) => {
  await ready(page);
  await page.getByLabel('密度').selectOption('dense');
  await themeTrigger(page).click();
  const panel = page.getByRole('region', { name: '选择主题' });
  // Thumbnails render the person's own content but are not pages, so layout checks never count them.
  await expect(panel.locator('.theme-thumb .rs-name')).toHaveText(Array(5).fill('张三'));
  await expect(page.locator('[data-a4-page]')).toHaveCount(1);
  await expect(panel.getByRole('button', { name: '标准', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await panel.getByRole('button', { name: '简约', exact: true }).hover();
  await expect(page.locator('.page-wrap.rs-theme--minimal')).toBeVisible();
  await expect(page.getByText('正在预览「简约」')).toBeVisible();
  await expect(themeTrigger(page)).toHaveAttribute('data-theme-id', 'standard');
  await page.getByRole('heading', { name: '选择主题' }).hover();
  await expect(page.locator('.page-wrap.rs-theme--standard')).toBeVisible();
  await expect(page.getByText('正在预览「简约」')).toHaveCount(0);

  await panel.getByRole('button', { name: '简约', exact: true }).click();
  await expect(themeTrigger(page)).toHaveAccessibleName('主题：简约 · 墨黑');
  await expect(page.locator('.page-wrap.rs-theme--minimal')).toBeVisible();
  await expect(page.getByLabel('密度')).toHaveValue('dense');
  await expect(page.getByText('已换成「简约」')).toBeVisible();
  await page.getByRole('button', { name: '完成' }).click();
  await expect(page.getByRole('region', { name: '选择主题' })).toHaveCount(0);

  await page.getByRole('button', { name: '撤销换主题' }).click();
  await expect(themeTrigger(page)).toHaveAccessibleName('主题：标准 · 藏蓝');
  await expect(page.getByLabel('密度')).toHaveValue('dense');
  await expect(page.getByText('已换成「简约」')).toHaveCount(0);

  // The note only offers undo while the switch is still the latest change.
  await chooseTheme(page, '编辑');
  await themeTrigger(page).click();
  await page.getByRole('region', { name: '选择主题' }).getByRole('button', { name: '简约', exact: true }).click();
  await page.getByRole('button', { name: '完成' }).click();
  await page.getByLabel('姓名').fill('换主题后继续编辑');
  await expect(page.getByRole('button', { name: '撤销换主题' })).toHaveCount(0);
  await expect(themeTrigger(page)).toHaveAttribute('data-theme-id', 'minimal');
});

test('页面先宽后窄（如 agent 侧边浏览器停靠）时打开预览，手动选过之后保持选择', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await ready(page);
  await page.setViewportSize({ width: 420, height: 900 });
  await expect(page.getByRole('tab', { name: '预览' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: '编辑' }).click();
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.setViewportSize({ width: 420, height: 900 });
  await expect(page.getByRole('tab', { name: '编辑' })).toHaveAttribute('aria-selected', 'true');
});

test('窄屏从底部打开主题面板，点一下即应用', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 900 });
  await page.goto('/');
  await page.getByRole('tab', { name: '预览' }).click();
  await themeTrigger(page).click();
  const sheet = page.locator('.theme-panel--sheet');
  await expect(sheet).toBeVisible();
  const box = await sheet.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(900);
  await sheet.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(themeTrigger(page)).toHaveAttribute('data-theme-id', 'editorial');
  await expect(page.locator('.page-wrap.rs-theme--editorial')).toBeVisible();
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
});

test('粘贴 ResumeData 可校验、覆盖当前内容或导入为新简历', async ({ page }) => {
  await ready(page);
  await chooseTheme(page, '编辑');
  await page.getByText('导出、导入与粘贴 JSON').click();
  await expect(page.getByRole('button', { name: '从文件导入（作为新简历）' })).toBeVisible();
  const textarea = page.getByLabel('粘贴 Resume JSON');

  await textarea.fill('{ wrong json');
  await page.getByRole('button', { name: '校验 JSON' }).click();
  await expect(page.getByRole('status')).toContainText('JSON 语法错误');

  const exported = {
    schemaVersion: 1,
    basics: {
      name: '批量更新姓名',
      headline: '本地 JSON 导入',
      phone: '',
      email: 'example@example.com',
      location: '上海',
      links: [],
    },
    sections: [
      {
        id: 'summary-import',
        type: 'summary',
        title: '简介',
        visible: true,
        layout: { pageBreakBefore: false },
        text: '这是粘贴导入的内容。',
        entries: [],
      },
    ],
  };
  await textarea.fill(JSON.stringify(exported, null, 2));
  await page.getByRole('button', { name: '校验 JSON' }).click();
  await expect(page.getByRole('status')).toContainText('校验通过');

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '覆盖当前简历' }).click();
  await expect(page.getByRole('textbox', { name: '姓名', exact: true })).toHaveValue('批量更新姓名');
  await expect(themeTrigger(page)).toHaveAttribute('data-theme-id', 'editorial');
  await expect(page.locator('.page-wrap .rs-name')).toHaveText('批量更新姓名');

  exported.basics.name = '新版本姓名';
  await textarea.fill(JSON.stringify(exported, null, 2));
  await page.getByRole('button', { name: '导入为新简历' }).click();
  await expect(page.getByRole('textbox', { name: '姓名', exact: true })).toHaveValue('新版本姓名');
  await expect(themeTrigger(page)).toHaveAttribute('data-theme-id', 'editorial');
  await expect(page.locator('[data-resume-row]')).toHaveCount(2);
  await expect(page.getByRole('status')).toContainText('已导入为新简历');

  const completeResume = {
    id: 'resume-complete-import',
    name: '含样式的简历',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    data: exported,
    appearance: {
      themeId: 'minimal',
      density: 'dense',
      layout: {
        pageMarginMm: 12,
        baseFontPt: 9.2,
        lineHeight: 1.38,
        sectionSpacingPt: 6,
        accentColor: '#2d3c97',
        photoEnabled: false,
      },
    },
  };
  await textarea.fill(JSON.stringify(completeResume, null, 2));
  await page.getByRole('button', { name: '校验 JSON' }).click();
  await expect(page.getByRole('status')).toContainText('完整简历格式');
  await page.getByRole('button', { name: '导入为新简历' }).click();
  await expect(themeTrigger(page)).toHaveAttribute('data-theme-id', 'minimal');
  await expect(page.getByLabel('密度')).toHaveValue('dense');
  await expect(page.locator('.page-wrap.rs-theme--minimal')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('恢复主题与排版设置');
});
