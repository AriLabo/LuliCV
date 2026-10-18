import { fontIds } from './fonts';
import { layoutRanges } from './defaults';
import type { ThemeManifest } from './theme-types';
import type { Appearance } from './types';

// A theme is data: manifest.json plus a stylesheet over the skeleton contract. Nothing in it runs as
// code, so themes made by agents or shared by others can be checked and installed safely.

export const THEME_ID = /^[a-z][a-z0-9-]{1,39}$/;
const SETTING_ID = /^[a-z][a-z0-9]{0,23}$/;
const COLOR = /^#[0-9a-f]{6}$/i;
export const MAX_THEME_CSS = 100_000;
/** A resume's own stylesheet (appearance.css) is for a few adjustments, not a whole look. */
export const MAX_APPEARANCE_CSS = 20_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const text = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;

/** Errors in a manifest, each naming the field; empty when the manifest is usable. */
export function validateThemeManifest(value: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(value)) return ['manifest 必须是对象'];
  const allowed = [
    'id',
    'name',
    'description',
    'version',
    'engine',
    'skeleton',
    'author',
    'license',
    'tags',
    'traits',
    'defaults',
    'presets',
    'settings',
  ];
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`manifest.${key} 不是已知字段`);
  if (typeof value.id !== 'string' || !THEME_ID.test(value.id))
    errors.push('manifest.id 必须是 2–40 位小写字母、数字或连字符，并以字母开头');
  if (!text(value.name, 40)) errors.push('manifest.name 必须是不超过 40 字的名称');
  if (!text(value.description, 200)) errors.push('manifest.description 必须是不超过 200 字的一句话描述');
  if (typeof value.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.version))
    errors.push('manifest.version 必须是 x.y.z');
  if (value.engine !== 1) errors.push('manifest.engine 必须是 1');
  if (value.skeleton !== 'single') errors.push('manifest.skeleton 目前只支持 single');
  for (const key of ['author', 'license'] as const)
    if (value[key] !== undefined && !text(value[key], 100)) errors.push(`manifest.${key} 必须是不超过 100 字的文本`);
  if (!Array.isArray(value.tags) || value.tags.length > 8 || value.tags.some((tag) => !text(tag, 12)))
    errors.push('manifest.tags 必须是最多 8 个、每个不超过 12 字的标签');
  if (
    !isObject(value.traits) ||
    typeof value.traits.photo !== 'boolean' ||
    typeof value.traits.atsFriendly !== 'boolean'
  )
    errors.push('manifest.traits 需要 photo 和 atsFriendly 两个布尔值');
  const defaults = value.defaults;
  if (!isObject(defaults)) errors.push('manifest.defaults 必须是对象');
  else {
    for (const [key, { min, max, unit }] of Object.entries(layoutRanges)) {
      const number = defaults[key];
      if (typeof number !== 'number' || number < min || number > max)
        errors.push(`manifest.defaults.${key} 必须在 ${min}–${max} ${unit} 之间`);
    }
    if (typeof defaults.photoEnabled !== 'boolean') errors.push('manifest.defaults.photoEnabled 必须是布尔值');
  }
  const settings = Array.isArray(value.settings) ? value.settings : (errors.push('manifest.settings 必须是数组'), []);
  const settingIds = new Set<string>();
  settings.forEach((setting, index) => {
    const at = `manifest.settings[${index}]`;
    if (
      !isObject(setting) ||
      typeof setting.id !== 'string' ||
      !SETTING_ID.test(setting.id) ||
      settingIds.has(setting.id)
    ) {
      errors.push(`${at}.id 必须是唯一的小写字母数字标识`);
      return;
    }
    settingIds.add(setting.id);
    if (!text(setting.label, 20)) errors.push(`${at}.label 必须是不超过 20 字的名称`);
    if (setting.type === 'toggle') {
      if (typeof setting.default !== 'boolean') errors.push(`${at}.default 必须是布尔值`);
    } else if (setting.type === 'select') {
      const options = Array.isArray(setting.options) ? setting.options : [];
      if (
        options.length < 2 ||
        options.length > 8 ||
        options.some(
          (option) =>
            !isObject(option) ||
            typeof option.value !== 'string' ||
            !SETTING_ID.test(option.value) ||
            !text(option.label, 20),
        )
      )
        errors.push(`${at}.options 需要 2–8 个选项，每项有 value（小写字母数字）和 label`);
      else if (!options.some((option) => (option as { value: string }).value === setting.default))
        errors.push(`${at}.default 必须是其中一个选项`);
    } else errors.push(`${at}.type 必须是 select 或 toggle`);
  });
  const presets = Array.isArray(value.presets) ? value.presets : [];
  if (presets.length < 1 || presets.length > 8) errors.push('manifest.presets 需要 1–8 个预设，第一个为默认');
  const presetIds = new Set<string>();
  presets.forEach((preset, index) => {
    const at = `manifest.presets[${index}]`;
    if (!isObject(preset) || typeof preset.id !== 'string' || !SETTING_ID.test(preset.id) || presetIds.has(preset.id)) {
      errors.push(`${at}.id 必须是唯一的小写字母数字标识`);
      return;
    }
    presetIds.add(preset.id);
    if (!text(preset.name, 20)) errors.push(`${at}.name 必须是不超过 20 字的名称`);
    if (typeof preset.accentColor !== 'string' || !COLOR.test(preset.accentColor))
      errors.push(`${at}.accentColor 必须是六位颜色`);
    if (
      preset.fontFamily !== undefined &&
      (typeof preset.fontFamily !== 'string' || !fontIds.includes(preset.fontFamily))
    )
      errors.push(`${at}.fontFamily 必须是 ${fontIds.join('、')} 之一`);
    if (
      preset.settings !== undefined &&
      (!isObject(preset.settings) || Object.keys(preset.settings).some((key) => !settingIds.has(key)))
    )
      errors.push(`${at}.settings 只能设置 manifest.settings 里声明过的项`);
  });
  return errors;
}

/** Removes comments and the contents of quoted strings, keeping the quotes, so checks see only CSS syntax. */
function cssSyntax(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, (quoted) => quoted[0] + quoted[0]);
}

/**
 * Problems in a theme stylesheet, or in a resume's own (file names it in the messages). Neither may
 * reach outside the page: no imports, no remote or local files, no font loading (fonts come from
 * installed font packs). Small inline SVG or PNG data URLs for decoration are allowed.
 */
export function scanThemeCss(css: string, file = 'theme.css', maxLength = MAX_THEME_CSS): string[] {
  const errors: string[] = [];
  if (css.length > maxLength) errors.push(`${file} 超过 ${maxLength / 1000} KB`);
  const body = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const syntax = cssSyntax(css);
  // CSS escapes (\75rl, @\69mport) would let a forbidden word past the checks below; stylesheets never need them outside strings.
  if (syntax.includes('\\')) errors.push(`${file} 只能在引号字符串里使用反斜杠转义`);
  if (/\/\*/.test(syntax) || /["']/.test(syntax.replace(/""|''/g, ''))) errors.push(`${file} 有未闭合的注释或字符串`);
  if (/@import\b/i.test(syntax)) errors.push(`${file} 不能使用 @import`);
  if (/@font-face\b/i.test(syntax)) errors.push(`${file} 不能声明 @font-face；字体请用内置字体或字体包`);
  if (/@namespace\b|@document\b|expression\s*\(|-moz-binding|behavior\s*:/i.test(syntax))
    errors.push(`${file} 包含不允许的写法`);
  if (/(^|[^a-z0-9-])(src|image|cross-fade|element)\s*\(/i.test(syntax))
    errors.push(`${file} 不能使用 src()、image()、cross-fade() 或 element()`);
  const urls = [...syntax.matchAll(/\burl\s*\(/gi)].length;
  const targets = [...body.matchAll(/\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^"')\s]*))\s*\)/gi)];
  if (targets.length !== urls) errors.push(`${file} 中有无法识别的 url() 写法`);
  for (const match of targets) {
    const target = (match[1] ?? match[2] ?? match[3]).trim();
    if (!/^data:image\/(svg\+xml|png)[;,]/i.test(target))
      errors.push(`${file} 只允许内联的 SVG/PNG 图片，不能引用 ${target.slice(0, 60)}`);
    else if (target.length > 20_000) errors.push(`${file} 中的内联图片过大（超过 20 KB）`);
    else if (/^data:image\/svg\+xml/i.test(target) && /(href|src)\s*=|url\s*\(|@import/i.test(decodeDataUrl(target)))
      errors.push(`${file} 中的内联 SVG 不能再引用其他资源`);
  }
  if (/\bimage-set\s*\(/i.test(syntax)) errors.push(`${file} 不能使用 image-set`);
  // The stylesheet is wrapped in a root selector (the theme's, or the resume's); a stray closing brace would let rules escape it.
  let depth = 0,
    escapes = false;
  for (const character of syntax) {
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth < 0) escapes = true;
    }
  }
  if (depth !== 0 || escapes) errors.push(`${file} 的大括号不成对`);
  return errors;
}

function decodeDataUrl(url: string): string {
  const comma = url.indexOf(',');
  const payload = url.slice(comma + 1);
  try {
    return /;base64,/i.test(url.slice(0, comma + 1)) ? atob(payload) : decodeURIComponent(payload);
  } catch {
    return payload;
  }
}

/** The class names and variables the engine-1 skeleton renders (see src/themes/skeleton.tsx). */
export const SKELETON_CLASSES = [
  'rs-theme',
  'rs-header',
  'rs-header--photo',
  'rs-identity',
  'rs-name',
  'rs-headline',
  'rs-contacts',
  'rs-contact',
  'rs-contact-icon',
  'rs-contact-label',
  'rs-contact-value',
  'rs-details',
  'rs-detail',
  'rs-detail-label',
  'rs-detail-value',
  'rs-photo',
  'rs-section-title',
  'rs-section-index',
  'rs-section-rule',
  'rs-entry-head',
  'rs-entry-main',
  'rs-entry-title',
  'rs-entry-subtitle',
  'rs-entry-meta',
  'rs-entry-location',
  'rs-entry-date',
  'rs-summary',
  'rs-description',
  'rs-bullet',
  'rs-bullet-mark',
  'rs-skill',
  'rs-skill-category',
  'rs-skill-items',
];
export const SKELETON_VARIABLES = [
  '--rs-accent',
  '--rs-font-size',
  '--rs-line-height',
  '--rs-section-space',
  '--rs-page-margin',
  '--rs-font-family',
];

/**
 * Things in a valid stylesheet that are probably mistakes: selectors the skeleton never renders,
 * variables nobody sets, and saturated colours written by hand (they ignore the person's colour choice).
 */
function lintCss(css: string, knownClass: (name: string) => boolean, unknownClass: string, owner: string): string[] {
  const warnings = new Set<string>();
  const syntax = cssSyntax(css);
  for (const [, name] of syntax.matchAll(/\.(rs-[a-z0-9_-]+)/gi))
    if (!knownClass(name)) warnings.add(`.${name} ${unknownClass}，这条规则不会生效`);
  const defined = new Set([...syntax.matchAll(/(--[a-z0-9_-]+)\s*:/gi)].map((match) => match[1]));
  for (const [, name] of syntax.matchAll(/var\(\s*(--[a-z0-9_-]+)/gi))
    if (!SKELETON_VARIABLES.includes(name) && !defined.has(name))
      warnings.add(`var(${name}) 既不是骨架变量，也没有在${owner}里定义`);
  for (const [color] of syntax.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi)) {
    const hex =
      color.length === 4
        ? color
            .slice(1)
            .split('')
            .map((digit) => digit + digit)
            .join('')
        : color.slice(1);
    const [r, g, b] = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
    if (Math.max(r, g, b) - Math.min(r, g, b) > 48)
      warnings.add(`${color} 是写死的彩色；强调色请用 var(--rs-accent)，否则换配色时它不会跟着变`);
  }
  return [...warnings];
}

export function lintThemeCss(css: string, manifest: Pick<ThemeManifest, 'settings'>): string[] {
  const settingClasses = manifest.settings.flatMap((setting) =>
    setting.type === 'toggle'
      ? [`rs-set-${setting.id}`]
      : (setting.options ?? []).map((option) => `rs-set-${setting.id}-${option.value}`),
  );
  const known = new Set([...SKELETON_CLASSES, ...settingClasses]);
  return lintCss(css, (name) => known.has(name), '不是骨架里的类名，也不是 manifest 声明的设置', '主题');
}

/** The same checks for a resume's own stylesheet. It stays when the theme changes, so it may target any theme's root or settings classes. */
export function lintAppearanceCss(css: string): string[] {
  return lintCss(
    css,
    (name) => SKELETON_CLASSES.includes(name) || /^rs-(theme--|set-)/.test(name),
    '不是骨架里的类名',
    '自定义样式',
  ).map((warning) => `appearance.css：${warning}`);
}

/**
 * Everything wrong with a theme package (errors block installing) and what looks like a mistake
 * (warnings). reservedIds are the built-in theme ids.
 */
export function checkThemePackage(
  manifest: unknown,
  css: string,
  reservedIds: string[],
): { errors: string[]; warnings: string[] } {
  const errors = [...validateThemeManifest(manifest), ...scanThemeCss(css)];
  const id = (manifest as { id?: unknown } | null)?.id;
  if (typeof id === 'string' && reservedIds.includes(id)) errors.push(`manifest.id「${id}」已被内置主题占用，请换一个`);
  const warnings = errors.length ? [] : lintThemeCss(css, manifest as ThemeManifest);
  return { errors, warnings };
}

/** Wraps a stylesheet so every rule applies only inside pages using this theme (native CSS nesting). */
export function scopeThemeCss(id: string, css: string): string {
  return `.rs-theme--${id} {\n${css}\n}\n`;
}

export function themeDefaults(manifest: ThemeManifest) {
  const preset = manifest.presets[0];
  return {
    ...manifest.defaults,
    accentColor: preset.accentColor,
    ...(preset.fontFamily ? { fontFamily: preset.fontFamily } : {}),
  };
}

/**
 * The appearance after switching to a theme: its first preset's colour and font (they are part of the
 * theme's look) and its default settings, while the person's spacing, density and photo choice stay.
 */
export function appearanceForTheme(appearance: Appearance, manifest: ThemeManifest): Appearance {
  const preset = manifest.presets[0];
  const layout = { ...appearance.layout, accentColor: preset.accentColor };
  if (preset.fontFamily) layout.fontFamily = preset.fontFamily;
  else delete layout.fontFamily;
  return { ...appearance, themeId: manifest.id, preset: preset.id, settings: { ...preset.settings }, layout };
}

/** The preset whose colour (and font, when it sets one) the appearance currently matches, if any. */
export function matchingPreset(appearance: Appearance, manifest: ThemeManifest) {
  const matches = manifest.presets.filter(
    (preset) =>
      preset.accentColor.toLowerCase() === appearance.layout.accentColor.toLowerCase() &&
      (!preset.fontFamily || preset.fontFamily === appearance.layout.fontFamily),
  );
  return matches.find((preset) => preset.id === appearance.preset) ?? matches[0];
}
