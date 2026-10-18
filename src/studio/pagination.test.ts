import { describe, expect, it } from 'vitest';
import { allocatePages, type MeasuredBlock } from './pagination';

const block = (id: string, height: number, extra: Partial<MeasuredBlock> = {}): MeasuredBlock => ({
  id,
  height,
  ...extra,
});

describe('allocatePages', () => {
  it('keeps a section heading with its first content block', () => {
    const pages = allocatePages(
      [block('before', 70), block('title', 20, { keepWithNext: true }), block('first', 30)],
      100,
      100,
    );
    expect(pages.map((page) => page.blockIds)).toEqual([['before'], ['title', 'first']]);
  });

  it('honours manual page breaks without creating a blank first page', () => {
    const pages = allocatePages(
      [block('first', 20, { breakBefore: true }), block('second', 20, { breakBefore: true })],
      100,
      100,
    );
    expect(pages.map((page) => page.blockIds)).toEqual([['first'], ['second']]);
  });

  it('keeps a short entry on one page', () => {
    const entry = [
      block('lead', 50),
      block('head', 10, { groupId: 'g', keepWithNext: true }),
      block('a', 15, { groupId: 'g' }),
      block('b', 15, { groupId: 'g' }),
      block('c', 15, { groupId: 'g' }),
    ];
    expect(allocatePages(entry, 100, 100).map((page) => page.blockIds)).toEqual([['lead'], ['head', 'a', 'b', 'c']]);
  });

  it('splits a long entry with at least two blocks on each side', () => {
    const bullets = ['a', 'b', 'c', 'd', 'e'].map((id) => block(id, 15, { groupId: 'g' }));
    // Room for the header and four bullets, but the fifth would be stranded, so the fourth moves with it.
    const pages = allocatePages(
      [block('lead', 30), block('head', 10, { groupId: 'g', keepWithNext: true }), ...bullets],
      100,
      100,
    );
    expect(pages.map((page) => page.blockIds)).toEqual([
      ['lead', 'head', 'a', 'b', 'c'],
      ['d', 'e'],
    ]);
    // Room for the header and one bullet only: the first bullet does not stay behind alone.
    const late = allocatePages(
      [block('lead', 70), block('head', 10, { groupId: 'g', keepWithNext: true }), ...bullets],
      100,
      100,
    );
    expect(late.map((page) => page.blockIds)).toEqual([['lead'], ['head', 'a', 'b', 'c', 'd', 'e']]);
  });

  it('still splits a group taller than a page', () => {
    const large = [
      block('a', 60, { groupId: 'g' }),
      block('b', 60, { groupId: 'g' }),
      block('c', 60, { groupId: 'g' }),
    ];
    expect(allocatePages(large, 100, 100).map((page) => page.blockIds)).toEqual([['a'], ['b'], ['c']]);
  });

  it('does not emit unexpected blank pages', () => {
    const pages = allocatePages([block('huge', 150), block('tail', 20)], 100, 100);
    expect(pages).toEqual([{ blockIds: ['huge'] }, { blockIds: ['tail'] }]);
  });

  it('reserves room for a continuation label when an entry crosses a page', () => {
    const pages = allocatePages(
      [
        block('entry-head', 20, { groupId: 'entry' }),
        block('bullet-1', 60, { groupId: 'entry', continuationHeight: 10 }),
        block('bullet-2', 40, { groupId: 'entry', continuationHeight: 10 }),
      ],
      90,
      100,
    );

    expect(pages).toEqual([
      { blockIds: ['entry-head', 'bullet-1'] },
      { blockIds: ['bullet-2'], continuationBlockId: 'bullet-2' },
    ]);
  });

  it('balances three-page documents instead of leaving a sparse tail page', () => {
    const blocks = Array.from({ length: 12 }, (_, index) => block(`block-${index}`, 20));
    const pages = allocatePages(blocks, 90, 90);
    const heights = pages.map((page) => page.blockIds.length * 20);

    expect(pages).toHaveLength(3);
    expect(heights).toEqual([80, 80, 80]);
  });
});
