import type { LayoutIssue } from './types';

export function inspectLayout(container: HTMLElement, expectedBlockCount: number, baseFontPt: number): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const pages = Array.from(container.querySelectorAll<HTMLElement>('[data-a4-page]'));
  let renderedBlocks = 0;
  pages.forEach((page, index) => {
    const inner = page.querySelector<HTMLElement>('[data-page-inner]');
    const blocks = Array.from(page.querySelectorAll<HTMLElement>('[data-block-id]'));
    renderedBlocks += blocks.length;
    if (!blocks.length && index > 0)
      issues.push({ code: 'blank-page', page: index + 1, message: `第 ${index + 1} 页为空白页` });
    if (inner && (inner.scrollHeight > inner.clientHeight + 2 || inner.scrollWidth > inner.clientWidth + 2))
      issues.push({ code: 'overflow', page: index + 1, message: `第 ${index + 1} 页内容超出 A4 可用区域` });
    const last = blocks.at(-1);
    if (last && ['section-title', 'entry-header'].includes(last.dataset.blockKind ?? ''))
      issues.push({ code: 'orphan-heading', page: index + 1, message: `第 ${index + 1} 页底部存在孤立标题` });
  });
  if (renderedBlocks !== expectedBlockCount)
    issues.push({ code: 'missing-content', message: '预览中的内容块数量与数据不一致' });
  if (baseFontPt < 9) issues.push({ code: 'too-small-font', message: '正文字号低于 9pt 的可读下限' });
  return issues;
}

export function measurePageFill(container: HTMLElement): number[] {
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
