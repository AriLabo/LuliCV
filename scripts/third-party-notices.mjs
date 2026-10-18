import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
// licenses/THIRD_PARTY_NOTICES.md: every npm package whose code ends up inside agent-dist/ or dist/, with its
// license text. Playwright is installed as a dependency, not bundled, and ships its own license.

/** The package directory (`node_modules/<name>` or `node_modules/@scope/<name>`) a bundled file comes from. */
function packageDir(file) {
  const parts = file.replaceAll('\\', '/').replace(/^\0/, '').split('/');
  const at = parts.lastIndexOf('node_modules');
  if (at < 0) return undefined;
  const length = parts[at + 1]?.startsWith('@') ? 3 : 2;
  return parts.slice(0, at + length).join('/');
}

export async function writeThirdPartyNotices(files, out) {
  const packages = new Map();
  for (const dir of new Set(files.map(packageDir).filter(Boolean))) {
    const manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
    if (!manifest.name || !manifest.version) throw new Error(`${dir}/package.json has no name or version`);
    const licenseFile = (await readdir(dir)).find((name) => /^(licen[cs]e|copying)(\.|$)/i.test(name));
    if (!licenseFile)
      throw new Error(`${manifest.name} is bundled but has no license file; add its license text by hand`);
    const key = `${manifest.name}@${manifest.version}`;
    packages.set(key, {
      key,
      license: typeof manifest.license === 'string' ? manifest.license : 'see text',
      text: (await readFile(path.join(dir, licenseFile), 'utf8')).trim(),
    });
  }
  const sorted = [...packages.values()].sort((a, b) => a.key.localeCompare(b.key));
  const body = sorted
    .map((item) => `## ${item.key}\n\nLicense: ${item.license}\n\n\`\`\`text\n${item.text}\n\`\`\``)
    .join('\n\n');
  await writeFile(
    out,
    `# Third-party notices\n\nCVSlate bundles the following npm packages into \`agent-dist/\` and \`dist/\`. Fonts are listed in THIRD_PARTY_FONTS.md.\n\n${body}\n`,
  );
  return sorted.length;
}
