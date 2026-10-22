#!/usr/bin/env node
// The one command agents run. It starts the runtime of this Skill's version from the per-user data directory,
// so a new conversation needs only the Skill directory it already knows. `mcp` as the first argument starts the MCP server.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInstall, runtimeRoot, skillVersion } from './runtime-location.mjs';

const args = process.argv.slice(2);
const mcp = args[0] === 'mcp';
if (mcp) args.shift();
const version = await skillVersion();
const root = runtimeRoot();
const directory = version && path.join(root, version);
const install = directory && (await readInstall(directory));
if (!install) {
  const installer = fileURLToPath(new URL('./install-runtime.mjs', import.meta.url));
  const present = await readdir(root).then(
    (names) => names.filter((name) => !name.startsWith('.')),
    () => [],
  );
  process.stderr.write(
    JSON.stringify(
      version
        ? {
            code: 'RUNTIME_MISSING',
            message: `履栗 ${version} 运行时未安装${present.length ? `；本机已有 ${present.join('、')}，与这个 Skill 版本不一致` : ''}`,
            nextAction: `先告诉用户要安装什么（见 references/install.md），再运行 node "${installer}"，从用户的 npm 源安装 @arilabo/lulicv@${version} 后重试；用户提供了 arilabo-lulicv-${version}.tgz 时改用 node "${installer}" --package "<tgz 路径>"`,
          }
        : {
            code: 'SKILL_INCOMPLETE',
            message: 'Skill 不完整，缺少 scripts/release.json，无法确定需要的运行时版本',
            nextAction: '重新完整安装这个 Skill 目录（包括 scripts/ 下全部文件）',
          },
    ) + '\n',
  );
  process.exitCode = 1;
} else {
  // A system Node that has since moved (an upgrade) falls back to whichever Node runs this entry.
  const node = install.systemNode
    ? existsSync(install.node)
      ? install.node
      : process.execPath
    : path.join(directory, install.node);
  const child = spawn(
    node,
    [
      path.join(directory, 'app', 'node_modules', '@arilabo', 'lulicv', 'agent-dist', mcp ? 'mcp.mjs' : 'cli.mjs'),
      ...args,
    ],
    { stdio: 'inherit', shell: false },
  );
  child.once('error', () => {
    process.stderr.write(
      JSON.stringify({
        code: 'RUNTIME_MISSING',
        message: `${directory} 里的 Node 无法启动`,
        nextAction: '删除这个目录后重新运行安装器',
      }) + '\n',
    );
    process.exitCode = 1;
  });
  child.once('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}
