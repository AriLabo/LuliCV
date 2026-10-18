import { cloneSample } from './fixtures';
import { createId } from './ids';
import type { Appearance, Density, LayoutSettings, ResumeRecord } from './types';

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
    data: cloneSample(),
    appearance: structuredClone(baseAppearance),
  };
}
