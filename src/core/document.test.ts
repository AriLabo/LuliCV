import { describe, expect, it } from 'vitest';
import { createResumeRecord, sampleResumeInput } from './defaults';
import { contentWarnings, normalizeDocument, normalizeImport, validateAppearance, validateDocument } from './document';
import type { ResumeData } from './types';
import { validateResumeData } from './validation';

describe('document normalization', () => {
  it('normalizes every import format without changing content', () => {
    const record = createResumeRecord();
    for (const input of [record.data, record, { version: 1, activeId: record.id, resumes: [record] }]) {
      const [document] = normalizeImport(input, () => record);
      expect(document.revision).toBe(1);
      expect(document.data).toEqual(record.data);
      expect(document.appearance).toEqual(record.appearance);
    }
  });
  it('rejects corrupt revision, metadata and appearance', () => {
    const record = createResumeRecord();
    expect(() => normalizeDocument({ ...record, revision: 0 })).toThrow();
    expect(() => normalizeDocument({ ...record, id: '../escape' })).toThrow();
    record.appearance.layout.baseFontPt = 0;
    expect(() => normalizeDocument(record)).toThrow();
  });
  it('allows incomplete drafts but reports warnings and forbids unknown fields', () => {
    const record = createResumeRecord();
    record.data.basics.name = '';
    expect(validateDocument(normalizeDocument(record)).warnings).toContain('姓名未填写');
    expect(() => normalizeDocument({ ...record, data: { ...record.data, extra: true } })).toThrow();
  });
  it('lists a blank resume’s sections as still to be filled in, with where each one is', () => {
    const record = createResumeRecord();
    record.data.sections[4].visible = false;
    const warnings = validateDocument(normalizeDocument(record)).warnings;
    expect(warnings.filter((warning) => warning.includes('没有内容'))).toEqual([
      '“个人简介”没有内容 [sections[0]]',
      '“工作经历”没有内容 [sections[1]]',
      '“项目经历”没有内容 [sections[2]]',
      '“教育背景”没有内容 [sections[3]]',
    ]);
  });
});
it('rejects remote photos to keep rendering local', () => {
  const record = createResumeRecord();
  record.data.basics.photo = 'https://example.com/photo.png';
  expect(() => normalizeDocument(record)).toThrow('本地');
});
it('accepts only bundled fonts and well-formed targets', () => {
  const record = createResumeRecord();
  expect(
    normalizeDocument({
      ...record,
      appearance: { ...record.appearance, layout: { ...record.appearance.layout, fontFamily: 'misans' } },
    }).appearance.layout.fontFamily,
  ).toBe('misans');
  expect(() =>
    normalizeDocument({
      ...record,
      appearance: { ...record.appearance, layout: { ...record.appearance.layout, fontFamily: 'Comic Sans' } },
    }),
  ).toThrow('fontFamily');
  expect(normalizeDocument({ ...record, target: { company: '示例科技' } }).target).toEqual({
    company: '示例科技',
    role: '',
    jd: '',
  });
  expect(() => normalizeDocument({ ...record, target: { company: 1 } })).toThrow('target');
  expect(() => normalizeDocument({ ...record, target: { jd: 'x'.repeat(20001) } })).toThrow('target');
  expect(normalizeDocument(record)).not.toHaveProperty('target');
});
it('names the field in link warnings, accepts bare domains and flags duplicated links', () => {
  const record = createResumeRecord();
  record.data.basics.links = [
    { id: 'link-site', label: '个人网站', url: 'https://example.com/me' },
    { id: 'link-dup', label: '主页', url: 'example.com/me/' },
    { id: 'link-bad', label: '坏链接', url: 'http://' },
  ];
  const warnings = validateDocument(normalizeDocument(record)).warnings;
  expect(warnings.some((warning) => warning.startsWith('basics.links[0]'))).toBe(false);
  expect(warnings).toContain('basics.links[1].url 与 basics.links[0].url 重复，联系方式中会出现两次');
  expect(warnings).toContain('basics.links[2].url 链接格式不完整: http://');
});
it('caps how many contact links there are and how long they get, but not placeholders', () => {
  const errorsFor = (basics: Partial<ResumeData['basics']>) => {
    const data = createResumeRecord().data;
    Object.assign(data.basics, basics);
    return validateResumeData(data);
  };
  const link = (id: string, label = '主页', url = 'https://example.com') => ({ id, label, url });
  const url = (length: number) => `https://example.com/${'a'.repeat(length - 20)}`;
  expect(errorsFor({ links: ['a', 'b', 'c', 'd'].map((id) => link(`link-${id}`)) })).toContain(
    'basics.links 最多 3 个',
  );
  expect(errorsFor({ links: [link('link-a', '一'.repeat(31))] })).toContain('basics.links[0].label 最多 30 个字');
  expect(errorsFor({ links: [link('link-a', 'GitHub', url(501))] })).toContain('basics.links[0].url 最多 500 个字符');
  expect(errorsFor({ links: [{ ...link('link-a'), show: 'name' as never }] })).toContain(
    'basics.links[0].show 只能是 url、label、both',
  );
  expect(errorsFor({ links: [{ ...link('link-a'), icon: 'xhs' as never }] })).toContain(
    'basics.links[0].icon 只能是 none、link、globe、xiaohongshu、douyin、bilibili、weibo、zhihu、wechat、github、linkedin；不写就按网址自动选',
  );
  expect(errorsFor({ links: [{ ...link('link-a'), icon: 'xiaohongshu' }] })).toEqual([]);
  expect(
    validateResumeData({
      ...createResumeRecord().data,
      basics: { ...createResumeRecord().data.basics, website: 'https://example.com' },
    }),
  ).toContain('basics.website 不是可用的基本信息字段');
  // Labels count characters, not bytes; a placeholder stands for a value already checked when it was filled.
  const id = `link-${'b'.repeat(60)}`;
  expect(
    errorsFor({
      links: [
        link('link-a', '一'.repeat(30), url(500)),
        link(id, 'GitHub', `{{private:link:${id}}}`),
        { ...link('link-wx', '微信 linxia-demo', ''), show: 'label' },
      ],
    }),
  ).toEqual([]);
});
it('validates target and tree fields', () => {
  const record = createResumeRecord();
  const target = { company: '示例科技', role: '后端', jd: '' };
  expect(normalizeDocument({ ...record, target }).target).toEqual(target);
  expect(() => normalizeDocument({ ...record, target: { ...target, appliedAt: 1791400000000 } })).toThrow(
    'target 只允许',
  );
  expect(() => normalizeDocument({ ...record, parentId: record.id })).toThrow('parentId');
  expect(() => normalizeDocument({ ...record, purpose: 'x'.repeat(201) })).toThrow('purpose');
  expect(normalizeDocument({ ...record, purpose: '   ' })).not.toHaveProperty('purpose');
});
it('accepts a resume stylesheet only when it is safe, and leaves its warnings out of the content hints', () => {
  const record = createResumeRecord();
  const withCss = (css: unknown) => ({ ...record.appearance, css }) as never;
  expect(validateAppearance(withCss('.rs-contact { flex-shrink: 0; }'))).toEqual([]);
  expect(validateAppearance(withCss('  '))).toEqual(['appearance.css 必须是 CSS 文本；不要自定义样式时删掉这一项']);
  expect(validateAppearance(withCss(1))).toEqual(['appearance.css 必须是 CSS 文本；不要自定义样式时删掉这一项']);
  expect(validateAppearance(withCss('.rs-name { background: url(https://example.com/a.png) }'))).toEqual([
    expect.stringContaining('https://example.com'),
  ]);
  expect(() => normalizeDocument({ ...record, appearance: withCss('@import "x.css";') })).toThrow('@import');
  const document = normalizeDocument({ ...record, appearance: withCss('.rs-titel { margin: 0; }') });
  expect(document.appearance.css).toBe('.rs-titel { margin: 0; }');
  expect(validateDocument(document).warnings).toContain('appearance.css：.rs-titel 不是骨架里的类名，这条规则不会生效');
  expect(contentWarnings(document)).toEqual(validateDocument(normalizeDocument(record)).warnings);
});
it('keeps a sample mark only as true', () => {
  const record = createResumeRecord();
  expect(normalizeDocument({ ...record, sample: true }).sample).toBe(true);
  expect(normalizeDocument({ ...record, sample: false } as never)).not.toHaveProperty('sample');
  expect(() => normalizeDocument({ ...record, sample: 'yes' } as never)).toThrow('sample');
});

it('ships a built-in example that passes the same checks as imported content', () => {
  const { data } = sampleResumeInput();
  expect(validateResumeData(data)).toEqual([]);
  expect(contentWarnings(normalizeDocument({ ...createResumeRecord(), data }))).toEqual([]);
});
