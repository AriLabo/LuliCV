import type { Appearance, ResumeDocument, ResumeRecord, ResumeSource, ResumeTarget, ValidationReport } from './types';
import { fontIds, fontOptions } from './fonts';
import { densityDefaults, layoutRanges } from './defaults';
import { chineseTypographyWarnings } from './typography';
import { lintAppearanceCss, MAX_APPEARANCE_CSS, scanThemeCss, THEME_ID } from './theme-package';
import { isResumeData, isResumeRecord, isWorkspace, validateResumeData } from './validation';
import { isPrivateToken } from './privacy';

import catalog from './theme-catalog.generated.json' with { type: 'json' };
export const themeCatalog = catalog;
export const themeIds = catalog.map((theme) => theme.id);
/**
 * What agents need to adjust layout without guessing: ranges, density presets, fonts and the one per-section flag.
 * Spacing is document-wide, and entries are kept from splitting badly automatically.
 */
export const layoutOptions = {
  ranges: layoutRanges,
  densities: densityDefaults,
  fontFamily: fontOptions.map(({ id, name }) => ({ id, name })),
  sectionFlags: { pageBreakBefore: '从新的一页开始这个栏目' },
};
/** Ids an installed theme may not use: they already name a built-in theme. */
export const reservedThemeIds = themeIds;
export function validateAppearance(value: Appearance): string[] {
  const errors: string[] = [];
  // Installed themes live in the workspace, so any well-formed id is accepted; an unknown one renders with the default theme.
  if (typeof value.themeId !== 'string' || !THEME_ID.test(value.themeId))
    errors.push('appearance.themeId 必须是主题 id（小写字母、数字、连字符）');
  if (value.preset !== undefined && (typeof value.preset !== 'string' || !/^[a-z][a-z0-9]{0,23}$/.test(value.preset)))
    errors.push('appearance.preset 必须是预设 id');
  if (value.settings !== undefined) {
    const entries =
      value.settings && typeof value.settings === 'object' && !Array.isArray(value.settings)
        ? Object.entries(value.settings)
        : null;
    if (
      !entries ||
      entries.length > 20 ||
      entries.some(
        ([key, setting]) =>
          !/^[a-z][a-z0-9]{0,23}$/.test(key) ||
          !(typeof setting === 'boolean' || (typeof setting === 'string' && /^[a-z][a-z0-9]{0,23}$/.test(setting))),
      )
    )
      errors.push('appearance.settings 必须是主题设置项到取值的映射');
  }
  for (const [key, { min, max, unit }] of Object.entries(layoutRanges)) {
    const number = value.layout[key as keyof typeof layoutRanges];
    if (!Number.isFinite(number) || number < min || number > max)
      errors.push(`appearance.layout.${key} 必须在 ${min}–${max} ${unit} 之间`);
  }
  if (!/^#[0-9a-f]{6}$/i.test(value.layout.accentColor)) errors.push('appearance.layout.accentColor 必须是六位颜色');
  if (value.layout.fontFamily !== undefined && !fontIds.includes(value.layout.fontFamily))
    errors.push(`appearance.layout.fontFamily 必须是 ${fontIds.join('、')} 之一`);
  if (value.css !== undefined) {
    if (typeof value.css !== 'string' || !value.css.trim())
      errors.push('appearance.css 必须是 CSS 文本；不要自定义样式时删掉这一项');
    else errors.push(...scanThemeCss(value.css, 'appearance.css', MAX_APPEARANCE_CSS));
  }
  return errors;
}
const targetLimits = { company: 200, role: 200, jd: 20000 } as const;
function normalizeTarget(value: unknown): ResumeTarget | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('VALIDATION_FAILED: target 必须是对象');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !(key in targetLimits)))
    throw new Error('VALIDATION_FAILED: target 只允许 company、role、jd');
  const target: ResumeTarget = { company: '', role: '', jd: '' };
  for (const [key, limit] of Object.entries(targetLimits) as Array<['company' | 'role' | 'jd', number]>) {
    const text = input[key] ?? '';
    if (typeof text !== 'string' || text.length > limit)
      throw new Error(`VALIDATION_FAILED: target.${key} 必须是不超过 ${limit} 字的文本`);
    target[key] = text;
  }
  return target;
}
function normalizeTreeFields(record: ResumeRecord): Pick<ResumeRecord, 'parentId' | 'purpose' | 'sample'> {
  const result: Pick<ResumeRecord, 'parentId' | 'purpose' | 'sample'> = {};
  if (record.parentId !== undefined) {
    if (
      typeof record.parentId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(record.parentId) ||
      record.parentId === record.id
    )
      throw new Error('VALIDATION_FAILED: 非法 parentId');
    result.parentId = record.parentId;
  }
  if (record.purpose !== undefined) {
    if (typeof record.purpose !== 'string' || record.purpose.length > 200)
      throw new Error('VALIDATION_FAILED: purpose 必须是不超过 200 字的文本');
    if (record.purpose.trim()) result.purpose = record.purpose;
  }
  if (record.sample !== undefined) {
    if (typeof record.sample !== 'boolean') throw new Error('VALIDATION_FAILED: sample 只能是 true 或 false');
    if (record.sample) result.sample = true;
  }
  return result;
}
function normalizeSource(value: unknown): ResumeSource | undefined {
  if (value === undefined) return undefined;
  const input = value as Partial<ResumeSource> | null;
  if (
    !input ||
    typeof input.id !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(input.id) ||
    !Number.isSafeInteger(input.revision) ||
    input.revision! < 1
  )
    throw new Error('VALIDATION_FAILED: 非法 source');
  return { id: input.id, revision: input.revision! };
}
export function normalizeDocument(value: unknown): ResumeDocument {
  if (!isResumeRecord(value)) throw new Error('VALIDATION_FAILED: 无效简历文档');
  const record = value as ResumeRecord & Partial<ResumeDocument>;
  if ('documentVersion' in record && record.documentVersion !== 1) throw new Error('VALIDATION_FAILED: 未知文档版本');
  const revision = record.revision ?? 1;
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('VALIDATION_FAILED: revision 必须是正整数');
  if (
    !/^[a-zA-Z0-9_-]{1,128}$/.test(record.id) ||
    !Number.isFinite(record.createdAt) ||
    !Number.isFinite(record.updatedAt)
  )
    throw new Error('VALIDATION_FAILED: 非法文档元数据');
  const photo = record.data.basics.photo;
  // In privacy mode the photo lives in the workspace's private values and the resume holds its token.
  if (photo && photo !== '{{private:photo}}') {
    const match = photo.match(/^data:image\/(?:png|jpeg|webp);base64,([a-zA-Z0-9+/]*={0,2})$/);
    if (
      !match ||
      match[1].length % 4 !== 0 ||
      (match[1].length / 4) * 3 - (match[1].match(/=+$/)?.[0].length ?? 0) > 2 * 1024 * 1024
    )
      throw new Error('VALIDATION_FAILED: 照片必须为不超过 2MB 的本地 PNG/JPEG/WebP data URL');
  }
  const errors = validateAppearance(record.appearance);
  if (errors.length) throw new Error(`VALIDATION_FAILED: ${errors.join('; ')}`);
  const target = normalizeTarget(record.target);
  const source = normalizeSource(record.source);
  return structuredClone({
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    data: record.data,
    appearance: record.appearance,
    ...(target ? { target } : {}),
    ...(source ? { source } : {}),
    ...normalizeTreeFields(record),
    documentVersion: 1,
    revision,
  });
}
export function normalizeImport(value: unknown, makeRecord: () => ResumeRecord): ResumeDocument[] {
  if (isWorkspace(value)) {
    const documents = value.resumes.map(normalizeDocument);
    if (new Set(documents.map((document) => document.id)).size !== documents.length)
      throw new Error('VALIDATION_FAILED: 文档 ID 重复');
    return documents;
  }
  if (isResumeRecord(value)) return [normalizeDocument(value)];
  if (isResumeData(value)) return [normalizeDocument({ ...makeRecord(), data: value })];
  throw new Error('VALIDATION_FAILED: 不支持的导入格式');
}
export function validateDocument(document: ResumeDocument): ValidationReport {
  const errors = [...validateResumeData(document.data), ...validateAppearance(document.appearance)];
  const css = errors.length || !document.appearance.css ? [] : lintAppearanceCss(document.appearance.css);
  return { errors, warnings: [...contentWarnings(document), ...css] };
}
/** Things in the content worth a second look; the person can fix each in the editor. */
export function contentWarnings(document: ResumeDocument): string[] {
  const warnings: string[] = [];
  if (!document.data.basics.name.trim()) warnings.push('姓名未填写');
  // Still to be filled in, not a layout fault: the empty section prints no heading.
  document.data.sections.forEach((section, index) => {
    if (section.visible && !section.text?.trim() && !section.entries.length)
      warnings.push(`“${section.title || '未命名栏目'}”没有内容 [sections[${index}]]`);
  });
  if (
    document.data.basics.email &&
    !isPrivateToken(document.data.basics.email) &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(document.data.basics.email)
  )
    warnings.push('邮箱格式可能不完整');
  const basics = document.data.basics;
  const links: Array<[string, string]> = [
    ...basics.links.map((link, index): [string, string] => [`basics.links[${index}].url`, link.url]),
    ...document.data.sections.flatMap((section, sectionIndex) =>
      section.entries.flatMap((entry, entryIndex): Array<[string, string]> =>
        'link' in entry ? [[`sections[${sectionIndex}].entries[${entryIndex}].link`, entry.link]] : [],
      ),
    ),
  ];
  const seen = new Map<string, string>();
  for (const [field, link] of links.filter(([, link]) => link && !isPrivateToken(link))) {
    // Themes render bare domains as https links, so only flag values that stay unparseable.
    const explicit = /^[a-z][a-z0-9+.-]*:/i.test(link);
    try {
      const url = new URL(explicit ? link : `https://${link}`);
      if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol))
        warnings.push(`${field} 链接协议不支持: ${link}`);
      const key = url.href
        .replace(/\/$/, '')
        .replace(/^https?:\/\/(www\.)?/i, '')
        .toLowerCase();
      if (seen.has(key)) warnings.push(`${field} 与 ${seen.get(key)} 重复，联系方式中会出现两次`);
      else seen.set(key, field);
    } catch {
      warnings.push(`${field} 链接格式不完整: ${link}`);
    }
  }
  for (const section of document.data.sections)
    for (const entry of section.entries)
      if ('startDate' in entry) {
        const start = entry.startDate.match(/^(\d{4})[./-](\d{1,2})$/);
        const end = entry.endDate.match(/^(\d{4})[./-](\d{1,2})$/);
        for (const [label, text] of [
          ['开始', entry.startDate],
          ['结束', entry.endDate],
        ])
          if (text && !/^(\d{4}[./-](0?[1-9]|1[0-2])|至今|present)$/i.test(text))
            warnings.push(`${entry.id} ${label}日期格式需要检查`);
        if (start && end && Number(start[1]) * 12 + Number(start[2]) > Number(end[1]) * 12 + Number(end[2]))
          warnings.push(`${entry.id} 开始日期晚于结束日期`);
      }
  warnings.push(...chineseTypographyWarnings(document.data));
  return warnings;
}
