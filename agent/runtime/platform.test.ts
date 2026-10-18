import { expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { isPortableFilename } from './files';
import { browserCommand } from './browser';
import { writeOutput } from '../cli/output';
it('rejects reserved filenames before filesystem writes and preserves existing output', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'resume-files-'));
  try {
    for (const name of ['CON.pdf', 'con .pdf', 'LPT1.pdf', 'a:b.pdf', 'a?.pdf', 'a*.pdf', 'a|b.pdf', 'a.pdf ']) {
      expect(isPortableFilename(name)).toBe(false);
      await expect(writeOutput(root, path.join(root, name), Buffer.from('fixture'))).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    }
    expect(isPortableFilename('..')).toBe(false);
    expect(await readdir(root)).toEqual([]);
    await writeOutput(root, path.join(root, '中文 简历.pdf'), Buffer.from('fixture'));
    await expect(writeOutput(root, path.join(root, '中文 简历.pdf'), Buffer.from('overwrite'))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: expect.stringContaining('已存在'),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('opens only verified loopback URLs as separate executable arguments', () => {
  const url = 'http://127.0.0.1:1234/#token=' + 'a'.repeat(64);
  expect(browserCommand(url, 'win32').args).toEqual(['url.dll,FileProtocolHandler', url]);
  for (const platform of ['darwin', 'linux'] as const) expect(browserCommand(url, platform).args).toEqual([url]);
  for (const bad of ['https://example.com', 'javascript:alert(1)', 'http://secret@127.0.0.1:1234'])
    expect(() => browserCommand(bad, 'win32')).toThrow();
});
it('lets the MCP adapter run on agent-bundled Node 20+ while the Bridge needs SQLite 3.51.3', async () => {
  const { checkClientRuntime, checkRuntime } = await import('./version');
  for (const version of ['20.0.0', '22.22.2', '24.1.0']) expect(() => checkClientRuntime(version)).not.toThrow();
  for (const version of ['18.20.4', 'x']) expect(() => checkClientRuntime(version)).toThrow('Node 20');
  expect(() => checkRuntime({ node: '22.22.2', sqlite: '3.50.4' })).toThrow('3.51.3');
});
