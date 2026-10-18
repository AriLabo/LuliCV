import { randomUUID } from 'node:crypto';
import type { Browser } from 'playwright';
import { ResumeError } from '../../src/core/errors';
import type { ResumeService } from '../../src/core/service';
import type { ResumeDocument } from '../../src/core/types';
import type { LayoutReport } from '../../src/core/layout';
import type { Redaction, RenderAdapter, Runtime, ThemeCheckResult } from '../bridge/server';
import type { ThemePackage, ThemeStore } from '../bridge/themes';
import { themeSamples } from '../../src/core/theme-samples';
import { privateDisplayNames } from '../../src/core/privacy';
import { launchChromium } from '../runtime/chromium';
export class WorkspaceRenderer implements RenderAdapter {
  private browser?: Promise<Browser>;
  private readonly retained = new Map<string, ResumeDocument>();
  private readonly jobs = new Map<string, { document: ResumeDocument; theme?: ThemePackage }>();
  private closing = false;
  beginShutdown() {
    this.closing = true;
  }
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly service: ResumeService,
    private readonly runtime: Runtime,
    private readonly themes?: Pick<ThemeStore, 'get'>,
  ) {}
  snapshot(key: string) {
    const job = this.jobs.get(key);
    if (!job) throw new ResumeError('SNAPSHOT_UNAVAILABLE', '渲染任务已结束');
    return structuredClone(job.document);
  }
  /** The installed (or, for a theme check, draft) theme a render job uses; null for built-in themes. */
  theme(key: string) {
    const job = this.jobs.get(key);
    if (!job) throw new ResumeError('SNAPSHOT_UNAVAILABLE', '渲染任务已结束');
    return job.theme ? structuredClone(job.theme) : null;
  }
  private serialize<T>(work: () => Promise<T>) {
    if (this.closing) return Promise.reject(new ResumeError('STORAGE_FAILED', 'Bridge 正在关闭'));
    const result = this.queue
      .catch(() => {})
      .then(() => {
        if (this.closing) throw new ResumeError('STORAGE_FAILED', '渲染任务因 Bridge 关闭而取消');
        return work();
      });
    this.queue = result;
    return result;
  }
  private async readSnapshot(id: string, revision: number) {
    const retained = this.retained.get(id);
    if (retained?.revision === revision) return structuredClone(retained);
    const current = await this.service.get(id);
    if (current.revision !== revision)
      throw new ResumeError('SNAPSHOT_UNAVAILABLE', '该 revision 未保留，请重新检查当前版本', current.revision);
    return current;
  }
  inspect(id: string, revision: number, maxPages?: number) {
    return this.serialize(async () => {
      const snapshot = await this.readSnapshot(id, revision);
      const result = await this.render(snapshot);
      this.retained.set(id, snapshot);
      return {
        ...result.report,
        ...(maxPages === undefined
          ? {}
          : { constraints: { maxPages, satisfied: result.report.pageCount <= maxPages } }),
      };
    });
  }
  export(id: string, revision: number) {
    return this.serialize(async () => {
      const snapshot = await this.readSnapshot(id, revision);
      const result = await this.render(snapshot, 'pdf');
      return { report: result.report, pdf: result.pdf! };
    });
  }
  // Page images are a viewing aid for chat hosts; the PDF remains the real-text output.
  // In privacy mode the private values are covered before the screenshots; the report still comes from the real layout.
  preview(id: string, revision: number, redaction?: Redaction) {
    return this.serialize(async () => {
      const snapshot = await this.readSnapshot(id, revision);
      const result = await this.render(snapshot, 'images', undefined, redaction);
      this.retained.set(id, snapshot);
      return { report: result.report, pages: result.pages! };
    });
  }
  /** Renders the fictitious samples with a theme that is not installed, so its author can see it and catch pagination problems. */
  checkTheme(theme: ThemePackage, images: boolean): Promise<ThemeCheckResult[]> {
    return this.serialize(async () => {
      const results: ThemeCheckResult[] = [];
      for (const sample of themeSamples(theme.manifest)) {
        const result = await this.render(sample.document, images ? 'images' : undefined, theme);
        results.push({
          sample: sample.id,
          name: sample.name,
          maxPages: sample.maxPages,
          report: result.report,
          ...(result.pages ? { pages: result.pages } : {}),
        });
      }
      return results;
    });
  }
  private async render(
    snapshot: ResumeDocument,
    output?: 'pdf' | 'images',
    draft?: ThemePackage,
    redaction?: Redaction,
  ): Promise<{ report: LayoutReport; pdf?: Buffer; pages?: string[] }> {
    this.browser ??= launchChromium()
      .then(({ browser }) => browser)
      .catch((error) => {
        this.browser = undefined;
        throw new ResumeError(
          'RENDER_TIMEOUT',
          `Chromium 无法启动：${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
        );
      });
    const browser = await this.browser;
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      locale: 'zh-CN',
      ...(output === 'images' ? { deviceScaleFactor: 1.5 } : {}),
    });
    const key = randomUUID();
    const theme = draft ?? this.themes?.get(snapshot.appearance.themeId); // Laid out with the real private values (privacy mode keeps placeholders in storage); only the report and covered images leave.
    this.jobs.set(key, { document: this.service.renderable(structuredClone(snapshot)), ...(theme ? { theme } : {}) });
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      void context.close().catch(() => {});
    }, 30000);
    try {
      await context.route('**/*', (route) =>
        new URL(route.request().url()).origin === this.runtime.origin ? route.continue() : route.abort(),
      );
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      page.setDefaultNavigationTimeout(30000);
      // Fail as soon as the page or one of its scripts, styles or fonts cannot load, instead of waiting out the timeout.
      let failLoad: (error: ResumeError) => void = () => {};
      const loadFailure = new Promise<never>((_, reject) => {
        failLoad = reject;
      });
      loadFailure.catch(() => {});
      page.on('response', (response) => {
        if (
          response.status() >= 400 &&
          new URL(response.url()).origin === this.runtime.origin &&
          !/^\/(api\/|favicon\.ico$)/.test(new URL(response.url()).pathname)
        )
          failLoad(
            new ResumeError(
              'STORAGE_FAILED',
              `渲染页面资源加载失败（HTTP ${response.status()} ${new URL(response.url()).pathname}）`,
            ),
          );
      });
      page.on('requestfailed', (request) => {
        if (new URL(request.url()).origin === this.runtime.origin && new URL(request.url()).pathname !== '/favicon.ico')
          failLoad(
            new ResumeError(
              'STORAGE_FAILED',
              `渲染页面资源加载失败（${new URL(request.url()).pathname}：${request.failure()?.errorText ?? '未知错误'}）`,
            ),
          );
      });
      const navigation = await Promise.race([page.goto(`${this.runtime.origin}/render?job=${key}`), loadFailure]);
      if (navigation && !navigation.ok())
        throw new ResumeError('STORAGE_FAILED', `渲染页面无法打开（HTTP ${navigation.status()}）`);
      await Promise.race([
        page.waitForFunction(
          () => document.querySelector('[data-render-ready="true"]') || document.querySelector('[data-render-error]'),
        ),
        loadFailure,
      ]);
      const error = (await page.locator('[data-render-error]').count())
        ? await page.locator('[data-render-error]').getAttribute('data-render-error')
        : null;
      if (error) throw new ResumeError('VALIDATION_FAILED', `渲染失败: ${error}`);
      const report = JSON.parse((await page.locator('[data-render-report]').textContent()) ?? '') as LayoutReport;
      if (report.id !== snapshot.id || report.revision !== snapshot.revision)
        throw new ResumeError('SNAPSHOT_UNAVAILABLE', 'Renderer 版本不一致');
      await page.emulateMedia({ media: 'print' });
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      });
      const printState = await page.evaluate(() => {
        const pages = Array.from(document.querySelectorAll<HTMLElement>('[data-page-inner]'));
        return {
          count: pages.length,
          overflow: pages.flatMap((page, index) =>
            page.scrollHeight > page.clientHeight + 2 || page.scrollWidth > page.clientWidth + 2 ? [index + 1] : [],
          ),
        };
      });
      if (printState.count !== report.pageCount) throw new ResumeError('SNAPSHOT_UNAVAILABLE', '打印分页与预览不一致');
      for (const page of printState.overflow)
        if (!report.issues.some((issue) => issue.code === 'overflow' && issue.page === page))
          report.issues.push({ code: 'overflow', page, message: `第 ${page} 页打印内容溢出` });
      report.layoutValid = report.issues.length === 0;
      if (output === 'pdf')
        return { report, pdf: await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true }) };
      if (output === 'images') {
        if (redaction) await page.evaluate(coverPrivate, coverTargets(redaction));
        const pages: string[] = [];
        for (const element of await page.locator('article[data-a4-page]').all())
          pages.push(
            (await element.screenshot({ type: 'jpeg', quality: 82, animations: 'disabled' })).toString('base64'),
          );
        if (pages.length !== report.pageCount)
          throw new ResumeError('SNAPSHOT_UNAVAILABLE', '预览图片页数与排版报告不一致');
        return { report, pages };
      }
      return { report };
    } catch (error) {
      if (timedOut || (error instanceof Error && error.name === 'TimeoutError'))
        throw new ResumeError('RENDER_TIMEOUT', '排版等待超过 30 秒');
      throw error;
    } finally {
      clearTimeout(deadline);
      this.jobs.delete(key);
      await context.close();
    }
  }
  async close() {
    this.beginShutdown();
    await this.queue.catch(() => {});
    if (this.browser) await (await this.browser).close();
  }
}

const contact = (kind: string) => `.rs-contact[data-kind="${kind}"] .rs-contact-value`;
const detail = (kind: string) => `.rs-detail[data-kind="${kind}"] .rs-detail-value`;
/** Where each private field shows on a page; values that also turn up in other text are found by pattern. */
const privateSelectors: Record<Redaction['fields'][number], string> = {
  name: '.rs-name',
  photo: '.rs-photo',
  phone: contact('phone'),
  email: contact('email'),
  location: contact('location'),
  links: contact('link'),
  birthDate: detail('birthDate'),
  hometown: detail('hometown'),
  politicalStatus: detail('politicalStatus'),
};
export const coverTargets = (redaction: Redaction) => ({
  selectors: redaction.fields.map((field) => ({
    selector: privateSelectors[field],
    label: privateDisplayNames[field],
  })),
  patterns: redaction.patterns.map(({ pattern, field }) => ({ pattern, label: privateDisplayNames[field] })),
});

/**
 * Runs in the render page: covers every private value on each A4 page with a label naming the field (手机号, 邮箱),
 * as the web page shows them. A piece too small to hold its label is covered plain.
 */
export function coverPrivate({
  selectors,
  patterns,
}: {
  selectors: Array<{ selector: string; label: string }>;
  patterns: Array<{ pattern: string; label: string }>;
}) {
  for (const article of Array.from(document.querySelectorAll<HTMLElement>('article[data-a4-page]'))) {
    const box = article.getBoundingClientRect();
    const scale = box.width / (article.offsetWidth || box.width) || 1;
    const covers: Array<{ rect: DOMRect; label: string }> = [];
    const add = (rects: Iterable<DOMRect>, label: string) => {
      for (const rect of rects) if (rect.width && rect.height) covers.push({ rect, label });
    };
    // Text is covered where it is drawn, not across its whole (possibly full-width) box; a photo has no text.
    for (const { selector, label } of selectors)
      for (const element of Array.from(article.querySelectorAll(selector))) {
        const range = document.createRange();
        range.selectNodeContents(element);
        add(
          element.textContent?.trim() ? Array.from(range.getClientRects()) : Array.from(element.getClientRects()),
          label,
        );
      }
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      for (const { pattern, label } of patterns)
        for (const match of text.matchAll(new RegExp(pattern, 'gi'))) {
          if (!match[0]) continue;
          const range = document.createRange();
          range.setStart(node, match.index!);
          range.setEnd(node, match.index! + match[0].length);
          add(Array.from(range.getClientRects()), label);
        }
    }
    // A value found both in its own field and by pattern is covered once.
    const inside = (a: DOMRect, b: DOMRect) =>
      b.left <= a.left + 0.5 && b.top <= a.top + 0.5 && b.right >= a.right - 0.5 && b.bottom >= a.bottom - 0.5;
    const kept = covers.filter(
      (cover, index) =>
        !covers.some(
          (other, otherIndex) =>
            otherIndex !== index &&
            inside(cover.rect, other.rect) &&
            (!inside(other.rect, cover.rect) || otherIndex < index),
        ),
    );
    if (kept.length && getComputedStyle(article).position === 'static') article.style.position = 'relative';
    for (const { rect, label } of kept) {
      const width = rect.width / scale + 2,
        height = rect.height / scale + 2,
        size = Math.min(13, Math.max(7, height * 0.6));
      const cover = document.createElement('div');
      cover.setAttribute('data-private-cover', '');
      if (width >= size * 1.6) cover.textContent = label;
      Object.assign(cover.style, {
        position: 'absolute',
        left: `${(rect.left - box.left) / scale - article.clientLeft - 1}px`,
        top: `${(rect.top - box.top) / scale - article.clientTop - 1}px`,
        width: `${width}px`,
        height: `${height}px`,
        background: '#eceef1',
        color: '#8b929c',
        font: `${size}px/${height}px system-ui, sans-serif`,
        textAlign: 'center',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        borderRadius: '2px',
        zIndex: '2147483647',
        pointerEvents: 'none',
      });
      article.appendChild(cover);
    }
  }
}
