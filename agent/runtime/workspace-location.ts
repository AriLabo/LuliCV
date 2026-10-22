import { homedir } from 'node:os';
import { mkdir, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { ResumeError } from '../../src/core/errors';
import { atomicWrite, initializeWorkspace } from '../bridge/workspace';

/**
 * The per-user directory LuliCV keeps its data in: each OS's application data directory, or
 * LULICV_HOME (tests, isolated setups). The Skill's scripts/runtime-location.mjs installs runtimes under
 * the same directory; a test keeps the two in step.
 */
export function dataHome(env = process.env, platform = process.platform, home = homedir()) {
  if (env.LULICV_HOME) return path.resolve(env.LULICV_HOME);
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'LuliCV');
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'LuliCV');
  // XDG requires an absolute path and says to ignore a relative one.
  const data =
    env.XDG_DATA_HOME && path.isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : path.join(home, '.local', 'share');
  return path.join(data, 'lulicv');
}

/** Where a command's workspace is and how it was found: `option` from --workspace, `chosen` by `lulicv workspace <directory>`. */
export interface WorkspaceLocation {
  directory: string;
  source: 'option' | 'chosen' | 'default';
}

const settingsFile = (env: NodeJS.ProcessEnv) => path.join(dataHome(env), 'settings.json');
const errorCode = (error: unknown) => (error as NodeJS.ErrnoException).code;

/**
 * Every client and session finds the same workspace without being told where it is: the one the user chose,
 * otherwise the default in the data directory. --workspace names another one for a single command.
 */
export async function locateWorkspace(option?: string, env = process.env): Promise<WorkspaceLocation> {
  if (option) return { directory: path.resolve(option), source: 'option' };
  const file = settingsFile(env);
  let settings: { workspace?: unknown } | null;
  try {
    settings = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { directory: path.join(dataHome(env), 'workspace'), source: 'default' };
    if (error instanceof SyntaxError) settings = {};
    else throw error;
  }
  if (typeof settings?.workspace !== 'string' || !path.isAbsolute(settings.workspace))
    throw new ResumeError(
      'STORAGE_FAILED',
      `${file} 已损坏，读不出选定的工作区；执行 lulicv workspace <directory> 重新选择`,
    );
  return { directory: settings.workspace, source: 'chosen' };
}

export async function isWorkspace(directory: string) {
  try {
    await readFile(path.join(directory, 'lulicv.json'));
    return true;
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') return false;
    throw error;
  }
}

// Files the OS drops into any folder it shows; a directory holding only these still counts as empty.
const SYSTEM_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

/** A workspace is created only in a new or empty directory, so it never mixes with the user's other files. */
async function createWorkspace(directory: string) {
  let entries: string[] = [];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (errorCode(error) === 'ENOTDIR') throw new ResumeError('VALIDATION_FAILED', `${directory} 是文件，不是目录`);
    if (errorCode(error) !== 'ENOENT') throw error;
  }
  if (entries.some((entry) => !SYSTEM_FILES.has(entry)))
    throw new ResumeError(
      'VALIDATION_FAILED',
      `${directory} 里已经有别的文件；工作区要放在新的或空的目录里，例如 ${path.join(directory, 'LuliCV')}`,
    );
  return await initializeWorkspace(directory);
}

/** The workspace's root. The default one and one named by --workspace are created on first use. */
export async function openWorkspace(location: WorkspaceLocation) {
  if (await isWorkspace(location.directory)) return await realpath(location.directory);
  // A chosen workspace that has gone missing was more likely moved, or is on a disk not connected, than
  // abandoned; an empty one created in its place would hide that.
  if (location.source === 'chosen')
    throw new ResumeError(
      'NOT_FOUND',
      `找不到选定的工作区 ${location.directory}：可能被移动了，或者所在的磁盘没有连接。确认后重试；要改用别的位置，执行 lulicv workspace <directory>`,
    );
  return await createWorkspace(location.directory);
}

/** Makes `directory` the workspace every later command uses: an existing workspace, or a new one created there. */
export async function chooseWorkspace(directory: string, env = process.env) {
  const target = path.resolve(directory);
  const root = (await isWorkspace(target)) ? await realpath(target) : await createWorkspace(target);
  await mkdir(dataHome(env), { recursive: true });
  await atomicWrite(settingsFile(env), { workspace: root });
  return root;
}
