import { lstat, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { reservedThemeIds } from '../../src/core/document';
import { errorMessage, ResumeError } from '../../src/core/errors';
import { checkThemePackage, THEME_ID } from '../../src/core/theme-package';
import type { ThemeManifest } from '../../src/core/theme-types';
import { syncDirectory } from '../runtime/files';

export interface ThemePackage {
  manifest: ThemeManifest;
  css: string;
}
export interface InvalidTheme {
  folder: string;
  errors: string[];
}

/**
 * Themes installed in this workspace, under themes/<id>/{manifest.json,theme.css}. They are read once
 * at startup and kept in memory (like the web assets, in case the sandbox later revokes file access);
 * installing and removing go through this store so memory and disk stay in step.
 */
export class ThemeStore {
  private readonly themes = new Map<string, ThemePackage>();
  readonly invalid: InvalidTheme[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(private readonly root: string) {}

  static async open(root: string): Promise<ThemeStore> {
    const store = new ThemeStore(root);
    const directory = path.join(root, 'themes');
    let entries;
    try {
      if ((await lstat(directory)).isSymbolicLink())
        throw new ResumeError('VALIDATION_FAILED', '工作区 themes 目录不能是符号链接');
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return store;
      throw error;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue;
      if (!entry.isDirectory()) {
        store.invalid.push({ folder: entry.name, errors: ['不是目录（符号链接不会被读取）'] });
        continue;
      }
      try {
        const theme = await readPackage(path.join(directory, entry.name));
        const { errors } = checkThemePackage(theme.manifest, theme.css, reservedThemeIds);
        if (theme.manifest?.id !== entry.name) errors.push(`目录名必须与 manifest.id 相同`);
        if (errors.length) store.invalid.push({ folder: entry.name, errors });
        else store.themes.set(entry.name, theme);
      } catch (error) {
        store.invalid.push({ folder: entry.name, errors: [errorMessage(error)] });
      }
    }
    return store;
  }

  list(): ThemeManifest[] {
    return [...this.themes.values()].map((theme) => theme.manifest);
  }
  get(id: string): ThemePackage | undefined {
    return this.themes.get(id);
  }

  /** Writes a checked package, replacing an installed theme with the same id (the old one goes to trash). */
  install(manifest: unknown, css: string): Promise<{ theme: ThemeManifest; replaced: boolean; warnings: string[] }> {
    return this.serialize(() => this.write(manifest, css));
  }

  /** Moves an installed theme to the workspace trash; resumes using it fall back to the default theme. */
  remove(id: string): Promise<void> {
    return this.serialize(async () => {
      if (!THEME_ID.test(id) || !(this.themes.has(id) || this.invalid.some((item) => item.folder === id)))
        throw new ResumeError('NOT_FOUND', `没有安装主题「${id}」`);
      await this.discard(id);
      this.dropInvalid(id);
    });
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.catch(() => {}).then(work);
    this.queue = result;
    return result;
  }

  private async write(
    manifest: unknown,
    css: string,
  ): Promise<{ theme: ThemeManifest; replaced: boolean; warnings: string[] }> {
    const { errors, warnings } = checkThemePackage(manifest, css, reservedThemeIds);
    if (errors.length) throw new ResumeError('VALIDATION_FAILED', `主题包未通过检查：\n${errors.join('\n')}`);
    const theme = manifest as ThemeManifest;
    const directory = await this.directory();
    const target = path.join(directory, theme.id);
    const staging = path.join(directory, `.${theme.id}-${randomUUID()}.tmp`);
    try {
      await mkdir(staging);
      await writeSynced(path.join(staging, 'manifest.json'), JSON.stringify(theme, null, 2) + '\n');
      await writeSynced(path.join(staging, 'theme.css'), css);
      await syncDirectory(staging);
      const replaced = await this.discard(theme.id);
      await rename(staging, target);
      await syncDirectory(directory);
      this.themes.set(theme.id, { manifest: structuredClone(theme), css });
      this.dropInvalid(theme.id);
      return { theme, replaced, warnings };
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  private async directory() {
    const directory = path.join(this.root, 'themes');
    await mkdir(directory, { recursive: true });
    if ((await lstat(directory)).isSymbolicLink())
      throw new ResumeError('VALIDATION_FAILED', '工作区 themes 目录不能是符号链接');
    return directory;
  }

  private async discard(id: string): Promise<boolean> {
    const current = path.join(this.root, 'themes', id);
    try {
      await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.themes.delete(id);
        return false;
      }
      throw error;
    }
    await rename(
      current,
      path.join(this.root, '.cvslate/trash', `theme-${id}-${Date.now()}-${randomUUID().slice(0, 8)}`),
    );
    await syncDirectory(path.join(this.root, 'themes'));
    this.themes.delete(id);
    return true;
  }

  private dropInvalid(id: string) {
    const index = this.invalid.findIndex((item) => item.folder === id);
    if (index >= 0) this.invalid.splice(index, 1);
  }
}

async function readPackage(directory: string): Promise<ThemePackage> {
  const read = async (name: string) => {
    const file = path.join(directory, name);
    const info = await lstat(file).catch(() => undefined);
    if (!info?.isFile()) throw new Error(`缺少 ${name}`);
    if (info.size > 1_000_000) throw new Error(`${name} 过大`);
    return readFile(file, 'utf8');
  };
  let manifest: ThemeManifest;
  try {
    manifest = JSON.parse(await read('manifest.json'));
  } catch (error) {
    throw error instanceof SyntaxError ? new Error('manifest.json 不是有效的 JSON') : error;
  }
  return { manifest, css: await read('theme.css') };
}

async function writeSynced(file: string, content: string) {
  const handle = await open(file, 'wx', 0o644);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}
