import { demoResume } from './demo-resume';
import { createId } from './ids';
import type {
  Appearance,
  Density,
  LayoutSettings,
  ResumeData,
  ResumeRecord,
  ResumeSection,
  SectionType,
} from './types';

export const densityDefaults: Record<
  Density,
  Pick<LayoutSettings, 'pageMarginMm' | 'baseFontPt' | 'lineHeight' | 'sectionSpacingPt'>
> = {
  comfortable: { pageMarginMm: 18, baseFontPt: 10.5, lineHeight: 1.55, sectionSpacingPt: 11 },
  balanced: { pageMarginMm: 15, baseFontPt: 9.8, lineHeight: 1.45, sectionSpacingPt: 8 },
  dense: { pageMarginMm: 11, baseFontPt: 9.1, lineHeight: 1.36, sectionSpacingPt: 6 },
};

/** Allowed range for each spacing control; validation, the editor and agents all read this. */
export const layoutRanges = {
  pageMarginMm: { min: 9, max: 24, unit: 'mm', label: '页边距' },
  baseFontPt: { min: 9, max: 12, unit: 'pt', label: '正文字号' },
  lineHeight: { min: 1.3, max: 1.7, unit: '倍', label: '行高' },
  sectionSpacingPt: { min: 4, max: 16, unit: 'pt', label: '栏目间距' },
} as const;
export type SpacingKey = keyof typeof layoutRanges;

export const baseAppearance: Appearance = {
  themeId: 'standard',
  density: 'balanced',
  preset: 'navy',
  layout: { ...densityDefaults.balanced, accentColor: '#274472', photoEnabled: false },
};

export function createResumeRecord(name = '我的简历'): ResumeRecord {
  const now = Date.now();
  return {
    id: createId('resume'),
    name,
    createdAt: now,
    updatedAt: now,
    data: blankResumeData(),
    appearance: structuredClone(baseAppearance),
  };
}

const blankSections: Array<[SectionType, string]> = [
  ['summary', '个人简介'],
  ['experience', '工作经历'],
  ['projects', '项目经历'],
  ['education', '教育背景'],
  ['skills', '专业技能'],
];
/** What 新建 starts from: the usual sections, nothing filled in. */
export function blankResumeData(): ResumeData {
  return {
    schemaVersion: 1,
    basics: { name: '', headline: '', phone: '', email: '', location: '', links: [] },
    sections: blankSections.map(([type, title]): ResumeSection => ({
      id: type,
      type,
      title,
      visible: true,
      layout: { pageBreakBefore: false },
      entries: [],
      ...(type === 'summary' ? { text: '' } : {}),
    })),
  };
}

export const sampleName = '内容运营';
/**
 * The example's own look: the standard theme a little larger and airier, with clearer entry titles, tuned so the
 * example still fits one A4 page. The CSS is the resume's own stylesheet, so 还原 in 页面与排版 shows the plain theme.
 */
const sampleAppearance: Appearance = {
  ...baseAppearance,
  layout: { ...baseAppearance.layout, baseFontPt: 10.3, lineHeight: 1.5, sectionSpacingPt: 10 },
  // Written for 标准 and kept when the theme changes, so each rule is nested under it: the other themes lay
  // these parts out differently (编辑 puts the skill category in its own column).
  css: [
    '.rs-section-title { padding-bottom: 1pt; }',
    '.rs-section-title h2 { font-size: 15pt; }',
    '.rs-entry-head { padding-top: 6pt; }',
    '.rs-entry-title { font-size: 11.5pt; }',
    '.rs-entry-subtitle { font-size: 9.6pt; }',
    '.rs-entry-meta { font-size: 9.2pt; }',
    '.rs-skill { grid-template-columns: auto 1fr; gap: 10pt; }',
    '.rs-skill-category { text-align: left; }',
  ]
    .map((rule) => `&.rs-theme--standard ${rule}`)
    .join('\n'),
};
/** The built-in example as a new resume; the editor's 使用这份示例 and `lulicv import --sample` both create it from here. */
export function sampleResumeInput(): { name: string; data: ResumeData; appearance: Appearance; sample: true } {
  return {
    name: sampleName,
    data: structuredClone(demoResume),
    appearance: structuredClone(sampleAppearance),
    sample: true,
  };
}
