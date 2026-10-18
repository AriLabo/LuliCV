import { test, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { themeCatalog } from '../../src/core/document';
// The generator is also exercised by every build/test entry point.
const { pathToFileURL } = await import('node:url');
const modulePath = pathToFileURL(path.join(process.cwd(), 'scripts/theme-catalog.mjs')).href;
const { generate } = await import(/* @vite-ignore */ modulePath);
test('discovery accepts new themes, rejects duplicates, missing stylesheets and stale catalog', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'resume-themes-'));
  const output = path.join(root, 'catalog.json');
  try {
    const add = async (folder: string, id: string) => {
      await mkdir(path.join(root, folder));
      await writeFile(path.join(root, folder, 'theme.css'), '.rs-name { color: red; }');
      await writeFile(path.join(root, folder, 'manifest.json'), JSON.stringify({ ...themeCatalog[0], id }));
    };
    await add('new-theme', 'new-theme');
    await generate(root, output);
    expect(JSON.parse(await readFile(output, 'utf8'))[0].id).toBe('new-theme');
    await generate(root, output, true);
    await writeFile(output, '[]');
    await expect(generate(root, output, true)).rejects.toThrow('stale');
    await add('duplicate', 'new-theme');
    await expect(generate(root, output)).rejects.toThrow('Invalid theme metadata');
    await rm(path.join(root, 'duplicate'), { recursive: true });
    await writeFile(path.join(root, 'new-theme/manifest.json'), JSON.stringify({ ...themeCatalog[0], id: 123 }));
    await expect(generate(root, output)).rejects.toThrow('Invalid theme metadata');
    await writeFile(
      path.join(root, 'new-theme/manifest.json'),
      JSON.stringify({ ...themeCatalog[0], id: 'new-theme' }),
    );
    await rm(path.join(root, 'new-theme/theme.css'));
    await expect(generate(root, output)).rejects.toThrow('Stylesheet missing');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
