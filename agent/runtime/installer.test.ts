import { expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, readdir, rm, mkdir, cp, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
const execute = promisify(execFile);
const scripts = path.resolve('skills/lulicv/scripts');
import { dataHome } from './workspace-location';
const { runtimeRoot, removeOlder } = await import(pathToFileURL(path.join(scripts, 'runtime-location.mjs')).href);
// A minimal npm tarball: a manifest and a cli.mjs that answers doctor, which is all the installer touches.
async function tarball(root: string, version: string, doctorReport?: unknown) {
  const source = path.join(root, `pack-${version}`);
  await mkdir(path.join(source, 'package/agent-dist'), { recursive: true });
  await writeFile(path.join(source, 'package/package.json'), JSON.stringify({ name: '@arilabo/lulicv', version }));
  await writeFile(
    path.join(source, 'package/agent-dist/cli.mjs'),
    doctorReport === undefined
      ? `process.stdout.write(JSON.stringify({ ok: true, version: ${JSON.stringify(version)}, args: process.argv.slice(2) }));`
      : `process.stdout.write(${JSON.stringify(JSON.stringify(doctorReport))});`,
  );
  const archive = path.join(root, `arilabo-lulicv-${version}.tgz`);
  await execute('tar', ['-czf', archive, '-C', source, 'package']);
  return archive;
}
// A copy of the Skill's scripts that pairs with the given runtime version, or with none when version is undefined.
async function skillCopy(root: string, version: string | undefined) {
  const skill = path.join(root, `skill-${version ?? 'none'}`);
  await cp(scripts, skill, { recursive: true });
  if (version) await writeFile(path.join(skill, 'release.json'), JSON.stringify({ version }));
  else await rm(path.join(skill, 'release.json'));
  return skill;
}
// Serves @arilabo/lulicv's packument and tarballs the way an npm registry does; anything else is a 404.
async function registry(archives: Record<string, string>) {
  const versions: Record<string, unknown> = {},
    files: Record<string, Buffer> = {};
  const server = createServer((request, response) => {
    const { origin } = new URL(`http://${request.headers.host}`);
    if (request.url === '/@arilabo%2flulicv') {
      for (const [version, data] of Object.entries(files))
        versions[version] = {
          name: '@arilabo/lulicv',
          version,
          dist: {
            tarball: `${origin}/@arilabo/lulicv/-/lulicv-${version}.tgz`,
            integrity: `sha512-${createHash('sha512').update(data).digest('base64')}`,
          },
        };
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({ name: '@arilabo/lulicv', 'dist-tags': { latest: Object.keys(files).at(-1) }, versions }),
      );
      return;
    }
    const version = request.url?.match(/^\/@arilabo\/lulicv\/-\/lulicv-(.+)\.tgz$/)?.[1];
    if (version && files[version]) {
      response.end(files[version]);
      return;
    }
    response.statusCode = 404;
    response.end('{}');
  });
  for (const [version, archive] of Object.entries(archives)) files[version] = await readFile(archive);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
it('the committed Skill pairs with the runtime version in package.json', async () => {
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  expect(JSON.parse(await readFile(path.join(scripts, 'release.json'), 'utf8'))).toEqual({ version });
});
it('finds runtimes in each OS per-user data directory, or LULICV_HOME, beside the default workspace', () => {
  const cases: [NodeJS.ProcessEnv, NodeJS.Platform, string, string][] = [
    [{}, 'darwin', '/Users/a', path.join('/Users/a', 'Library', 'Application Support', 'LuliCV')],
    [
      { LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' },
      'win32',
      'C:\\Users\\a',
      path.join('C:\\Users\\a\\AppData\\Local', 'LuliCV'),
    ],
    [{}, 'win32', 'C:\\Users\\a', path.join('C:\\Users\\a', 'AppData', 'Local', 'LuliCV')],
    [{}, 'linux', '/home/a', path.join('/home/a', '.local', 'share', 'lulicv')],
    [{ XDG_DATA_HOME: '/data' }, 'linux', '/home/a', path.join('/data', 'lulicv')],
    [{ XDG_DATA_HOME: 'relative' }, 'linux', '/home/a', path.join('/home/a', '.local', 'share', 'lulicv')],
    [{ LULICV_HOME: '/isolated' }, 'darwin', '/Users/a', path.resolve('/isolated')],
  ];
  // The Skill's script and the runtime compute the same directory independently, so they must agree.
  for (const [env, platform, home, expected] of cases) {
    expect(dataHome(env, platform, home)).toBe(expected);
    expect(runtimeRoot(env, platform, home)).toBe(path.join(expected, 'runtime'));
  }
});
it('private installer rejects a checksum failure from any mirror and a package of another version without touching the runtime directory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'resume-installer-'));
  try {
    const home = path.join(root, '中文 数据');
    const env = { ...process.env, LULICV_HOME: home };
    const archive = await tarball(root, '1.2.0');
    const paired = await skillCopy(root, '1.2.0');
    const mock = path.join(root, 'network.mjs');
    await writeFile(mock, "globalThis.fetch = async () => new Response('corrupt archive');");
    // --import takes a module specifier: a raw Windows path is parsed as the URL scheme 'c:',
    // so the mock must be handed over as a file:// URL on every platform.
    const mockURL = pathToFileURL(mock).href;
    // A user-chosen mirror is held to the same pinned hash as nodejs.org.
    for (const mirror of [[], ['--node-mirror', 'https://mirror.example.com/node/']]) {
      const failed = execute(
        process.execPath,
        [
          '--import',
          mockURL,
          path.join(paired, 'install-runtime.mjs'),
          '--private-node',
          ...mirror,
          '--package',
          archive,
        ],
        { env },
      );
      await expect(failed).rejects.toMatchObject({
        code: 1,
        stdout: '',
        stderr: expect.stringContaining('checksum mismatch'),
      });
      await expect(failed).rejects.toMatchObject({
        stderr: expect.stringContaining(
          mirror.length ? 'https://mirror.example.com/node/v22.22.3/' : 'https://nodejs.org/dist/v22.22.3/',
        ),
      });
    }
    expect(await readdir(path.join(home, 'runtime'))).toEqual([]);
    // The Skill installs only the runtime of its own version, and an incomplete copy installs nothing.
    const skill = await skillCopy(root, '1.3.0');
    await expect(
      execute(process.execPath, [path.join(skill, 'install-runtime.mjs'), '--package', archive], { env }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringMatching(/install arilabo-lulicv-1\.3\.0\.tgz.*install the Skill of [^ ]+ \(lulicv-skill-/),
    });
    await expect(
      execute(process.execPath, [path.join(await skillCopy(root, undefined), 'install-runtime.mjs')], { env }),
    ).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('scripts/release.json is missing') });
    await writeFile(path.join(root, 'not-a-package.tgz'), 'fixture');
    await expect(
      execute(
        process.execPath,
        [path.join(skill, 'install-runtime.mjs'), '--package', path.join(root, 'not-a-package.tgz')],
        { env },
      ),
    ).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('LuliCV .tgz') });
    expect(await readdir(path.join(home, 'runtime'))).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('the Skill entry runs the runtime of its own version, says which package is missing otherwise, and an install keeps one older version', async () => {
  // Node reports a script's real path, and the macOS temp directory sits behind a symlink.
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'resume-entry-')));
  try {
    const home = path.join(root, 'home');
    const env = { ...process.env, LULICV_HOME: home };
    const skill = await skillCopy(root, '1.3.0');
    // Fake installed runtimes: an install.json and a cli.mjs that echoes its arguments.
    const fake = async (version: string, installedAt: string) => {
      const app = path.join(home, 'runtime', version, 'app/node_modules/@arilabo/lulicv/agent-dist');
      await mkdir(app, { recursive: true });
      await writeFile(
        path.join(app, 'cli.mjs'),
        `process.stdout.write(JSON.stringify({ version: ${JSON.stringify(version)}, args: process.argv.slice(2) }));`,
      );
      await writeFile(
        path.join(home, 'runtime', version, 'install.json'),
        JSON.stringify({ version, systemNode: true, node: process.execPath, installedAt }),
      );
    };
    await fake('1.1.0', '2026-01-01T00:00:00.000Z');
    await fake('1.2.0', '2026-02-01T00:00:00.000Z');
    const missing = execute(process.execPath, [path.join(skill, 'lulicv.mjs'), 'doctor'], { env });
    await expect(missing).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('"code":"RUNTIME_MISSING"'),
    });
    await expect(missing).rejects.toMatchObject({ stderr: expect.stringContaining('@arilabo/lulicv@1.3.0') });
    const incomplete = execute(
      process.execPath,
      [path.join(await skillCopy(root, undefined), 'lulicv.mjs'), 'doctor'],
      { env },
    );
    await expect(incomplete).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('"code":"SKILL_INCOMPLETE"'),
    });
    await fake('1.3.0', '2026-03-01T00:00:00.000Z');
    const { stdout } = await execute(process.execPath, [path.join(skill, 'lulicv.mjs'), 'get', '中文 id'], { env });
    expect(JSON.parse(stdout)).toEqual({ version: '1.3.0', args: ['get', '中文 id'] });
    // Installing the same version again reports it and changes nothing; cleanup keeps 1.2.0 to step back to.
    const { stdout: report } = await execute(
      process.execPath,
      [path.join(skill, 'install-runtime.mjs'), '--package', await tarball(root, '1.3.0')],
      { env },
    );
    expect(JSON.parse(report)).toMatchObject({
      installed: true,
      alreadyInstalled: true,
      version: '1.3.0',
      invocation: ['node', path.join(skill, 'lulicv.mjs')],
    });
    expect((await readdir(path.join(home, 'runtime'))).sort()).toEqual(['1.1.0', '1.2.0', '1.3.0']);
    // A fresh install keeps the most recently installed other version; directories that are not installs are left alone.
    await mkdir(path.join(home, 'runtime', 'notes'));
    expect(await removeOlder(path.join(home, 'runtime'), '1.3.0')).toEqual({ removed: ['1.1.0'], kept: [] });
    expect((await readdir(path.join(home, 'runtime'))).sort()).toEqual(['1.2.0', '1.3.0', 'notes']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('installs the Skill version from the npm registry, or from a provided package, and says what to do when the registry lacks it', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'resume-registry-')));
  const served = await registry({ '1.2.0': await tarball(root, '1.2.0'), '1.3.0': await tarball(root, '1.3.0') });
  try {
    // An isolated npm cache and config, so neither the user's registry nor earlier runs take part.
    const npmEnv = {
      ...process.env,
      npm_config_registry: served.url,
      npm_config_cache: path.join(root, 'npm-cache'),
      npm_config_userconfig: path.join(root, 'npmrc'),
      npm_config_update_notifier: 'false',
    };
    const skill = await skillCopy(root, '1.2.0');
    const { stdout } = await execute(process.execPath, [path.join(skill, 'install-runtime.mjs')], {
      env: { ...npmEnv, LULICV_HOME: path.join(root, 'npm-home') },
    });
    const report = JSON.parse(stdout);
    // The registry's latest is 1.3.0; the Skill still gets exactly its own version.
    expect(report).toMatchObject({
      installed: true,
      version: '1.2.0',
      source: 'npm',
      node: 'system',
      doctor: { ok: true, version: '1.2.0', args: ['doctor'] },
    });
    expect(JSON.parse(await readFile(path.join(report.directory, 'install.json'), 'utf8'))).toMatchObject({
      version: '1.2.0',
      source: 'npm',
    });
    const { stdout: fromPackage } = await execute(
      process.execPath,
      [path.join(skill, 'install-runtime.mjs'), '--package', path.join(root, 'arilabo-lulicv-1.2.0.tgz')],
      { env: { ...npmEnv, LULICV_HOME: path.join(root, 'package-home') } },
    );
    expect(JSON.parse(fromPackage)).toMatchObject({
      installed: true,
      version: '1.2.0',
      source: 'package',
      doctor: { ok: true },
    });
    // When every check passes the report only says it is ready; a check that did not pass keeps the full report.
    const checks = [{ name: 'resources', status: 'ok', message: '完整' }];
    const installWith = async (name: string, doctorReport: unknown) => {
      await mkdir(path.join(root, name));
      const { stdout } = await execute(
        process.execPath,
        [
          path.join(skill, 'install-runtime.mjs'),
          '--package',
          await tarball(path.join(root, name), '1.2.0', doctorReport),
        ],
        { env: { ...npmEnv, LULICV_HOME: path.join(root, `${name}-home`) } },
      );
      return JSON.parse(stdout);
    };
    expect(await installWith('ready', { valid: true, checks })).toEqual({
      installed: true,
      ready: true,
      version: '1.2.0',
      source: 'package',
      removed: [],
      kept: [],
      nextAction: expect.stringContaining('nothing to run again'),
    });
    const warned = [...checks, { name: 'update', status: 'warning', message: '有新版本' }];
    const full = await installWith('warned', { valid: true, checks: warned });
    expect(full).toMatchObject({ doctor: { valid: true, checks: warned }, directory: expect.any(String) });
    expect(full.ready).toBeUndefined();
    // A version the registry (or a lagging mirror) does not have yet fails with the way forward and leaves nothing behind.
    const home = path.join(root, 'missing-home');
    const failed = execute(process.execPath, [path.join(await skillCopy(root, '1.4.0'), 'install-runtime.mjs')], {
      env: { ...npmEnv, LULICV_HOME: home },
    });
    await expect(failed).rejects.toMatchObject({
      code: 1,
      stdout: '',
      stderr: expect.stringContaining('npm could not install @arilabo/lulicv@1.4.0'),
    });
    await expect(failed).rejects.toMatchObject({ stderr: expect.stringContaining('--package') });
    expect(await readdir(path.join(home, 'runtime'))).toEqual([]);
  } finally {
    await served.close();
    await rm(root, { recursive: true, force: true });
  }
}, 120000);
