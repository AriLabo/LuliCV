// Regenerates the page screenshot baselines for this platform after an intended visual change.
// `npm run snapshots:update` writes the local baselines; add `-- --ci` to also write this platform's
// -ci baselines (used when CI cannot run). Inspect the images before committing them.
import { spawnSync } from 'node:child_process';
const runs = [{ label: 'local', env: { ...process.env, CI: '' } }];
if (process.argv.includes('--ci')) runs.push({ label: 'ci', env: { ...process.env, CI: '1' } });
for (const { label, env } of runs) {
  process.stderr.write(`Updating ${label} baselines for ${process.platform}…\n`);
  const result = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['playwright', 'test', 'e2e-studio/lulicv.spec.ts', '--workers=1', '--update-snapshots=all'],
    { stdio: 'inherit', env, shell: process.platform === 'win32' },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
process.stderr.write('Done. Review e2e-studio/lulicv.spec.ts-snapshots/ before committing.\n');
