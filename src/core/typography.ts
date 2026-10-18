import type { ResumeData, ResumeSection } from './types';
import { entryTitle } from './entries';

// Checks for Chinese punctuation and formatting conventions. They never block a write. Only clear
// mistakes are flagged one by one; choices of style (half- or full-width brackets, quote marks, date
// format) are flagged only when one resume mixes them, so a consistent personal style is left alone.
// A single dash between Chinese words is the standard connector (GB/T 15834) and is not flagged.

const han = '\\u3400-\\u4dbf\\u4e00-\\u9fff';
const mistakes: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: new RegExp(`[${han}][,;:!?]\\s*[${han}]`),
    message: '中文句子中间用了半角标点，建议改为全角（，；：！？）',
  },
  { pattern: /[０-９Ａ-Ｚａ-ｚ]/, message: '有全角字母或数字，建议改为半角' },
  { pattern: /([，。、；：！？])\1/, message: '标点重复' },
];
// Each style pair: the same job done two ways. Mixing them within one resume is what gets reported.
const styles: Array<{ name: string; variants: Array<{ label: string; pattern: RegExp }> }> = [
  {
    name: '中文括号',
    variants: [
      { label: '全角（）', pattern: new RegExp(`（[^（）]*[${han}][^（）]*）`, 'g') },
      { label: '半角()', pattern: new RegExp(`\\([^()]*[${han}][^()]*\\)`, 'g') },
    ],
  },
  {
    name: '中文引号',
    variants: [
      { label: '“”', pattern: new RegExp(`“[^“”]*[${han}][^“”]*”`, 'g') },
      { label: '""', pattern: new RegExp(`"[^"]*[${han}][^"]*"`, 'g') },
    ],
  },
];

const fieldNames: Record<string, string> = {
  headline: '目标职位',
  company: '公司',
  role: '职位',
  description: '说明',
  name: '名称',
  subtitle: '副标题',
  school: '学校',
  degree: '学位',
  major: '专业',
  additional: '补充文字',
  title: '标题',
  category: '分类',
};

function excerpt(text: string, index: number) {
  const start = Math.max(0, index - 8),
    end = Math.min(text.length, index + 10);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

/** Every text field a resume renders, with a readable place and its data path. */
function textFields(data: ResumeData): Array<{ place: string; path: string; text: string }> {
  const fields = [{ place: '基本信息 · 目标职位', path: 'basics.headline', text: data.basics.headline }];
  data.sections.forEach((section: ResumeSection, sectionIndex) => {
    if (!section.visible) return;
    const sectionPath = `sections[${sectionIndex}]`;
    if (section.text) fields.push({ place: `「${section.title}」`, path: `${sectionPath}.text`, text: section.text });
    section.entries.forEach((entry, entryIndex) => {
      const entryPath = `${sectionPath}.entries[${entryIndex}]`;
      const place = `「${section.title}」 · ${entryTitle(entry) || '未命名条目'}`;
      for (const [key, value] of Object.entries(entry)) {
        if (typeof value === 'string' && key in fieldNames)
          fields.push({ place: `${place} · ${fieldNames[key]}`, path: `${entryPath}.${key}`, text: value });
      }
      if ('bullets' in entry)
        entry.bullets.forEach((bullet, index) =>
          fields.push({
            place: `${place} · 第 ${index + 1} 条要点`,
            path: `${entryPath}.bullets[${index}]`,
            text: bullet,
          }),
        );
      if ('items' in entry)
        entry.items.forEach((item, index) =>
          fields.push({ place: `${place} · 技能项 ${index + 1}`, path: `${entryPath}.items[${index}]`, text: item }),
        );
    });
  });
  return fields;
}

function dateStyle(text: string) {
  if (/^\d{4}年/.test(text)) return '2021年4月';
  const separator = /^\d{4}([./-])\d/.exec(text)?.[1];
  return separator ? `2021${separator}04` : undefined;
}

export function chineseTypographyWarnings(data: ResumeData): string[] {
  const warnings: string[] = [];
  const fields = textFields(data);
  for (const { place, path, text } of fields) {
    for (const { pattern, message } of mistakes) {
      const match = pattern.exec(text);
      if (match) warnings.push(`${place}：${message}「${excerpt(text, match.index)}」[${path}]`);
    }
  }
  for (const { name, variants } of styles) {
    const found = variants.map(({ label, pattern }) => ({
      label,
      places: fields.flatMap(({ place, path, text }) =>
        [...text.matchAll(pattern)].map((match) => `${place}「${excerpt(text, match.index ?? 0)}」[${path}]`),
      ),
    }));
    if (found.every(({ places }) => places.length)) {
      // Point at the less used style; the more common one is taken as the person's choice.
      const [minority, majority] = [...found].sort((a, b) => a.places.length - b.places.length);
      warnings.push(
        `${name}写法不统一：多数用${majority.label}，${minority.places.length} 处用了${minority.label}：${minority.places.slice(0, 3).join('；')}${minority.places.length > 3 ? ' 等' : ''}`,
      );
    }
  }
  const dates = new Set<string>();
  for (const section of data.sections)
    if (section.visible)
      for (const entry of section.entries) {
        for (const value of [
          'startDate' in entry ? entry.startDate : '',
          'endDate' in entry ? entry.endDate : '',
          'date' in entry ? entry.date : '',
        ]) {
          for (const part of value.split(/\s*[—–~至]\s*|\s+-\s+/)) {
            const style = dateStyle(part.trim());
            if (style) dates.add(style);
          }
        }
      }
  if (dates.size > 1) warnings.push(`日期写法不统一：${[...dates].join('、')}，建议统一为一种`);
  return warnings;
}
