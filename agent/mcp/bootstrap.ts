#!/usr/bin/env node
import { checkClientRuntime } from '../runtime/version';
try {
  checkClientRuntime();
} catch {
  process.stderr.write('MCP 需要 Node 20 或更新版本；请更新后重试\n');
  process.exitCode = 1;
}
if (!process.exitCode) {
  try {
    await import(new URL('./mcp-main.mjs', import.meta.url).href);
  } catch {
    process.stderr.write('MCP 安装资源无法加载；请重新安装完整 tgz\n');
    process.exitCode = 1;
  }
}
