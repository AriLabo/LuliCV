import { expect, it, vi } from 'vitest';
import { access, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  doctor,
  setupChromium,
  chromiumInstaller,
  chromiumDownloadHost,
  npmRegistry,
  publishedTags,
  updateCheck,
} from './environment';
import { compareVersions } from './version';
vi.mock('playwright', () => ({ chromium: { launch: vi.fn(async () => ({ close: async () => {} })) } }));
it('doctor fails missing linked font assets without creating workspace or exposing runtime credentials', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'resume-doctor-'));
  try {
    for (const name of ['dist/assets', 'agent-dist', 'schema']) await mkdir(path.join(root, name), { recursive: true });
    for (const file of [
      'agent-dist/cli.mjs',
      'agent-dist/cli-main.mjs',
      'agent-dist/mcp.mjs',
      'agent-dist/mcp-main.mjs',
      'schema/resume-data.schema.json',
      'schema/theme-catalog.json',
    ])
      await writeFile(path.join(root, file), 'fixture');
    await writeFile(path.join(root, 'dist/index.html'), '<link href="/assets/theme.css">');
    await writeFile(path.join(root, 'dist/assets/theme.css'), '@font-face { src:url(/assets/MiSans-missing.woff2) }');
    for (const font of ['MiSans-present.woff2', 'noto-sans-sc.woff2', 'LXGW.ttf'])
      await writeFile(path.join(root, 'dist/assets', font), 'fixture');
    const failed = await doctor(undefined, root);
    expect(failed.valid).toBe(false);
    expect(failed.checks).toContainEqual(expect.objectContaining({ name: 'resources', status: 'error' }));
    await writeFile(path.join(root, 'dist/assets/MiSans-missing.woff2'), 'fixture');
    const passed = await doctor(undefined, root);
    expect(passed.valid).toBe(true);
    // A source run has no release to compare, so it never asks npm.
    expect(passed.checks.map((check) => check.name)).not.toContain('update');
    const { chromium } = await import('playwright');
    const launch = vi.mocked(chromium.launch);
    // Without Playwright's own build, an installed Chrome is used.
    launch.mockRejectedValueOnce(new Error('missing build'));
    expect((await doctor(undefined, root)).checks).toContainEqual(
      expect.objectContaining({ name: 'chromium', status: 'ok', message: '系统 Chrome 可启动' }),
    );
    expect(launch).toHaveBeenLastCalledWith({ channel: 'chrome', timeout: 10000 });
    for (let attempt = 0; attempt < 3; attempt++)
      launch.mockRejectedValueOnce(new Error('secret-token-untrusted-error'));
    const directory = path.join(root, 'nonexistent');
    const missing = await doctor({ directory, source: 'default' }, root);
    expect(missing.valid).toBe(false);
    expect(JSON.stringify(missing)).not.toContain('secret-token');
    expect(missing.checks).toContainEqual(
      expect.objectContaining({ name: 'chromium', status: 'error', nextAction: expect.stringContaining('setup') }),
    );
    // A default workspace not created yet is fine, and checking it does not create it; a chosen one that is gone is not.
    expect(missing.checks).toContainEqual(
      expect.objectContaining({
        name: 'workspace',
        status: 'ok',
        message: expect.stringContaining('第一次使用时自动创建'),
      }),
    );
    await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await doctor({ directory, source: 'chosen' }, root)).checks).toContainEqual(
      expect.objectContaining({
        name: 'workspace',
        status: 'error',
        nextAction: expect.stringContaining('cvslate workspace <directory>'),
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('setup uses the installed Playwright and maps child failure, keeping installer output off stdout', async () => {
  expect(chromiumInstaller().args).toEqual([
    expect.stringMatching(/node_modules.*playwright.*cli\.js$/),
    'install',
    'chromium',
    '--only-shell',
  ]);
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    const npmjs = async () => 'https://registry.npmjs.org/';
    await expect(
      setupChromium(
        { executable: process.execPath, args: ['-e', "console.log('installer diagnostic');process.exitCode=1"] },
        npmjs,
      ),
    ).rejects.toMatchObject({
      code: 'STORAGE_FAILED',
      message: expect.stringMatching(/cvslate setup.*PLAYWRIGHT_DOWNLOAD_HOST=https:\/\/cdn\.npmmirror\.com/),
    });
    expect(stderr).toHaveBeenCalledWith(expect.any(Buffer));
    await expect(
      setupChromium(
        {
          executable: process.execPath,
          args: ['-e', 'process.exitCode = process.env.PLAYWRIGHT_DOWNLOAD_HOST ? 1 : 0'],
        },
        npmjs,
      ),
    ).resolves.toEqual({ installed: true });
    // An npm that goes through npmmirror sends the Chromium download there too.
    await expect(
      setupChromium(
        {
          executable: process.execPath,
          args: [
            '-e',
            "process.exitCode = process.env.PLAYWRIGHT_DOWNLOAD_HOST === 'https://cdn.npmmirror.com/binaries/playwright' ? 0 : 1",
          ],
        },
        async () => 'https://registry.npmmirror.com/',
      ),
    ).resolves.toEqual({ installed: true, downloadHost: 'https://cdn.npmmirror.com/binaries/playwright' });
  } finally {
    stderr.mockRestore();
  }
});
it('setup picks npmmirror for Chromium only when npm uses it and the user set no host', async () => {
  const mirror = 'https://cdn.npmmirror.com/binaries/playwright';
  expect(chromiumDownloadHost({}, 'https://registry.npmmirror.com/')).toBe(mirror);
  expect(chromiumDownloadHost({}, 'https://registry.npmjs.org/')).toBeUndefined();
  expect(chromiumDownloadHost({}, 'https://evilnpmmirror.com/')).toBeUndefined();
  expect(chromiumDownloadHost({}, 'not a url')).toBeUndefined();
  expect(chromiumDownloadHost({}, undefined)).toBeUndefined();
  for (const env of [
    { PLAYWRIGHT_DOWNLOAD_HOST: 'https://example.test' },
    { PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST: 'https://example.test' },
    { npm_config_playwright_download_host: 'https://example.test' },
  ])
    expect(chromiumDownloadHost(env, 'https://registry.npmmirror.com/')).toBeUndefined();
  // The npm beside the running Node is found where the installer looks; a Node without one gives no registry, not an error.
  await expect(npmRegistry()).resolves.toMatch(/^https?:\/\//);
  await expect(npmRegistry(path.join(tmpdir(), 'no-such-node', 'node'))).resolves.toBeUndefined();
});
it('offers an update only for a newer version on the channel the user is on', async () => {
  const ordered = [
    '0.1.0-preview.2',
    '0.1.0-preview.10',
    '0.1.0-rc.1',
    '0.1.0',
    '0.1.1',
    '0.2.0-preview.1',
    '0.2.0',
    '1.0.0',
  ];
  for (let index = 1; index < ordered.length; index++) {
    expect(compareVersions(ordered[index - 1], ordered[index])).toBeLessThan(0);
    expect(compareVersions(ordered[index], ordered[index - 1])).toBeGreaterThan(0);
  }
  expect(compareVersions('0.1.0-preview.5', '0.1.0-preview.5')).toBe(0);
  expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBeLessThan(0);
  expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBeLessThan(0);
  // A preview sees newer previews and releases.
  expect(updateCheck('0.1.0-preview.5', { latest: '0.1.0-preview.5', next: '0.1.0-preview.6' })).toMatchObject({
    name: 'update',
    status: 'warning',
    message: expect.stringContaining('0.1.0-preview.6'),
    nextAction: expect.stringContaining('Updating'),
  });
  expect(updateCheck('0.1.0-preview.5', { latest: '0.1.0', next: '0.1.0-preview.6' })).toMatchObject({
    status: 'warning',
    message: expect.stringContaining('CVSlate 0.1.0 '),
  });
  // A release is not offered a preview, and nothing older or equal counts.
  expect(updateCheck('0.1.0', { latest: '0.1.0', next: '0.2.0-preview.1' })).toMatchObject({
    status: 'ok',
    message: '0.1.0 是最新版本',
  });
  expect(updateCheck('0.1.0-preview.6', { latest: '0.1.0-preview.5', next: '0.1.0-preview.5' })).toMatchObject({
    status: 'ok',
  });
  // Malformed tags are ignored; no answer from npm is not a problem.
  expect(updateCheck('0.1.0-preview.5', { latest: 'garbage', next: 42 })).toMatchObject({ status: 'ok' });
  expect(updateCheck('0.1.0-preview.5', undefined)).toMatchObject({
    status: 'ok',
    message: expect.stringContaining('不影响使用'),
  });
  await expect(publishedTags(path.join(tmpdir(), 'no-such-node', 'node'))).resolves.toBeUndefined();
});
