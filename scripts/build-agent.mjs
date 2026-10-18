import { build } from 'esbuild';
import { rawPlugin } from './esbuild-raw.mjs';
import { writeThirdPartyNotices } from './third-party-notices.mjs';
// Pure-JS dependencies are bundled: ajv alone is ~1500 small files, and agent sandboxes that broker
// every file access turned that into seconds of startup per command. Playwright stays external
// (it locates its browsers and driver relative to its own package) and is imported on demand.
const { version } = JSON.parse(await (await import('node:fs/promises')).readFile('package.json', 'utf8'));
let commit = '';
try {
  const { execFileSync } = await import('node:child_process');
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  // Uncommitted changes would make the commit claim more than it can prove.
  commit = git('rev-parse', '--short', 'HEAD') + (git('status', '--porcelain', '--untracked-files=no') ? '-dirty' : '');
} catch {
  /* Not a git checkout: the version alone identifies the build. */
}
const main = {
  plugins: [rawPlugin],
  define: { __RESUME_BUILD__: JSON.stringify({ version, commit }) },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['playwright', 'playwright-core'],
  sourcemap: true,
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
};
const bundled = [];
for (const [entry, outfile] of [
  ['agent/cli/index.ts', 'agent-dist/cli-main.mjs'],
  ['agent/mcp/index.ts', 'agent-dist/mcp-main.mjs'],
]) {
  const { metafile } = await build({ ...main, entryPoints: [entry], outfile, metafile: true });
  bundled.push(...Object.keys(metafile.inputs));
}

const { mkdir, copyFile, readFile, writeFile } = await import('node:fs/promises');
await mkdir('licenses', { recursive: true });
for (const [source, name] of [
  ['src/assets/fonts/LXGW-LICENSE.md', 'LXGW-LICENSE.md'],
  ['src/assets/fonts/THIRD_PARTY_FONTS.md', 'THIRD_PARTY_FONTS.md'],
  ['node_modules/misans/LICENSE', 'MiSans-LICENSE'],
  ['node_modules/@fontsource/noto-sans-sc/LICENSE', 'NotoSansSC-LICENSE'],
])
  await copyFile(source, `licenses/${name}`);
// `vite build` ran first (see the build script) and recorded the editor bundle's files.
const web = JSON.parse(await readFile('node_modules/.cache/cvslate/web-modules.json', 'utf8'));
await writeThirdPartyNotices([...bundled, ...web], 'licenses/THIRD_PARTY_NOTICES.md');
// npm swaps only registry.npmjs.org URLs for the user's configured registry, so a dependency locked while developing
// behind npmmirror would make every user outside China fetch it from npmmirror. Same tarballs, same integrity.
const shrinkwrap = JSON.parse(await readFile('package-lock.json', 'utf8'));
for (const [location, entry] of Object.entries(shrinkwrap.packages)) {
  if (!entry.resolved?.startsWith('https://')) continue;
  entry.resolved = entry.resolved.replace(/^https:\/\/registry\.npmmirror\.com\//, 'https://registry.npmjs.org/');
  if (!entry.resolved.startsWith('https://registry.npmjs.org/'))
    throw new Error(`${location} resolves outside registry.npmjs.org: ${entry.resolved}`);
}
await writeFile('npm-shrinkwrap.json', JSON.stringify(shrinkwrap, null, 2) + '\n');
await build({
  entryPoints: ['agent/cli/bootstrap.ts'],
  outfile: 'agent-dist/cli.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  packages: 'external',
});
await build({
  entryPoints: ['agent/mcp/bootstrap.ts'],
  outfile: 'agent-dist/mcp.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  packages: 'external',
});

await copyFile('src/core/theme-catalog.generated.json', 'schema/theme-catalog.json');
