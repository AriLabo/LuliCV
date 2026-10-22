import { mkdtemp, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { chooseWorkspace, isWorkspace, locateWorkspace, openWorkspace } from './workspace-location';

let root: string;
let env: NodeJS.ProcessEnv;
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'resume-location-')));
  env = { LULICV_HOME: path.join(root, 'home') };
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it('uses the default workspace in the data directory until one is chosen, creating it on first use', async () => {
  const location = await locateWorkspace(undefined, env);
  expect(location).toEqual({ directory: path.join(root, 'home', 'workspace'), source: 'default' });
  expect(await isWorkspace(location.directory)).toBe(false);
  expect(await openWorkspace(location)).toBe(location.directory);
  expect(await isWorkspace(location.directory)).toBe(true);
  // Opening it again reuses it.
  expect(await openWorkspace(location)).toBe(location.directory);
});

it('creates a workspace only in a new or empty directory, ignoring the files an OS drops into folders', async () => {
  const empty = path.join(root, 'empty');
  await mkdir(empty);
  await writeFile(path.join(empty, '.DS_Store'), '');
  expect(await openWorkspace({ directory: empty, source: 'option' })).toBe(empty);
  const used = path.join(root, 'used');
  await mkdir(used);
  await writeFile(path.join(used, 'notes.txt'), 'fictitious');
  await expect(chooseWorkspace(used, env)).rejects.toMatchObject({
    code: 'VALIDATION_FAILED',
    message: expect.stringContaining(path.join(used, 'LuliCV')),
  });
  await expect(chooseWorkspace(path.join(used, 'notes.txt'), env)).rejects.toMatchObject({
    code: 'VALIDATION_FAILED',
    message: expect.stringContaining('不是目录'),
  });
  // A refused choice leaves the previous one in place.
  expect((await locateWorkspace(undefined, env)).source).toBe('default');
});

it('remembers the chosen workspace, accepts an existing one and reports one that has gone missing', async () => {
  const chosen = path.join(root, 'chosen');
  expect(await chooseWorkspace(chosen, env)).toBe(chosen);
  expect(await locateWorkspace(undefined, env)).toEqual({ directory: chosen, source: 'chosen' });
  // --workspace still names another one for a single command.
  expect((await locateWorkspace(path.join(root, 'other'), env)).source).toBe('option');
  // Moving the folder and choosing its new place keeps the same workspace.
  const moved = path.join(root, 'moved');
  await rename(chosen, moved);
  await expect(openWorkspace(await locateWorkspace(undefined, env))).rejects.toMatchObject({
    code: 'NOT_FOUND',
    message: expect.stringContaining('lulicv workspace <directory>'),
  });
  await expect(isWorkspace(chosen)).resolves.toBe(false);
  const manifest = await readFile(path.join(moved, 'lulicv.json'), 'utf8');
  expect(await chooseWorkspace(moved, env)).toBe(moved);
  expect(await openWorkspace(await locateWorkspace(undefined, env))).toBe(moved);
  expect(await readFile(path.join(moved, 'lulicv.json'), 'utf8')).toBe(manifest);
});

it('asks for a new choice when the settings file is damaged', async () => {
  await mkdir(path.join(root, 'home'));
  for (const content of ['{', '{"workspace": "relative"}', '[]', 'null']) {
    await writeFile(path.join(root, 'home', 'settings.json'), content);
    await expect(locateWorkspace(undefined, env)).rejects.toMatchObject({
      code: 'STORAGE_FAILED',
      message: expect.stringContaining('lulicv workspace <directory>'),
    });
  }
});
