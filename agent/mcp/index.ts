#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { workspaceIdAt } from '../cli/client';
import { locateWorkspace, openWorkspace } from '../runtime/workspace-location';
import { ResumeError } from '../../src/core/errors';
import { createMcpServer } from './server';

async function main() {
  const { values } = parseArgs({ options: { workspace: { type: 'string' } } });
  const root = await openWorkspace(await locateWorkspace(values.workspace));
  const workspaceId = await workspaceIdAt(root);
  const handle = serveStdio(
    () => createMcpServer(root, workspaceId, fileURLToPath(new URL('./cli.mjs', import.meta.url))),
    { onerror: () => process.stderr.write('MCP transport error\n') },
  );
  const stop = () => {
    void handle.close().catch(() => {
      process.stderr.write('MCP close failed\n');
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
main().catch((error) => {
  process.stderr.write(`MCP 启动失败：${error instanceof ResumeError ? error.message : '无法打开工作区'}\n`);
  process.exitCode = 1;
});
