import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getTheme, useThemeRegistry } from '@/themes/registry';
import { allocatePages, toMeasuredBlocks, type PageAllocation } from './pagination';
import { inspectLayout, measurePageFill } from './layout-qa';
import type { LayoutIssue, ResumeRecord, ThemeBlock } from './types';
import type { ResumeDocument } from '../core/types';
import type { LayoutReport } from '../core/layout';
import { buildBlocks, SkeletonHeader, themeClasses, themeVariables } from '@/themes/skeleton';
import { useAppearanceCss } from '@/themes/appearance-css';
import { PrivateLabels, type PreviewLabel } from './privacy';

interface ResumePreviewProps {
  record: ResumeRecord;
  onIssues: (issues: LayoutIssue[]) => void;
  onReady?: (report: LayoutReport) => void;
  onRenderError?: (message: string) => void;
  onPageFill?: (fill: number[]) => void;
  privacy?: Map<string, PreviewLabel> | null;
}

function Block({ block, measure = false }: { block: ThemeBlock; measure?: boolean }) {
  return (
    <div data-block-id={block.id} data-block-kind={block.kind} className="resume-block">
      {block.node}
      {measure && block.continuation && (
        <div data-continuation-for={block.id} className="resume-continuation-measure">
          {block.continuation}
        </div>
      )}
    </div>
  );
}

export function ResumePreview({
  record,
  onIssues,
  onReady,
  onRenderError,
  onPageFill,
  privacy = null,
}: ResumePreviewProps) {
  // Installed themes can arrive or change after the first render; their CSS changes every block height.
  const themeVersion = useThemeRegistry();
  const theme = getTheme(record.appearance.themeId);
  const rendered = useMemo(
    () => ({
      header: <SkeletonHeader data={record.data} options={record.appearance.layout} />,
      blocks: buildBlocks(record.data),
    }),
    [record.data, record.appearance.layout],
  );
  const rootClass = themeClasses(theme, record.appearance);
  // The measuring page carries the resume's own stylesheet too, so its rules count in the page breaks.
  const custom = useAppearanceCss(record.appearance.css);
  const measureRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<PageAllocation[]>([{ blockIds: rendered.blocks.map((block) => block.id) }]);

  useLayoutEffect(() => {
    const measure = measureRef.current;
    if (!measure) return;
    let cancelled = false;
    const recalculate = () => {
      if (cancelled) return;
      const inner = measure.querySelector<HTMLElement>('[data-measure-inner]');
      const header = measure.querySelector<HTMLElement>('[data-measure-header]');
      if (!inner || !header || !inner.clientWidth || !inner.clientHeight) return;
      const heights = new Map<string, number>();
      measure
        .querySelectorAll<HTMLElement>('[data-block-id]')
        .forEach((element) => heights.set(element.dataset.blockId ?? '', element.getBoundingClientRect().height));
      const continuationHeights = new Map<string, number>();
      measure
        .querySelectorAll<HTMLElement>('[data-continuation-for]')
        .forEach((element) =>
          continuationHeights.set(element.dataset.continuationFor ?? '', element.getBoundingClientRect().height),
        );
      const computed = getComputedStyle(inner);
      const capacity = inner.clientHeight - parseFloat(computed.paddingTop) - parseFloat(computed.paddingBottom);
      const result = allocatePages(
        toMeasuredBlocks(rendered.blocks, heights, continuationHeights),
        capacity - header.getBoundingClientRect().height,
        capacity,
      );
      setPages(result);
    };
    recalculate();
    void document.fonts.ready
      .then(async () => {
        await Promise.all(Array.from(measure.querySelectorAll('img')).map((image) => image.decode()));
        recalculate();
      })
      .catch((error) => {
        if (!cancelled) onRenderError?.(String(error));
      });
    const observer = new ResizeObserver(recalculate);
    observer.observe(measure);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [rendered, themeVersion, privacy, onRenderError]);

  useLayoutEffect(() => {
    let cancelled = false;
    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    void (async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(measureRef.current?.querySelectorAll('img') ?? []).map((image) => image.decode()));
      await nextFrame();
      await nextFrame();
      if (cancelled || !pagesRef.current) return;
      const issues: LayoutIssue[] = inspectLayout(
        pagesRef.current,
        rendered.blocks,
        record.appearance.layout.baseFontPt,
      );
      const pageFill = measurePageFill(pagesRef.current);
      onIssues(issues);
      onPageFill?.(pageFill);
      onReady?.({
        id: record.id,
        revision: (record as ResumeDocument).revision,
        rendererVersion: 'lulicv/0.1.0',
        pageCount: pages.length,
        layoutValid: issues.length === 0,
        issues,
        pageFill,
      });
    })().catch((error) => {
      if (!cancelled) onRenderError?.(String(error));
    });
    return () => {
      cancelled = true;
    };
  }, [pages, onIssues, onReady, onRenderError, onPageFill, record, rendered.blocks]);

  const blockMap = new Map(rendered.blocks.map((block) => [block.id, block]));
  const style = themeVariables(record.appearance.layout);
  // Placeholder labels are sized from the real values' shape, so they change block heights like content does.
  return (
    <PrivateLabels.Provider value={privacy}>
      {custom.style}
      <div
        ref={measureRef}
        className={`resume-measure ${rootClass}`}
        style={style}
        {...custom.scope}
        aria-hidden="true"
      >
        <div className="a4-page">
          <div data-measure-inner className="a4-inner">
            <div data-measure-header className="resume-header-wrap">
              {rendered.header}
            </div>
            {rendered.blocks.map((block) => (
              <Block key={block.id} block={block} measure />
            ))}
          </div>
        </div>
      </div>
      <div ref={pagesRef} className="preview-stack" data-page-count={pages.length}>
        {pages.map((page, pageIndex) => (
          <section
            key={pageIndex}
            className={`page-wrap ${rootClass}${pages.length >= 3 ? ' page-wrap--balanced-flow' : ''}`}
            style={style}
            {...custom.scope}
          >
            <div className="page-label">第 {pageIndex + 1} 页</div>
            <article className="a4-page" data-a4-page={pageIndex + 1}>
              <div className="a4-inner" data-page-inner>
                {pageIndex === 0 && <div className="resume-header-wrap">{rendered.header}</div>}
                {page.continuationBlockId && blockMap.get(page.continuationBlockId)?.continuation && (
                  <div className="resume-continuation">{blockMap.get(page.continuationBlockId)?.continuation}</div>
                )}
                {page.blockIds.map((id) => {
                  const block = blockMap.get(id);
                  return block ? <Block key={id} block={block} /> : null;
                })}
              </div>
            </article>
          </section>
        ))}
      </div>
    </PrivateLabels.Provider>
  );
}
