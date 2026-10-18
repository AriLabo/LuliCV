import type { ResumeDocument, ResumeEntry, ResumeSection } from './types';
import { DETAIL_FIELDS } from './details';
import { entryTitle } from './entries';

const basicsLabels: Record<string, string> = {
  name: '姓名',
  headline: '目标职位',
  phone: '电话',
  email: '邮箱',
  location: '地点',
  links: '链接',
  photo: '照片',
  ...Object.fromEntries(DETAIL_FIELDS.map((field) => [field.id, field.label])),
};
const fieldLabels: Record<string, string> = {
  company: '公司',
  role: '职位',
  location: '地点',
  startDate: '开始日期',
  endDate: '结束日期',
  description: '说明',
  name: '名称',
  subtitle: '副标题',
  date: '日期',
  link: '链接',
  school: '学校',
  degree: '学位',
  major: '专业',
  additional: '补充文字',
  category: '分类',
  items: '技能项',
  title: '标题',
};
const appearanceLabels: Record<string, string> = {
  themeId: '主题',
  density: '密度',
  layout: '排版',
  css: '自定义样式',
};
const topLabels = {
  name: '简历名称',
  target: '投递目标',
  parentId: '所在位置',
  purpose: '定位',
  source: '来源改动已看过',
} as const;

/** One readable change, with a way to read the value it is about from any version of the resume. */
export interface Change {
  label: string;
  pick: (document: ResumeDocument) => unknown;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const keys = (...values: Array<object | undefined>) => [
  ...new Set(values.flatMap((value) => Object.keys(value ?? {}))),
];
const findSection = (document: ResumeDocument, id: string) =>
  document.data.sections.find((section) => section.id === id);
const findEntry = (document: ResumeDocument, sectionId: string, id: string) =>
  findSection(document, sectionId)?.entries.find((entry) => entry.id === id);
const sectionName = (section: ResumeSection) => `「${section.title}」`;
function entryName(section: ResumeSection, entry: ResumeEntry) {
  const title = entryTitle(entry);
  return title ? `「${title}」` : `第 ${section.entries.indexOf(entry) + 1} 条`;
}
/** Whether the items both versions share appear in a different order. */
function reordered(before: Array<{ id: string }>, after: Array<{ id: string }>) {
  const ids = new Set(after.map((item) => item.id));
  const kept = before.map((item) => item.id).filter((id) => ids.has(id));
  const order = after.map((item) => item.id).filter((id) => kept.includes(id));
  return !same(kept, order);
}

function entryChanges(section: ResumeSection, before: ResumeEntry, after: ResumeEntry): Change[] {
  const label = `${sectionName(section)} · ${entryName(section, after)}`;
  const pick = (document: ResumeDocument) => findEntry(document, section.id, after.id);
  const changes: Change[] = [];
  for (const key of keys(before, after)) {
    if (key === 'id' || same(before[key as keyof ResumeEntry], after[key as keyof ResumeEntry])) continue;
    if (key !== 'bullets') {
      changes.push({
        label: `${label} · ${fieldLabels[key] ?? '内容'}`,
        pick: (document) => (pick(document) as Record<string, unknown> | undefined)?.[key],
      });
      continue;
    }
    const old = 'bullets' in before ? before.bullets : [],
      now = 'bullets' in after ? after.bullets : [];
    // Bullets have no ids: with the same count each one is compared in place, otherwise the list as a whole.
    if (old.length !== now.length)
      changes.push({
        label: `${label} · 要点`,
        pick: (document) => (pick(document) as { bullets?: string[] } | undefined)?.bullets,
      });
    else
      now.forEach((bullet, index) => {
        if (bullet !== old[index])
          changes.push({
            label: `${label} · 第 ${index + 1} 条要点`,
            pick: (document) => (pick(document) as { bullets?: string[] } | undefined)?.bullets?.[index],
          });
      });
  }
  return changes;
}

function sectionChanges(before: ResumeSection, after: ResumeSection): Change[] {
  const name = sectionName(after);
  const pick = (document: ResumeDocument) => findSection(document, after.id);
  const changes: Change[] = [];
  if (before.title !== after.title)
    changes.push({ label: `${sectionName(before)} · 标题（改为${name}）`, pick: (document) => pick(document)?.title });
  if ((before.text ?? '') !== (after.text ?? ''))
    changes.push({ label: `${name} · 内容`, pick: (document) => pick(document)?.text ?? '' });
  if (before.visible !== after.visible)
    changes.push({
      label: `${name} · ${after.visible ? '显示' : '隐藏'}`,
      pick: (document) => pick(document)?.visible,
    });
  if (before.type !== after.type || !same(before.layout, after.layout))
    changes.push({
      label: `${name} · 设置`,
      pick: (document) => {
        const section = pick(document);
        return section && [section.type, section.layout];
      },
    });
  const entries = new Map(before.entries.map((entry) => [entry.id, entry]));
  for (const entry of before.entries)
    if (!after.entries.some((item) => item.id === entry.id))
      changes.push({
        label: `${name} · ${entryName(before, entry)}（已删除）`,
        pick: (document) => findEntry(document, after.id, entry.id),
      });
  for (const entry of after.entries) {
    const old = entries.get(entry.id);
    if (!old)
      changes.push({
        label: `${name} · ${entryName(after, entry)}（新增）`,
        pick: (document) => findEntry(document, after.id, entry.id),
      });
    else changes.push(...entryChanges(after, old, entry));
  }
  if (reordered(before.entries, after.entries))
    changes.push({ label: `${name} · 条目顺序`, pick: (document) => pick(document)?.entries.map((entry) => entry.id) });
  return changes;
}

/**
 * What changed from one version of a resume to the next. Sections and entries are matched by id, so a
 * deletion is named from the version that still had it and a move reads as a new order, not as edits.
 */
export function listChanges(before: ResumeDocument, after: ResumeDocument): Change[] {
  const changes: Change[] = [];
  for (const key of Object.keys(topLabels) as Array<keyof typeof topLabels>)
    if (!same(before[key], after[key])) changes.push({ label: topLabels[key], pick: (document) => document[key] });
  for (const key of keys(before.appearance, after.appearance)) {
    if (
      !same(
        before.appearance[key as keyof typeof before.appearance],
        after.appearance[key as keyof typeof after.appearance],
      )
    )
      changes.push({
        label: appearanceLabels[key] ?? '外观',
        pick: (document) => document.appearance[key as keyof typeof document.appearance],
      });
  }
  for (const key of keys(before.data.basics, after.data.basics)) {
    const field = key as keyof typeof before.data.basics;
    if (!same(before.data.basics[field], after.data.basics[field]))
      changes.push({
        label: `基本信息 · ${basicsLabels[key] ?? '其他'}`,
        pick: (document) => document.data.basics[field],
      });
  }
  const sections = new Map(before.data.sections.map((section) => [section.id, section]));
  for (const section of before.data.sections)
    if (!findSection(after, section.id))
      changes.push({
        label: `${sectionName(section)}栏目（已删除）`,
        pick: (document) => findSection(document, section.id),
      });
  for (const section of after.data.sections) {
    const old = sections.get(section.id);
    if (!old)
      changes.push({
        label: `${sectionName(section)}栏目（新增）`,
        pick: (document) => findSection(document, section.id),
      });
    else changes.push(...sectionChanges(old, section));
  }
  if (reordered(before.data.sections, after.data.sections))
    changes.push({ label: '栏目顺序', pick: (document) => document.data.sections.map((section) => section.id) });
  return changes;
}

/** Readable labels for what changed from `before` to `after`, without repeats. */
export function summarizeChanges(before: ResumeDocument, after: ResumeDocument): string[] {
  return [...new Set(listChanges(before, after).map((change) => change.label))];
}

/** A short line for a list of change labels; empty when there are none. */
export function formatChanges(labels: string[]): string {
  return labels.length > 3 ? `${labels.slice(0, 3).join('、')} 等 ${labels.length} 处` : labels.join('、');
}
