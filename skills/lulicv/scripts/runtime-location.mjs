// Shared by the installer and the entry: each device computes where its runtimes live, so nothing has to remember a path.
import { readFile, readdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

// Each OS's per-user application data directory; LULICV_HOME moves everything elsewhere (tests, isolated setups).
export function runtimeRoot(env = process.env, platform = process.platform, home = homedir()) {
  if (env.LULICV_HOME) return path.join(path.resolve(env.LULICV_HOME), 'runtime');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'LuliCV', 'runtime');
  if (platform === 'win32')
    return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'LuliCV', 'runtime');
  // XDG requires an absolute path and says to ignore a relative one.
  const data =
    env.XDG_DATA_HOME && path.isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : path.join(home, '.local', 'share');
  return path.join(data, 'lulicv', 'runtime');
}

// Committed beside this file and bumped with package.json (agent/runtime/installer.test.ts checks they agree), so a
// Skill fetched file by file from the repository knows which runtime it needs. Missing only from an incomplete copy.
export async function skillVersion() {
  try {
    return JSON.parse(await readFile(new URL('./release.json', import.meta.url), 'utf8')).version;
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

// A runtime counts as installed only once its install.json exists, which the installer writes before the final rename.
export async function readInstall(directory) {
  try {
    return JSON.parse(await readFile(path.join(directory, 'install.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return undefined;
    throw error;
  }
}

// Keep the new version and the most recently installed other one (to step back to); older ones only take disk space.
// A directory still in use (Windows locks running files) is left in place and reported.
export async function removeOlder(root, version) {
  const others = [];
  for (const name of await readdir(root)) {
    if (name === version || name.startsWith('.')) continue;
    const install = await readInstall(path.join(root, name)).catch(() => undefined);
    if (install) others.push({ name, installedAt: String(install.installedAt ?? '') });
  }
  others.sort((a, b) => b.installedAt.localeCompare(a.installedAt));
  const removed = [],
    kept = [];
  for (const { name } of others.slice(1)) {
    try {
      await rm(path.join(root, name), { recursive: true });
      removed.push(name);
    } catch {
      kept.push(name);
    }
  }
  return { removed, kept };
}
