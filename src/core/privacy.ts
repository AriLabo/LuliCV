import { ResumeError } from './errors';
import { LINK_LIMITS } from './limits';
import { sitePlatform } from './links';
import type { ResumeData } from './types';

/*
 * Privacy mode: the person's contact details are kept once per workspace, apart from the resumes. Resumes hold
 * tokens such as {{private:phone}}; the real values are filled in only to lay out and export the PDF. Every
 * Bridge response goes through a PrivacyView as a safety net for revisions written before privacy mode was on,
 * and every write is sealed so that a real value typed into a resume is stored as its token.
 */

export type PrivateField =
  'name' | 'phone' | 'email' | 'photo' | 'birthDate' | 'hometown' | 'politicalStatus' | 'location' | 'links';
export interface PrivacySettings {
  enabled: boolean;
  fields: PrivateField[];
}

export const privateFieldOptions: ReadonlyArray<{ id: PrivateField; label: string; byDefault: boolean }> = [
  { id: 'name', label: '姓名', byDefault: true },
  { id: 'phone', label: '电话', byDefault: true },
  { id: 'email', label: '邮箱', byDefault: true },
  { id: 'photo', label: '照片', byDefault: true },
  { id: 'birthDate', label: '出生年月', byDefault: true },
  { id: 'hometown', label: '籍贯', byDefault: true },
  { id: 'politicalStatus', label: '政治面貌', byDefault: true },
  { id: 'location', label: '所在地', byDefault: false },
  { id: 'links', label: '链接网址（个人网站、GitHub 等）', byDefault: false },
];
/** How a placeholder reads on the page and in the editor: 【手机号】, a 手机号 label in the preview. */
export const privateDisplayNames: Record<PrivateField, string> = {
  name: '姓名',
  phone: '手机号',
  email: '邮箱',
  photo: '照片',
  birthDate: '出生年月',
  hometown: '籍贯',
  politicalStatus: '政治面貌',
  location: '所在地',
  links: '链接',
};
/** An agent's request to export a PDF with the private values filled in, waiting for the person in the web page. */
export interface ExportRequest {
  requestId: string;
  resumeId: string;
  name: string;
  revision: number;
  pages: number;
  fields: PrivateField[];
  expiresAt: number;
  /** The resume was saved again after the request; only the requested revision may be exported, so approval is off. */
  changed: boolean;
  status: 'pending' | 'approved' | 'declined' | 'expired';
}
/** Why an export request can no longer be approved; the web page shows it and the Bridge refuses with it. */
export const CHANGED_AFTER_REQUEST = '这份简历在请求后改过，请拒绝，让 agent 重新检查后再导出';
/** How an export that filled in the private values came about: an agent's request and its outcome, or the person in the web page. */
export type ExportOutcome = 'approved' | 'declined' | 'expired' | 'web';
/** One line of the local export log. Pages only for an export that happened. */
export interface ExportLogEntry {
  at: number;
  resumeId: string;
  name: string;
  revision: number;
  pages?: number;
  outcome: ExportOutcome;
}
export const defaultPrivacy: PrivacySettings = {
  enabled: false,
  fields: privateFieldOptions.filter((option) => option.byDefault).map((option) => option.id),
};

export const PRIVACY_NOTICE =
  '隐私模式已开启：{{private:…}} 是隐私占位，导出 PDF 时换成用户在「隐私信息」里填写的内容。占位可以保留、删除、挪动或复制，不要尝试还原，也不要向用户索要真实值写进简历；网页和预览只含占位，可以查看和截图，用户正在「填写」隐私信息时除外；不要读或截图导出的 PDF，看分页用 inspect --images（隐私处已用字段名遮挡）；导出 PDF 时用户在网页里批准，PDF 下载到用户的浏览器，你只会收到页数';

export function normalizePrivacy(value: unknown): PrivacySettings {
  const fail = (message: string): never => {
    throw new ResumeError('VALIDATION_FAILED', message);
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('隐私设置需要 { enabled, fields }');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== 'enabled' && key !== 'fields')) fail('隐私设置只允许 enabled 和 fields');
  if (typeof input.enabled !== 'boolean') fail('enabled 必须是布尔值');
  if (!Array.isArray(input.fields)) fail('fields 必须是数组');
  const known = privateFieldOptions.map((option) => option.id);
  const unknown = (input.fields as unknown[]).filter((field) => !known.includes(field as PrivateField));
  if (unknown.length) fail(`未知隐私字段：${unknown.map(String).join('、')}；可选 ${known.join('、')}`);
  return {
    enabled: input.enabled as boolean,
    fields: known.filter((field) => (input.fields as unknown[]).includes(field)),
  };
}

/** Agents may tighten privacy but never loosen it: turning it off or dropping a field takes the person in the browser. */
export function loosens(current: PrivacySettings, next: PrivacySettings): boolean {
  return current.enabled && (!next.enabled || current.fields.some((field) => !next.fields.includes(field)));
}

/**
 * The workspace's private values. Keys are a basic field's id, or link:<key> for one link URL. Aliases are other
 * values of the same field (another resume's, an older revision's, a replaced one): found and replaced like the
 * current value, never filled in. The alias key 'link' stands for a link that is no longer in any resume.
 * Values of fields that are no longer private stay, inactive, so an older revision's tokens can still be filled back.
 */
export interface PrivateStore {
  values: Record<string, string>;
  labels: Record<string, string>;
  aliases: Array<{ key: string; value: string }>;
}
export const emptyStore = (): PrivateStore => ({ values: {}, labels: {}, aliases: [] });

const TOKEN = /\{\{private:([^{}]*)\}\}/g;
export const tokenFor = (key: string) => `{{private:${key}}}`;
export const hasToken = (text: string) => /\{\{private:[^{}]*\}\}/.test(text);
/** Exactly one token: validation leaves these alone, export fills them. */
export const PRIVATE_TOKEN = /^\{\{private:[^{}]*\}\}$/;
export const isPrivateToken = (text: string) => PRIVATE_TOKEN.test(text);
const basicFields = [
  'name',
  'phone',
  'email',
  'photo',
  'birthDate',
  'hometown',
  'politicalStatus',
  'location',
] as const;
type BasicField = (typeof basicFields)[number];
const LINK_KEY = /^link:[A-Za-z0-9_-]{1,64}$/;
const labelOf = (field: PrivateField) => privateFieldOptions.find((option) => option.id === field)!.label;

export function fieldOf(key: string): PrivateField | undefined {
  if ((basicFields as readonly string[]).includes(key)) return key as BasicField;
  if (key === 'link' || LINK_KEY.test(key)) return 'links';
  return undefined;
}

type Located = { name?: string; data: ResumeData };
interface Secret {
  key: string;
  field: PrivateField;
  value: string;
  token: string;
  pattern?: string;
}

const escape = (text: string) => text.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');

/** How a value is found in free text: phone numbers with any separators, links with or without scheme. Too short to match safely: none. */
function patternFor(field: PrivateField, raw: string): string | undefined {
  const value = raw.trim();
  // A photo is a data URL: it only ever sits in its own field. Personal details are short everyday words (群众,
  // 上海, 2000.05) that ordinary text uses too, so they are covered in their own field only.
  if (field === 'photo' || field === 'birthDate' || field === 'hometown' || field === 'politicalStatus')
    return undefined;
  if (field === 'phone') {
    const digits = value.replace(/\D/g, '');
    const local = digits.length === 13 && digits.startsWith('86') ? digits.slice(2) : digits;
    if (local.length >= 6) return `(?<!\\d)(?:\\+?86[\\s-]*)?${local.split('').join('[\\s.()-]*')}(?!\\d)`;
  }
  if (field === 'links') {
    const core = value
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/\/+$/, '');
    // Bounded on both sides so example.com is not found inside myexample.com or example.com.cn; a path after it stays.
    if (core.length >= 4)
      return `(?<![\\w.@-])(?:[a-z][a-z0-9+.-]*:\\/\\/)?(?:www\\.)?${escape(core)}(?![\\w-]|\\.\\w)`;
  }
  // A two-letter Latin name would match everywhere; CJK names are short by nature.
  // eslint-disable-next-line no-control-regex -- the whole ASCII range, control characters included
  return value.length >= (/^[\x00-\x7f]*$/.test(value) ? 4 : 2) ? escape(value) : undefined;
}

/** Two spellings of the same value: a phone number in any formatting, a link with or without scheme, an email in any case. */
function canonical(field: PrivateField, raw: string): string {
  const value = raw.trim();
  let result = value;
  if (field === 'phone') {
    const digits = value.replace(/\D/g, '');
    result = digits.length === 13 && digits.startsWith('86') ? digits.slice(2) : digits;
  } else if (field === 'links')
    result = value
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/\/+$/, '')
      .toLowerCase();
  else if (field === 'email') result = value.toLowerCase();
  return result || value;
}

function secretsOf(entries: Array<{ key: string; value: string }>, fields: readonly PrivateField[]): Secret[] {
  const enabled = new Set(fields);
  return entries.flatMap(({ key, value }) => {
    const field = fieldOf(key);
    return field && enabled.has(field) && value.trim()
      ? [{ key, field, value, token: tokenFor(key), pattern: patternFor(field, value) }]
      : [];
  });
}
const valuesOf = (store: PrivateStore) => Object.entries(store.values).map(([key, value]) => ({ key, value }));

/**
 * Replaces every private value found in a string with its token, in one pass so inserted tokens are never matched
 * again, and never inside an existing token. Earlier groups win where patterns overlap; within a group, longer values do.
 */
function scrubber(...groups: Secret[][]): (text: string) => string {
  const usable = groups.flatMap((group) =>
    group.filter((secret) => secret.pattern).sort((a, b) => b.value.length - a.value.length),
  );
  if (!usable.length) return (text) => text;
  const regex = new RegExp(usable.map((secret) => `(${secret.pattern})`).join('|'), 'gi');
  const replace = (text: string) =>
    text.replace(
      regex,
      (...match) => usable[match.slice(1, usable.length + 1).findIndex((group) => group !== undefined)].token,
    );
  return (text) =>
    text
      .split(/(\{\{private:[^{}]*\}\})/)
      .map((part, index) => (index % 2 ? part : replace(part)))
      .join('');
}

/** A copy of `value` with every string passed through `map`; properties named by `skip` are copied as they are. */
export function mapStrings<T>(value: T, map: (text: string) => string, skip?: (key: string) => boolean): T {
  if (typeof value === 'string') return map(value) as T;
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, map, skip)) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, skip?.(key) ? item : mapStrings(item, map, skip)]),
    ) as T;
  return value;
}

function countTokens(value: unknown, counts = new Map<string, number>()) {
  mapStrings(value, (text) => {
    for (const match of text.matchAll(TOKEN)) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
    return text;
  });
  return counts;
}

/** Where a value matches a stored one: the store's own entry first, then its aliases. */
function matchKey(store: PrivateStore, field: PrivateField, value: string): string | undefined {
  const same = (candidate: string) => canonical(field, candidate) === canonical(field, value);
  const own = Object.entries(store.values).find(
    ([key, candidate]) => fieldOf(key) === field && candidate && same(candidate),
  );
  if (own) return own[0];
  return store.aliases.find((alias) => alias.key !== 'link' && fieldOf(alias.key) === field && same(alias.value))?.key;
}

function linkKeyFor(id: string, store: PrivateStore): string {
  const base = `link:${/^[A-Za-z0-9_-]{1,56}$/.test(id) ? id : 'link'}`;
  if (!Object.hasOwn(store.values, base)) return base;
  for (let index = 2; ; index++) if (!Object.hasOwn(store.values, `${base}-${index}`)) return `${base}-${index}`;
}

/** Text with every known token replaced by its value; an enabled field without a value becomes empty. For export and layout only. */
export function fillPrivate<T>(
  value: T,
  settings: PrivacySettings,
  store: PrivateStore,
  only?: (key: string) => boolean,
): T {
  const enabled = new Set(settings.enabled ? settings.fields : []);
  return mapStrings(value, (text) =>
    text.replace(TOKEN, (found, key: string) => {
      if (only && !only(key)) return found;
      if (Object.hasOwn(store.values, key)) return store.values[key];
      const field = fieldOf(key);
      return field && enabled.has(field) ? '' : found;
    }),
  ) as T;
}

export interface Sealed<T> {
  document: T;
  store: PrivateStore;
  notes: string[];
}

/**
 * A resume as it may be stored in privacy mode: private fields hold their token, real values anywhere become
 * tokens, a new link URL is taken into the store, and every token refers to something the store can fill.
 * A private basic field may only change through the store, so a different value written into one is refused.
 */
export function sealPrivate<T extends Located>(document: T, settings: PrivacySettings, store: PrivateStore): Sealed<T> {
  const fields = settings.enabled ? settings.fields : [];
  const enabled = new Set<PrivateField>(fields);
  // A token of a field that is no longer private (an older revision restored) gets its value back.
  const inactive = (key: string) => Object.hasOwn(store.values, key) && !enabled.has(fieldOf(key)!);
  const filled = fillPrivate(document, settings, store, inactive);
  if (!settings.enabled) return { document: filled, store, notes: [] };
  const next = structuredClone(store);
  const notes: string[] = [];
  const result = structuredClone(filled);
  const basics = result.data.basics;
  const scrub = () =>
    scrubber(
      secretsOf(valuesOf(next), fields),
      secretsOf(
        next.aliases.filter((alias) => alias.key !== 'link'),
        fields,
      ),
    );
  let replace = scrub();
  for (const field of basicFields) {
    if (!enabled.has(field) || !basics[field]) continue;
    const value = replace(basics[field]!);
    if (hasToken(value) || !value.trim()) {
      basics[field] = value;
      continue;
    }
    const key = matchKey(next, field, value);
    if (key) {
      basics[field] = tokenFor(key);
      continue;
    }
    if (next.values[field])
      throw new ResumeError(
        'VALIDATION_FAILED',
        `${labelOf(field)}是隐私字段，统一在「隐私信息」里填写；要修改请用户在网页预览栏「隐私模式」里重新填写，简历里写 ${tokenFor(field)}`,
      );
    next.values[field] = field === 'photo' ? value : value.trim();
    basics[field] = tokenFor(field);
    notes.push(`${labelOf(field)}已收进隐私信息，简历里换成 ${tokenFor(field)}`);
    replace = scrub();
  }
  if (enabled.has('links'))
    for (const link of basics.links) {
      if (!link.url) continue;
      const value = replace(link.url);
      if (hasToken(value) || !value.trim()) {
        link.url = value;
        continue;
      }
      const found = matchKey(next, 'links', value);
      const key = found ?? linkKeyFor(link.id, next);
      if (!found) {
        next.values[key] = value.trim();
        if (link.label) next.labels[key] = link.label;
        notes.push(`链接「${link.label || link.id}」的地址已收进隐私信息，简历里换成 ${tokenFor(key)}`);
        replace = scrub();
      }
      link.url = tokenFor(key);
    }
  const before = countTokens(filled);
  const sealed = mapStrings(result, replace, (key) => key === 'appearance') as T;
  for (const [key, count] of countTokens(sealed)) {
    const field = fieldOf(key);
    if (!field || key === 'link' || !enabled.has(field) || (field === 'links' && !Object.hasOwn(next.values, key))) {
      throw new ResumeError(
        'VALIDATION_FAILED',
        `${tokenFor(key)} 不是可用的隐私占位；可用：${availableTokens(fields, next).join('、') || '无'}`,
      );
    }
    if (count > (before.get(key) ?? 0) && !notes.some((note) => note.includes(tokenFor(key))))
      notes.push(`写入的${field === 'links' ? '链接' : labelOf(field)}已换成 ${tokenFor(key)}`);
  }
  return { document: sealed, store: next, notes };
}

function availableTokens(fields: readonly PrivateField[], store: PrivateStore) {
  return [
    ...fields.filter((field) => field !== 'links'),
    ...(fields.includes('links') ? Object.keys(store.values).filter((key) => fieldOf(key) === 'links') : []),
  ].map(tokenFor);
}

/**
 * What one request may see of a workspace in privacy mode. Current resumes already hold tokens; this catches real
 * values in revisions from before privacy mode, and in anything else a response quotes (a layout report, an error).
 */
export class PrivacyView {
  private readonly scrub: (text: string) => string;
  private readonly secrets: Secret[];
  constructor(
    readonly settings: PrivacySettings,
    private readonly store: PrivateStore,
  ) {
    this.secrets = [...secretsOf(valuesOf(store), settings.fields), ...secretsOf(store.aliases, settings.fields)];
    this.scrub = scrubber(secretsOf(valuesOf(store), settings.fields), secretsOf(store.aliases, settings.fields));
  }
  get fields() {
    return this.settings.fields;
  }

  /** A resume with every private value replaced; private fields that still hold any other text become their token. */
  mask<T extends Located>(document: T): T {
    const masked = mapStrings(document, this.scrub) as T;
    const basics = masked.data.basics;
    const enabled = new Set(this.fields);
    for (const field of basicFields)
      if (enabled.has(field) && basics[field] && !hasToken(basics[field]!)) basics[field] = tokenFor(field);
    if (enabled.has('links'))
      for (const link of basics.links)
        if (link.url && !hasToken(link.url)) link.url = tokenFor(matchKey(this.store, 'links', link.url) ?? 'link');
    return masked;
  }

  /** Any response body: resumes are masked, every other string has private values replaced. */
  protect<T>(value: T, skip?: (key: string) => boolean): T {
    const walk = (item: unknown): unknown => {
      if (isDocument(item)) return this.mask(item);
      if (typeof item === 'string') return this.scrub(item);
      if (Array.isArray(item)) return item.map(walk);
      if (item && typeof item === 'object')
        return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, skip?.(key) ? child : walk(child)]));
      return item;
    };
    return walk(value) as T;
  }

  /** Regex sources for every private value and the field each belongs to, for labelling them in page images. */
  patterns(): Array<{ pattern: string; field: PrivateField }> {
    const seen = new Set<string>();
    return this.secrets.flatMap(({ pattern, field }) =>
      pattern && !seen.has(pattern) && seen.add(pattern) ? [{ pattern, field }] : [],
    );
  }
}

const isDocument = (value: unknown): value is Located & { documentVersion: 1 } =>
  !!value &&
  typeof value === 'object' &&
  (value as { documentVersion?: unknown }).documentVersion === 1 &&
  !!(value as Located).data?.basics;

export type PrivacyChoices = Partial<Record<PrivateField, string>>;
export interface PrivacyConflict {
  field: PrivateField;
  label: string;
  options: Array<{ value: string; resumes: number; mentions: number }>;
}
export interface PrivacyPlan<T> {
  settings: PrivacySettings;
  store: PrivateStore;
  /** The resumes that change, with their new content. */
  documents: T[];
  /** Fields taken into the store: in how many resumes, and how many places in all. */
  moved: Array<{ field: PrivateField; label: string; resumes: number; places: number }>;
  /** Fields filled back into the resumes. */
  restored: Array<{ field: PrivateField; label: string; resumes: number }>;
  /** Fields whose resumes disagree: nothing changes until the person picks one value for each. */
  conflicts: PrivacyConflict[];
}

/**
 * Turning privacy mode on, off, or changing its fields. Adding a field takes its values out of every resume into the
 * store (other spellings and older revisions' values become aliases); removing one fills its values back in.
 */
export function planPrivacy<T extends Located>(
  current: { settings: PrivacySettings; store: PrivateStore; documents: T[]; history: Located[] },
  next: PrivacySettings,
  choices: PrivacyChoices = {},
): PrivacyPlan<T> {
  const before = current.settings.enabled ? current.settings.fields : [];
  const after = next.enabled ? next.fields : [];
  const removed = before.filter((field) => !after.includes(field));
  const added = after.filter((field) => !before.includes(field));
  let store = structuredClone(current.store);
  let documents = current.documents.map((document) => structuredClone(document));
  const conflicts: PrivacyConflict[] = [];

  // Removed fields are filled back in; their values stay in the store, inactive, for older revisions' tokens.
  if (removed.length)
    documents = documents.map((document) =>
      fillPrivate(document, { enabled: true, fields: removed }, store, (key) => removed.includes(fieldOf(key)!)),
    );

  const alias = (key: string, value: string) => {
    if (value.trim() && !hasToken(value) && !store.aliases.some((item) => item.key === key && item.value === value))
      store.aliases.push({ key, value });
  };
  // A field made private again starts from what the resumes say now; a value it had before is only covered.
  const retired = new Map<PrivateField, string>();
  for (const field of added)
    for (const key of Object.keys(store.values).filter((key) => fieldOf(key) === field)) {
      if (field === 'links') alias('link', store.values[key]);
      else retired.set(field, store.values[key]);
      delete store.values[key];
      delete store.labels[key];
    }
  for (const field of added) {
    if (field === 'links') continue;
    const groups: Array<{ canon: string; raws: Map<string, number>; resumes: number }> = [];
    for (const document of documents) {
      const value = document.data.basics[field as BasicField];
      if (!value || hasToken(value) || !value.trim()) continue;
      const canon = canonical(field, value);
      let group = groups.find((item) => item.canon === canon);
      if (!group) groups.push((group = { canon, raws: new Map(), resumes: 0 }));
      group.raws.set(value, (group.raws.get(value) ?? 0) + 1);
      group.resumes++;
    }
    const top = (group: (typeof groups)[number]) => [...group.raws].sort((a, b) => b[1] - a[1])[0][0];
    let chosen = groups.length === 1 ? groups[0] : undefined;
    const choice = choices[field];
    if (groups.length > 1) {
      chosen = choice === undefined ? undefined : groups.find((group) => group.canon === canonical(field, choice));
      if (!chosen) {
        conflicts.push({
          field,
          label: labelOf(field),
          options: groups
            .map((group) => ({
              value: top(group),
              resumes: group.resumes,
              mentions: mentions(documents, field, group.raws.keys()),
            }))
            .sort((a, b) => b.resumes - a.resumes || b.mentions - a.mentions),
        });
        continue;
      }
    }
    if (chosen)
      store.values[field] =
        field === 'photo'
          ? top(chosen)
          : (choice !== undefined && chosen.raws.has(choice) ? choice : top(chosen)).trim();
    for (const group of groups) if (group !== chosen) for (const value of group.raws.keys()) alias(field, value);
    const old = retired.get(field);
    if (old && (!chosen || canonical(field, old) !== chosen.canon)) alias(field, old);
    for (const document of current.history) {
      const value = document.data.basics[field as BasicField];
      if (value && (!chosen || canonical(field, value) !== chosen.canon)) alias(field, value);
    }
  }
  if (added.includes('links')) {
    for (const document of documents)
      for (const link of document.data.basics.links) {
        if (!link.url.trim() || hasToken(link.url) || matchKey(store, 'links', link.url)) continue;
        const key = linkKeyFor(link.id, store);
        store.values[key] = link.url.trim();
        if (link.label) store.labels[key] = link.label;
      }
    for (const document of current.history)
      for (const link of document.data.basics.links)
        if (link.url && !matchKey(store, 'links', link.url)) alias('link', link.url);
  }

  const settings = { enabled: next.enabled, fields: [...next.fields] };
  if (!conflicts.length && next.enabled)
    documents = documents.map((document) => {
      const sealed = sealPrivate(document, settings, store);
      store = sealed.store;
      return sealed.document;
    });
  const original = new Map(current.documents.map((document, index) => [index, JSON.stringify(document)]));
  const changed = documents.filter((document, index) => JSON.stringify(document) !== original.get(index));
  const counts = (documents: Located[]) => documents.map((document) => countTokens(document));
  const was = counts(current.documents),
    now = counts(documents);
  const moved = conflicts.length
    ? []
    : added.map((field) => {
        let resumes = 0,
          places = 0;
        now.forEach((tokens, index) => {
          let increase = 0;
          for (const [key, count] of tokens) if (fieldOf(key) === field) increase += count - (was[index].get(key) ?? 0);
          if (increase > 0) {
            resumes++;
            places += increase;
          }
        });
        return { field, label: labelOf(field), resumes, places };
      });
  const restored = removed.map((field) => ({
    field,
    label: labelOf(field),
    resumes: was.filter((tokens) => [...tokens.keys()].some((key) => fieldOf(key) === field)).length,
  }));
  return { settings, store, documents: conflicts.length ? [] : changed, moved, restored, conflicts };
}

function mentions(documents: Located[], field: PrivateField, values: Iterable<string>): number {
  const patterns = [...values].flatMap((value) => patternFor(field, value) ?? []);
  if (!patterns.length) return 0;
  const regex = new RegExp(patterns.map((pattern) => `(?:${pattern})`).join('|'), 'gi');
  let count = 0;
  for (const document of documents) {
    const rest = structuredClone(document);
    (rest.data.basics as unknown as Record<string, string>)[field] = '';
    mapStrings(
      rest,
      (text) => {
        count += text.match(regex)?.length ?? 0;
        return text;
      },
      (key) => key === 'appearance',
    );
  }
  return count;
}

/** Replaces one stored value. The old value stays as an alias so older revisions keep being covered. */
export function setPrivateValue(
  settings: PrivacySettings,
  store: PrivateStore,
  key: string,
  raw: unknown,
): PrivateStore {
  const field = fieldOf(key);
  if (!settings.enabled || !field || key === 'link' || !settings.fields.includes(field))
    throw new ResumeError('VALIDATION_FAILED', `${key} 不是已开启的隐私字段`);
  if (field === 'links' && !Object.hasOwn(store.values, key))
    throw new ResumeError('VALIDATION_FAILED', `没有链接 ${key}；新链接请在简历里添加`);
  if (typeof raw !== 'string' || raw.length > (field === 'photo' ? 3 * 1024 * 1024 : 2000))
    throw new ResumeError('VALIDATION_FAILED', 'value 必须是字符串');
  const value = field === 'photo' ? raw : raw.trim();
  if (hasToken(value)) throw new ResumeError('VALIDATION_FAILED', '隐私信息里不能写占位');
  if (field === 'links' && [...value].length > LINK_LIMITS.url)
    throw new ResumeError('VALIDATION_FAILED', `链接最多 ${LINK_LIMITS.url} 个字符`);
  if (field === 'photo' && value && !/^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/]*={0,2}$/.test(value))
    throw new ResumeError('VALIDATION_FAILED', '照片必须为 PNG/JPEG/WebP data URL');
  const next = structuredClone(store);
  const old = next.values[key];
  if (old && old !== value && !next.aliases.some((alias) => alias.key === key && alias.value === old))
    next.aliases.push({ key, value: old });
  next.values[key] = value;
  next.aliases = next.aliases.filter((alias) => !(alias.key === key && alias.value === value));
  return next;
}

/** The private fields an export of this resume fills with a stored value, in the order the options list them. */
export function filledFields(document: Located, settings: PrivacySettings, store: PrivateStore): PrivateField[] {
  if (!settings.enabled) return [];
  const used = new Set([...countTokens(document).keys()].filter((key) => store.values[key]).map(fieldOf));
  return privateFieldOptions
    .map((option) => option.id)
    .filter((field) => settings.fields.includes(field) && used.has(field));
}

/**
 * What a client may know of the stored values: whether each is filled, and for the web page (detail) its length and
 * character shape for sizing a label, and a link's platform for its icon. Never the value.
 */
export function describePrivate(settings: PrivacySettings, store: PrivateStore, detail = true) {
  const shape = (value: string) => {
    const han = value.match(/\p{Script=Han}/gu)?.length ?? 0,
      digit = value.match(/\d/g)?.length ?? 0,
      latin = value.match(/[A-Za-z]/g)?.length ?? 0;
    return { han, digit, latin, other: [...value].length - han - digit - latin };
  };
  const describe = (field: PrivateField, value: string | undefined) =>
    !value
      ? { filled: false }
      : field === 'photo' || !detail
        ? { filled: true }
        : { filled: true, length: [...value].length, shape: shape(value) };
  const fields = settings.enabled ? settings.fields : [];
  return {
    fields: Object.fromEntries(
      fields.filter((field) => field !== 'links').map((field) => [field, describe(field, store.values[field])]),
    ),
    links: fields.includes('links')
      ? Object.entries(store.values)
          .filter(([key]) => fieldOf(key) === 'links')
          .map(([key, value]) => {
            const site = detail ? sitePlatform(value) : undefined;
            return { key, label: store.labels[key] ?? '', ...describe('links', value), ...(site && { site }) };
          })
      : [],
  };
}
