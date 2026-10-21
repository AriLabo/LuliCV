import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { sampleResume } from '../studio/fixtures';
import { baseAppearance, blankResumeData } from '../core/defaults';
import { buildBlocks, SkeletonHeader } from './skeleton';

describe('theme block pagination semantics', () => {
  it('provides continuation labels for splittable experience and project content', () => {
    const blocks = buildBlocks(sampleResume);
    const entryContent = blocks.filter(
      (block) => block.groupId?.startsWith('projects:') && block.kind !== 'entry-header',
    );

    expect(entryContent.length).toBeGreaterThan(0);
    expect(entryContent.every((block) => block.continuation)).toBe(true);
  });

  it('prints no heading for a section with nothing in it, an empty summary included', () => {
    const blocks = buildBlocks(blankResumeData());
    expect(blocks).toEqual([]);
  });
});

describe('header details', () => {
  const render = (basics: Partial<typeof sampleResume.basics>) =>
    renderToStaticMarkup(
      <SkeletonHeader
        data={{ ...sampleResume, basics: { ...sampleResume.basics, ...basics } }}
        options={baseAppearance.layout}
      />,
    );

  it('lists the given details in a fixed order, each with its label for the theme to show or hide', () => {
    const html = render({ hometown: '上海', gender: '男', birthDate: '2000.05', politicalStatus: ' ' });
    const kinds = [...html.matchAll(/class="rs-detail" data-kind="([a-zA-Z]+)"/g)].map((match) => match[1]);
    expect(kinds).toEqual(['gender', 'birthDate', 'hometown']);
    expect(html).toContain('<span class="rs-detail-label">籍贯</span><span class="rs-detail-value">上海</span>');
  });
  it('leaves the line out when there are none', () => {
    expect(render({})).not.toContain('rs-details');
  });
});

describe('header links', () => {
  const render = (links: typeof sampleResume.basics.links) =>
    renderToStaticMarkup(
      <SkeletonHeader
        data={{ ...sampleResume, basics: { ...sampleResume.basics, phone: '', email: '', location: '', links } }}
        options={baseAppearance.layout}
      />,
    );
  const values = (html: string) =>
    [...html.matchAll(/<span class="rs-contact-value">(.*?)<\/span>/g)].map((match) =>
      match[1].replace(/<wbr\/>/g, ''),
    );
  const site = { id: 'link-site', label: '小红书 @林夏的耳饰铺', url: 'https://www.xiaohongshu.com/user/profile/demo' };

  it('prints the address, the name or both, as each link chooses', () => {
    const html = render([site, { ...site, id: 'link-b', show: 'label' }, { ...site, id: 'link-c', show: 'both' }]);
    expect(values(html)).toEqual([
      'xiaohongshu.com/user/profile/demo',
      '小红书 @林夏的耳饰铺',
      '小红书 @林夏的耳饰铺 xiaohongshu.com/user/profile/demo',
    ]);
    expect(html.match(/href="https:\/\/www\.xiaohongshu\.com\/user\/profile\/demo"/g)).toHaveLength(3);
  });
  it('prints a name without an address as plain text, and the address when the chosen name is empty', () => {
    const html = render([
      { id: 'link-wx', label: '微信 linxia-demo', url: '', show: 'label' },
      { ...site, id: 'link-b', label: '', show: 'label' },
      { id: 'link-c', label: 'GitHub', url: '' },
    ]);
    expect(values(html)).toEqual(['微信 linxia-demo', 'xiaohongshu.com/user/profile/demo']);
    expect(html).toMatch(/<span class="rs-contact" data-kind="link" data-code="WX">/);
  });
  it('codes each link by its platform or preset and calls every other one LINK', () => {
    const html = render([
      { id: 'a', label: 'GitHub', url: 'github.com/demo' },
      { id: 'b', label: '作品集', url: 'example.com' },
      { id: 'c', label: '耳饰账号', url: 'example.org' },
    ]);
    expect([...html.matchAll(/data-code="([A-Z]+)"/g)].map((match) => match[1])).toEqual(['GIT', 'WORK', 'LINK']);
  });
  it('draws the icon each link chooses or the one its address implies, and none when it chooses none', () => {
    const html = render([site, { id: 'b', label: '个人网站', url: 'example.com' }, { ...site, id: 'c', icon: 'none' }]);
    expect([...html.matchAll(/data-icon="([a-z]+)"/g)].map((match) => match[1])).toEqual(['xiaohongshu', 'globe']);
  });
});
