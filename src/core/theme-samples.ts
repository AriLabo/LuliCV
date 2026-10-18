import { cloneSample } from './fixtures';
import { themeDefaults } from './theme-package';
import type { ThemeManifest } from './theme-types';
import type { ExperienceEntry, ResumeDocument, ResumeData } from './types';

// Fictitious resumes that exercise a theme before it is installed: one page, two pages, a photo
// header and long mixed Chinese/English lines. Everything here is sample data (张三, example.com).

/** A light grey silhouette (PNG), the same placeholder the visual tests use. */
const PHOTO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAACcCAMAAACDb590AAAASFBMVEXr7/Tr7vPq7vPp7vPq7fLp7fLp7fHo7fLp7PHo7PHn7PHl6e/i5+3a3+bR19/Gzti8xdC6ws65ws65wc24wc23wc23wMy2wMxjrbEbAAADzklEQVR42u2b23LjIAyGMWvSGoeDKcHv/6YLJN3tAQfhSE53Fs10pnff/CChk8OmJxnr4A7u4A7u4A7u4A7u4A7u4A7uYDKwnES2+M+hYMHH+ZxMDvx0HJjLs9Y2m9FqjroPAfNJGeuDzxbWxeozF/Tgk1TGBe8Wd7XF+RDRghrM54h1X8x7qxgteFTmGzbZxepZEIK5skVutNW0kZvAQlnvtiyYmQrMz3e4UbNmNGAxm3tc56wSJOBRr3e5LtiGqIKDxf2Dzr6tRwIw15cK1/kGyQxRcJKMDpZchyo3SgYHM1ixNACwWxRHBoNO2i0B7F4Mz7XazhoIloMOyzPA8Yo9RPHbonDBsCuOl7xqLp8CDh38z4JnGDi+1rjgmIwD7AE5Iz8gHPqAIINjnQfhxopPviCDYZcMvmJ4WhwhZ91QgoDBXMFOmqDKhFQC4DqgpdhTAME0nURdMlxwC5irimO3CG7rnVSFO9O0MJXDjs05J1Kc2rZN8qWN26g4kp1fEPQ2jyJOU3Em4FfTOn5pnvrwNPRxy5fZi57HiRg8jVOeN3m3JHM+pGkTfz1isscnpa29rCGk8ZrZNV/bOctMk0ydTc1yD3b/9FYIPnAe//bOb/fPq2W2/2dQ3sEdTAV+X8KkNcxRcSzz43FbwuQ1zK5HpBksbs+lte9rmPRsDryV3QjmPC9+YoLwN7slCjVxwtVATkshp8QPvXhKjatrTVKsCftp8fNpEuCuaZlgXn3N/+5O45b3T9gtzOu14qk1i6kG4pjgcdYWNooIBlhtgsDibFYHmgikxYSaTkjgatP0WbQzkJKzDk6l9MW1WIAU2VVwbh5cm0HaClbnBtdsgEaKUXAhmmuK93EBZPb4qGdfm87w4qiNzKi4tZEIw3cs2BCIETgWyMG2waNyj9q9a2aPLgPuk7c3fptg4E5v9zSX0Xj0n7fTNCt+1LNqns3QnyxgMDNiwZuSGa3gbcllsMQTvCWZkcXwh6UfHKw9nuCNWGbF7GARwa6852RF11ocJtgAj1qgulZ2r18wMO5Jb+yUWfGk31AFewO74xG2sX3Qrxn5ScezLu1YGenr8fcLoDpYxgoA96TLH+J8B6NfcfmSGf0VXxfpdfAZH1yK5EPApWqTFXwLnVvyrgIY3beK3vVjwNBva9DBJNFU+jCFHeHUpXjq4A7u4A4GgtcqeEJvI5IVPkL+lp0Gmuz0o/Px+px8LLA7p+u4Sz6lvH1alQkCQz/TfzCaCnE84HsXqHei8C5f+Ab5kP541QOgP35Bv+TirzYKzjXgjyIKG4Lfx4d1VDvKFrsAAAAASUVORK5CYII=';

export interface ThemeSample {
  id: string;
  name: string;
  maxPages: number;
  document: ResumeDocument;
}

function entry(index: number, bullets: string[]): ExperienceEntry {
  return {
    id: `experience-${index}`,
    company: `示例科技有限公司 ${index}`,
    role: '高级软件工程师',
    location: '上海',
    startDate: `20${10 + index}.03`,
    endDate: `20${11 + index}.02`,
    description: '',
    bullets,
  };
}

function withExperience(data: ResumeData, entries: ExperienceEntry[]): ResumeData {
  return {
    ...data,
    sections: data.sections.map((section) => (section.type === 'experience' ? { ...section, entries } : section)),
  };
}

export function themeSamples(manifest: ThemeManifest): ThemeSample[] {
  const document = (id: string, name: string, data: ResumeData, photoEnabled: boolean): ResumeDocument => ({
    id: `theme-sample-${id}`,
    name,
    createdAt: 0,
    updatedAt: 0,
    documentVersion: 1,
    revision: 1,
    data,
    appearance: {
      themeId: manifest.id,
      density: 'balanced',
      preset: manifest.presets[0].id,
      settings: {},
      layout: { ...themeDefaults(manifest), photoEnabled },
    },
  });
  const sample = cloneSample();
  const twoPage = withExperience(
    sample,
    Array.from({ length: 9 }, (_, index) =>
      entry(index + 1, [
        '负责核心业务平台的架构与交付，持续改善稳定性、性能和开发体验。',
        '推动跨团队协作与工程规范落地，将关键流程的交付周期缩短约 30%。',
        '建立线上问题复盘机制，季度内重复故障数量下降一半。',
      ]),
    ),
  );
  const longText = withExperience(
    {
      ...sample,
      basics: {
        ...sample.basics,
        name: '张三 Zhang San',
        headline: 'Senior Software Engineer · 高级软件工程师 · 分布式系统与 Developer Experience',
        links: [
          { id: 'link-site', label: '个人网站', url: 'https://example.com/portfolio/zhang-san/selected-projects-2024' },
          ...sample.basics.links.filter((link) => link.id !== 'link-site'),
        ],
      },
    },
    [
      entry(1, [
        '主导本地知识工作台的 local-first 架构设计：SQLite 作为唯一事实来源，HTTP 服务负责并发写入（revision + CAS），CLI 与 Web 共享同一套 service 层。',
        '将 Playwright 渲染流水线的 p95 延迟从 4.2s 降到 1.3s，并为 PDF、JPEG 页面预览和 layout report 建立回归基线（visual regression baseline）。',
        'Designed an internationalization layer for zh-CN / en-US with ICU MessageFormat, covering 1,200+ strings and right-to-left fallbacks.',
      ]),
    ],
  );
  return [
    { id: 'short', name: '一页简历', maxPages: 1, document: document('short', '一页简历', sample, false) },
    { id: 'two-page', name: '两页简历', maxPages: 2, document: document('two-page', '两页简历', twoPage, false) },
    {
      id: 'photo',
      name: '带照片',
      maxPages: 1,
      document: document('photo', '带照片', { ...sample, basics: { ...sample.basics, photo: PHOTO } }, true),
    },
    {
      id: 'long-text',
      name: '中英混排长句',
      maxPages: 1,
      document: document('long-text', '中英混排长句', longText, false),
    },
  ];
}
