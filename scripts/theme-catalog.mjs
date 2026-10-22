import { readdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Built-in themes in display order; others follow alphabetically.
const order = ['standard', 'editorial', 'minimal'];
const required = [
  'id',
  'name',
  'description',
  'version',
  'engine',
  'skeleton',
  'tags',
  'traits',
  'defaults',
  'presets',
  'settings',
];
export async function discoverThemes(directory) {
  const themes = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory())) {
    const folder = path.join(directory, entry.name);
    let meta;
    try {
      meta = JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    // A theme package is manifest.json + theme.css; the full manifest rules are checked by the unit tests and `lulicv theme check`.
    try {
      await access(path.join(folder, 'theme.css'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      throw new Error(`Stylesheet missing: ${entry.name}`, { cause: error });
    }
    if (
      required.some((key) => !(key in meta)) ||
      meta.id !== entry.name ||
      !/^[a-z][a-z0-9-]{1,39}$/.test(meta.id) ||
      meta.engine !== 1 ||
      !Array.isArray(meta.presets) ||
      !meta.presets.length
    )
      throw new Error(`Invalid theme metadata: ${entry.name}`);
    if (themes.some((theme) => theme.id === meta.id)) throw new Error(`Duplicate theme ID: ${meta.id}`);
    themes.push(meta);
  }
  if (!themes.length) throw new Error('No themes discovered');
  const rank = (id) => (order.includes(id) ? order.indexOf(id) : order.length);
  return themes.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}
export async function generate(directory, output, check = false) {
  const content = JSON.stringify(await discoverThemes(directory), null, 2) + '\n';
  if (check) {
    if ((await readFile(output, 'utf8')) !== content) throw new Error('Theme catalog stale: npm run themes:generate');
  } else await writeFile(output, content);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await generate('src/themes', 'src/core/theme-catalog.generated.json', process.argv.includes('--check'));
