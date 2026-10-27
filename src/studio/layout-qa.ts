import type { LayoutIssue, ThemeBlock } from './types';

type HeadingBlock = Pick<ThemeBlock, 'id' | 'kind' | 'keepWithNext'>;

/*
 * A heading is stranded only when it ends a page but has to travel with what follows (keepWithNext), so its content
 * starts on the next page. An entry with nothing under its header (a degree line, say) ends with that header by
 * design, wherever it lands. The paginator already keeps headings with their content, so this only happens when the
 * heading and the content tied to it are taller than a page together.
 */
export function strandedHeadings(pages: string[][], blocks: HeadingBlock[]): LayoutIssue[] {
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const issues: LayoutIssue[] = [];
  pages.forEach((ids, index) => {
    const last = byId.get(ids.at(-1) ?? '');
    if (!last?.keepWithNext || index === pages.length - 1) return;
    const what =
      last.kind === 'section-title' ? '栏目标题和它的内容' : last.kind === 'entry-header' ? '条目标题和正文' : '';
    if (!what) return;
    issues.push({
      code: 'orphan-heading',
      page: index + 1,
      message: `第 ${index + 1} 页底部的${what}被分在两页：标题连同紧跟的内容超过一页高，缩短那段内容或拆成几条要点`,
    });
  });
  return issues;
}

export function inspectLayout(container: HTMLElement, blocks: HeadingBlock[], baseFontPt: number): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const pages = Array.from(container.querySelectorAll<HTMLElement>('[data-a4-page]'));
  const pageBlockIds: string[][] = [];
  pages.forEach((page, index) => {
    const inner = page.querySelector<HTMLElement>('[data-page-inner]');
    const ids = Array.from(page.querySelectorAll<HTMLElement>('[data-block-id]')).map(
      (element) => element.dataset.blockId ?? '',
    );
    pageBlockIds.push(ids);
    if (!ids.length && index > 0)
      issues.push({ code: 'blank-page', page: index + 1, message: `第 ${index + 1} 页为空白页` });
    if (inner && (inner.scrollHeight > inner.clientHeight + 2 || inner.scrollWidth > inner.clientWidth + 2))
      issues.push({ code: 'overflow', page: index + 1, message: `第 ${index + 1} 页内容超出 A4 可用区域` });
  });
  issues.push(...strandedHeadings(pageBlockIds, blocks));
  if (pageBlockIds.flat().length !== blocks.length)
    issues.push({ code: 'missing-content', message: '预览中的内容块数量与数据不一致' });
  if (baseFontPt < 9) issues.push({ code: 'too-small-font', message: '正文字号低于 9pt 的可读下限' });
  return issues;
}

/*
 * Fill is the share of a page the content itself takes. Pages that spread their spare height between blocks are
 * measured with the spreading switched off for the moment, so it does not count as content; the class comes back
 * before anything paints.
 */
export function measurePageFill(container: HTMLElement): number[] {
  const spread = Array.from(container.querySelectorAll<HTMLElement>('.page-wrap--balanced-flow'));
  spread.forEach((page) => page.classList.remove('page-wrap--balanced-flow'));
  try {
    return measureNaturalFill(container);
  } finally {
    spread.forEach((page) => page.classList.add('page-wrap--balanced-flow'));
  }
}

function measureNaturalFill(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-page-inner]')).map((inner) => {
    const style = getComputedStyle(inner);
    const top = inner.getBoundingClientRect().top + parseFloat(style.paddingTop);
    const capacity =
      inner.getBoundingClientRect().height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const blocks = inner.querySelectorAll<HTMLElement>('[data-block-id]');
    const last = blocks[blocks.length - 1];
    if (!last || capacity <= 0) return 0;
    return Math.round(Math.min(1, Math.max(0, (last.getBoundingClientRect().bottom - top) / capacity)) * 100) / 100;
  });
}
