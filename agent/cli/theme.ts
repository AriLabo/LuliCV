import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { reservedThemeIds, themeCatalog } from '../../src/core/document';
import { ResumeError } from '../../src/core/errors';
import type { LayoutReport } from '../../src/core/layout';
import { appearanceForTheme, checkThemePackage, THEME_ID } from '../../src/core/theme-package';
import type { ThemeManifest } from '../../src/core/theme-types';
import type { ResumeDocument } from '../../src/core/types';
import type { Runtime } from '../bridge/server';
import { builtinThemeCss } from './builtin-themes';
import { bridgeRequest } from './client';
import { writeOutput } from './output';

export const themeHelp =
  'theme new <id> [--from standard] [--name 名称] [--output DIR] | theme check <dir> [--images DIR] | theme install <dir> | theme remove <id> | theme use <简历 id> <主题 id>';

/** Reads manifest.json and theme.css from a theme folder; a manifest that is not JSON is reported like any other error. */
async function readPackage(directory: string): Promise<{ manifest: unknown; css: string; errors: string[] }> {
  const read = async (name: string) => {
    try {
      return await readFile(path.join(directory, name), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  };
  const [manifestText, css] = await Promise.all([read('manifest.json'), read('theme.css')]);
  const errors: string[] = [];
  if (manifestText === undefined) errors.push(`${directory} 里没有 manifest.json`);
  if (css === undefined) errors.push(`${directory} 里没有 theme.css`);
  let manifest: unknown;
  if (manifestText !== undefined) {
    try {
      manifest = JSON.parse(manifestText);
    } catch (error) {
      errors.push(`manifest.json 不是有效的 JSON：${error instanceof Error ? error.message : ''}`);
    }
  }
  return { manifest, css: css ?? '', errors };
}

/** Starts a theme folder from a built-in theme; nothing is installed until `lulicv theme install`. */
export async function newTheme(id: string | undefined, values: { from?: string; name?: string; output?: string }) {
  if (!id || !THEME_ID.test(id))
    throw new ResumeError('VALIDATION_FAILED', '需要主题 id：2–40 位小写字母、数字或连字符，并以字母开头');
  if (reservedThemeIds.includes(id))
    throw new ResumeError('VALIDATION_FAILED', `「${id}」已被内置主题占用，请换一个 id`);
  const from = values.from ?? 'standard';
  const base = themeCatalog.find((theme) => theme.id === from) as ThemeManifest | undefined;
  if (!base || !builtinThemeCss[from])
    throw new ResumeError(
      'VALIDATION_FAILED',
      `--from 必须是内置主题：${themeCatalog.map((theme) => theme.id).join('、')}`,
    );
  const name = values.name ?? id;
  const { author: _author, ...rest } = base;
  const manifest: ThemeManifest = {
    ...rest,
    id,
    name,
    description: `基于「${base.name}」的自定义主题。`,
    version: '0.1.0',
  };
  const errors = checkThemePackage(manifest, builtinThemeCss[from], reservedThemeIds).errors;
  if (errors.length) throw new ResumeError('VALIDATION_FAILED', errors.join('\n'));
  const directory = path.resolve(values.output ?? id);
  await mkdir(path.dirname(directory), { recursive: true });
  try {
    await mkdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new ResumeError('VALIDATION_FAILED', `${directory} 已存在；换一个 --output，或直接编辑那里的主题`);
    throw error;
  }
  const css = `/* ${name}：基于「${base.name}」。规则加载时嵌套在 .rs-theme--${id} 里，设置项以 &.rs-set-… 出现在根上。 */\n${builtinThemeCss[from].replace(/^\/\*.*\*\/\n/, '')}`;
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  await writeFile(path.join(directory, 'theme.css'), css, { flag: 'wx' });
  return {
    theme: id,
    from,
    directory,
    files: ['manifest.json', 'theme.css'],
    next: [`lulicv theme check ${directory} --images <目录>`, `lulicv theme install ${directory}`],
  };
}

interface CheckedSample {
  sample: string;
  name: string;
  maxPages: number;
  report: LayoutReport;
  pages?: string[];
}

/** Static checks, then the fictitious samples rendered by the Bridge with this theme; nothing is installed. */
export async function checkTheme(
  runtime: Runtime,
  root: string,
  directory: string | undefined,
  values: { images?: string },
) {
  if (!directory) throw new ResumeError('VALIDATION_FAILED', '需要主题目录：lulicv theme check <dir>');
  const read = await readPackage(path.resolve(directory));
  const checked = read.errors.length
    ? { errors: read.errors, warnings: [] }
    : checkThemePackage(read.manifest, read.css, reservedThemeIds);
  if (checked.errors.length) return { valid: false, passed: false, ...checked, samples: [] };
  const manifest = read.manifest as ThemeManifest;
  const result = (await (
    await bridgeRequest(
      runtime,
      '/api/themes/check',
      'POST',
      { manifest, css: read.css, images: Boolean(values.images) },
      180_000,
    )
  ).json()) as { warnings: string[]; samples: CheckedSample[] };
  const warnings = [...result.warnings];
  for (const sample of result.samples)
    if (sample.report.pageCount > sample.maxPages)
      warnings.push(
        `「${sample.name}」排成了 ${sample.report.pageCount} 页，预期不超过 ${sample.maxPages} 页：间距或字号可能偏大`,
      );
  let folder: string | undefined;
  if (values.images) {
    folder = path.join(path.resolve(values.images), `${manifest.id}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    await mkdir(folder, { recursive: true });
  }
  const samples = [];
  for (const sample of result.samples) {
    const images: string[] = [];
    for (const [index, page] of (sample.pages ?? []).entries())
      images.push(
        await writeOutput(
          root,
          path.join(folder!, `${sample.sample}-page-${index + 1}.jpg`),
          Buffer.from(page, 'base64'),
        ),
      );
    samples.push({
      sample: sample.sample,
      name: sample.name,
      pageCount: sample.report.pageCount,
      maxPages: sample.maxPages,
      issues: sample.report.issues.map((issue) => issue.message),
      ...(images.length ? { images } : {}),
    });
  }
  return {
    theme: manifest.id,
    valid: true,
    passed: samples.every((sample) => sample.issues.length === 0),
    errors: [],
    warnings,
    samples,
  };
}

export async function installTheme(runtime: Runtime, directory: string | undefined) {
  if (!directory) throw new ResumeError('VALIDATION_FAILED', '需要主题目录：lulicv theme install <dir>');
  const read = await readPackage(path.resolve(directory));
  if (read.errors.length) throw new ResumeError('VALIDATION_FAILED', read.errors.join('\n'));
  const result = (await (
    await bridgeRequest(runtime, '/api/themes', 'POST', { manifest: read.manifest, css: read.css })
  ).json()) as { theme: ThemeManifest; replaced: boolean; warnings: string[] };
  return {
    installed: result.theme.id,
    name: result.theme.name,
    version: result.theme.version,
    replaced: result.replaced,
    warnings: result.warnings,
  };
}

export async function removeTheme(runtime: Runtime, id: string | undefined) {
  if (!id || !THEME_ID.test(id)) throw new ResumeError('VALIDATION_FAILED', '需要已安装主题的 id');
  const result = (await (await bridgeRequest(runtime, `/api/themes/${id}`, 'DELETE', {})).json()) as {
    removed: string;
    usedBy: Array<{ id: string; name: string }>;
  };
  return {
    ...result,
    ...(result.usedBy.length
      ? { note: '这些简历仍记着该主题，现在以「标准」渲染；重新安装后恢复，或改用其他主题' }
      : {}),
  };
}

/** Switches a resume to a theme the way the editor does: the theme's first colour preset and font, the person's spacing kept. */
export async function applyTheme(runtime: Runtime, resumeId: string | undefined, themeId: string | undefined) {
  if (!resumeId || !themeId) throw new ResumeError('VALIDATION_FAILED', '用法：lulicv theme use <简历 id> <主题 id>');
  const { themes } = (await (await bridgeRequest(runtime, '/api/themes')).json()) as { themes: ThemeManifest[] };
  const manifest = themes.find((theme) => theme.id === themeId);
  if (!manifest)
    throw new ResumeError(
      'NOT_FOUND',
      `没有主题「${themeId}」；可用的有：${themes.map((theme) => theme.id).join('、')}`,
    );
  const route = `/api/resumes/${resumeId}`;
  const document = (await (await bridgeRequest(runtime, route)).json()) as ResumeDocument;
  // Like the editor, choosing the current theme again changes nothing; colour presets are changed with a patch.
  if (document.appearance.themeId === themeId)
    return { id: document.id, revision: document.revision, theme: themeId, changed: false };
  const appearance = appearanceForTheme(document.appearance, manifest);
  const updated = (await (
    await bridgeRequest(runtime, route, 'PATCH', {
      baseRevision: document.revision,
      mutationId: randomUUID(),
      operations: [{ op: 'replace', path: '/appearance', value: appearance }],
    })
  ).json()) as ResumeDocument;
  return {
    id: updated.id,
    revision: updated.revision,
    theme: themeId,
    changed: true,
    preset: appearance.preset,
    accentColor: appearance.layout.accentColor,
    ...(appearance.layout.fontFamily ? { fontFamily: appearance.layout.fontFamily } : {}),
    kept: '页边距、字号、行高、栏目间距、密度和照片开关未改动',
  };
}
