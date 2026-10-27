import type { ThemeBlock } from './types';

export interface MeasuredBlock {
  id: string;
  height: number;
  keepWithNext?: boolean;
  groupId?: string;
  breakBefore?: boolean;
  continuationHeight?: number;
}

export interface PageAllocation {
  blockIds: string[];
  continuationBlockId?: string;
}

/** A last page holding less than this share of a page is overflow to take back, not a page of its own. */
export const SPARSE_LAST_PAGE = 0.3;

export interface PageLayout {
  pages: PageAllocation[];
  /** Three or more pages that spread their spare height between blocks (page-wrap--balanced-flow). */
  spread: boolean;
}

/*
 * Breaking rules for every entry, the same for the whole document: a group (an entry, or the rows of a skills
 * section) never leaves its first or last content block alone on a page. The entry header already travels with
 * the first block; tying the first content block to the second and the second-to-last to the last means a split
 * puts at least two blocks on each side, so a short entry stays on one page whenever it fits. A tie that would make
 * a run taller than a page is dropped again: that run has to break somewhere, and the theme's own ties still hold.
 */
function withGroupRules(blocks: MeasuredBlock[], pageCapacity: number): MeasuredBlock[] {
  const ruled = blocks.map((block) => ({ ...block }));
  let start = 0;
  while (start < ruled.length) {
    const groupId = ruled[start].groupId;
    let end = start + 1;
    if (groupId) while (end < ruled.length && ruled[end].groupId === groupId) end += 1;
    if (end - start >= 3) {
      const tied = new Set<MeasuredBlock>();
      const lead = ruled.slice(start, end - 1).find((block) => !block.keepWithNext);
      if (lead) tied.add(lead);
      if (!ruled[end - 2].keepWithNext) tied.add(ruled[end - 2]);
      tied.forEach((block) => {
        block.keepWithNext = true;
      });
      for (let run = start; run < end;) {
        let next = run + 1;
        while (next < end && ruled[next - 1].keepWithNext) next += 1;
        const members = ruled.slice(run, next);
        if (members.reduce((sum, block) => sum + block.height, 0) > pageCapacity)
          members.forEach((block) => {
            if (tied.has(block)) block.keepWithNext = false;
          });
        run = next;
      }
    }
    start = end;
  }
  return ruled;
}

function bundleEnd(blocks: MeasuredBlock[], start: number): number {
  let end = start + 1;
  while (end < blocks.length && blocks[end - 1].keepWithNext) end += 1;
  return end;
}

function balanceAllocations(
  blocks: MeasuredBlock[],
  greedy: PageAllocation[],
  firstCapacity: number,
  pageCapacity: number,
): PageAllocation[] {
  const pageCount = greedy.length;
  if (pageCount < 3 || blocks.some((block) => block.breakBefore)) return greedy;

  const capacities = Array.from({ length: pageCount }, (_, index) => (index === 0 ? firstCapacity : pageCapacity));
  const prefix = [0];
  blocks.forEach((block) => prefix.push(prefix.at(-1)! + block.height));
  const totalCapacity = capacities.reduce((sum, capacity) => sum + capacity, 0);
  const targetRatio = Math.min(0.84, prefix.at(-1)! / totalCapacity);

  const startsWithContinuation = (start: number) =>
    start > 0 && blocks[start].groupId && blocks[start].groupId === blocks[start - 1].groupId;
  const segmentHeight = (start: number, end: number) =>
    prefix[end] - prefix[start] + (startsWithContinuation(start) ? (blocks[start].continuationHeight ?? 0) : 0);
  const validBoundary = (start: number) => start <= 0 || !blocks[start - 1].keepWithNext;
  const pageScore = (start: number, end: number, pageIndex: number) => {
    const ratio = segmentHeight(start, end) / capacities[pageIndex];
    let score = (ratio - targetRatio) ** 2;
    if (ratio < 0.58) score += (0.58 - ratio) * 4;
    if (ratio > 0.96) score += (ratio - 0.96) * 2;
    if (startsWithContinuation(start)) score += 0.012;
    return score;
  };

  const scores = Array.from({ length: pageCount + 1 }, () => Array(blocks.length + 1).fill(Infinity));
  const previous = Array.from({ length: pageCount + 1 }, () => Array(blocks.length + 1).fill(-1));
  scores[0][0] = 0;
  for (let usedPages = 1; usedPages <= pageCount; usedPages += 1) {
    const minEnd = usedPages;
    const maxEnd = blocks.length - (pageCount - usedPages);
    for (let end = minEnd; end <= maxEnd; end += 1) {
      for (let start = usedPages - 1; start < end; start += 1) {
        if (!Number.isFinite(scores[usedPages - 1][start]) || !validBoundary(start)) continue;
        if (segmentHeight(start, end) > capacities[usedPages - 1]) continue;
        const score = scores[usedPages - 1][start] + pageScore(start, end, usedPages - 1);
        if (score < scores[usedPages][end]) {
          scores[usedPages][end] = score;
          previous[usedPages][end] = start;
        }
      }
    }
  }
  if (!Number.isFinite(scores[pageCount][blocks.length])) return greedy;

  const ranges: Array<[number, number]> = [];
  let end = blocks.length;
  for (let usedPages = pageCount; usedPages > 0; usedPages -= 1) {
    const start = previous[usedPages][end];
    if (start < 0) return greedy;
    ranges.unshift([start, end]);
    end = start;
  }
  return ranges.map(([start, rangeEnd]) => ({
    blockIds: blocks.slice(start, rangeEnd).map((block) => block.id),
    continuationBlockId:
      startsWithContinuation(start) && blocks[start].continuationHeight ? blocks[start].id : undefined,
  }));
}

function lastPageShare(blocks: MeasuredBlock[], pages: PageAllocation[], pageCapacity: number): number {
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const last = pages.at(-1)!;
  const continuation = last.continuationBlockId ? (byId.get(last.continuationBlockId)?.continuationHeight ?? 0) : 0;
  return last.blockIds.reduce((sum, id) => sum + (byId.get(id)?.height ?? 0), continuation) / pageCapacity;
}

export function layoutPages(measured: MeasuredBlock[], firstCapacity: number, pageCapacity: number): PageLayout {
  if (!measured.length) return { pages: [{ blockIds: [] }], spread: false };
  const blocks = withGroupRules(measured, pageCapacity);
  const pages: PageAllocation[] = [{ blockIds: [] }];
  let pageIndex = 0;
  let remaining = Math.max(1, firstCapacity);
  let index = 0;

  const newPage = (continuationBlock?: MeasuredBlock, previousBlock?: MeasuredBlock) => {
    const continuesGroup = continuationBlock?.groupId && continuationBlock.groupId === previousBlock?.groupId;
    pages.push({
      blockIds: [],
      continuationBlockId: continuesGroup && continuationBlock.continuationHeight ? continuationBlock.id : undefined,
    });
    pageIndex += 1;
    remaining = pageCapacity - (continuesGroup ? (continuationBlock?.continuationHeight ?? 0) : 0);
  };

  while (index < blocks.length) {
    const block = blocks[index];
    if (block.breakBefore && pages[pageIndex].blockIds.length) newPage(block, blocks[index - 1]);
    const end = bundleEnd(blocks, index);
    const bundleHeight = blocks.slice(index, end).reduce((sum, item) => sum + item.height, 0);
    if (bundleHeight <= pageCapacity && bundleHeight > remaining && pages[pageIndex].blockIds.length)
      newPage(block, blocks[index - 1]);

    if (bundleHeight <= pageCapacity) {
      for (let cursor = index; cursor < end; cursor += 1) pages[pageIndex].blockIds.push(blocks[cursor].id);
      remaining -= bundleHeight;
      index = end;
      continue;
    }

    if (block.height > remaining && pages[pageIndex].blockIds.length) newPage(block, blocks[index - 1]);
    pages[pageIndex].blockIds.push(block.id);
    remaining -= block.height;
    index += 1;
  }
  const compactPages = pages.filter((page, indexOfPage) => page.blockIds.length > 0 || indexOfPage === 0);
  /*
   * A few lines past the last full page stay a short last page. Balancing and spreading would loosen every page over
   * one line of overflow, and hide the overflow that a little tightening takes back.
   */
  if (compactPages.length < 3 || lastPageShare(blocks, compactPages, pageCapacity) < SPARSE_LAST_PAGE)
    return { pages: compactPages, spread: false };
  return { pages: balanceAllocations(blocks, compactPages, firstCapacity, pageCapacity), spread: true };
}

export function allocatePages(
  measured: MeasuredBlock[],
  firstCapacity: number,
  pageCapacity: number,
): PageAllocation[] {
  return layoutPages(measured, firstCapacity, pageCapacity).pages;
}

export function toMeasuredBlocks(
  blocks: ThemeBlock[],
  heights: Map<string, number>,
  continuationHeights = new Map<string, number>(),
): MeasuredBlock[] {
  return blocks.map((block) => ({
    id: block.id,
    height: Math.max(0, heights.get(block.id) ?? 0),
    keepWithNext: block.keepWithNext,
    groupId: block.groupId,
    breakBefore: block.breakBefore,
    continuationHeight: Math.max(0, continuationHeights.get(block.id) ?? 0),
  }));
}
