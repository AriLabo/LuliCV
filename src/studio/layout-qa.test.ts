import { describe, expect, it } from 'vitest';
import { cloneSample } from '../core/fixtures';
import { buildBlocks } from '../themes/skeleton';
import { strandedHeadings } from './layout-qa';

/** The sample's blocks laid out on two pages, the first ending with the given block. */
function splitAfter(blocks: ReturnType<typeof buildBlocks>, lastOnFirstPage: string): string[][] {
  const ids = blocks.map((block) => block.id);
  const cut = ids.indexOf(lastOnFirstPage) + 1;
  expect(cut).toBeGreaterThan(0);
  return [ids.slice(0, cut), ids.slice(cut)];
}

describe('strandedHeadings', () => {
  const data = cloneSample();
  data.sections.push(
    data.sections.splice(
      data.sections.findIndex((section) => section.id === 'education'),
      1,
    )[0],
  );
  const blocks = buildBlocks(data);

  it('accepts an entry with nothing under its header at the end of a page or of the resume', () => {
    // The sample's education entry is a header alone, as degrees often are.
    expect(splitAfter(blocks, 'education-1-head')).toEqual([expect.any(Array), []]);
    expect(strandedHeadings(splitAfter(blocks, 'education-1-head'), blocks)).toEqual([]);
    const ids = blocks.map((block) => block.id);
    expect(strandedHeadings([ids], blocks)).toEqual([]);
  });

  it('reports a heading whose content starts on the next page', () => {
    expect(strandedHeadings(splitAfter(blocks, 'education-title'), blocks)).toEqual([
      expect.objectContaining({ code: 'orphan-heading', page: 1, message: expect.stringContaining('栏目标题') }),
    ]);
    const header = blocks.find((block) => block.kind === 'entry-header' && block.keepWithNext)!;
    expect(strandedHeadings(splitAfter(blocks, header.id), blocks)).toEqual([
      expect.objectContaining({ code: 'orphan-heading', page: 1, message: expect.stringContaining('条目标题和正文') }),
    ]);
  });
});
