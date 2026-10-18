#!/usr/bin/env node
import { checkRuntime } from '../runtime/version';
try {
  checkRuntime();
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
}
// Node 22 flags its built-in SQLite as experimental on every run; stdout stays JSON either way,
// but the repeated stderr notice reads like an error to people and agents.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const text = typeof warning === 'string' ? warning : warning.message;
  if (
    (rest[0] === 'ExperimentalWarning' || (rest[0] as { type?: string } | undefined)?.type === 'ExperimentalWarning') &&
    /SQLite/i.test(text)
  )
    return;
  return (emitWarning as (...args: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;
if (!process.exitCode) {
  try {
    await import(new URL('./cli-main.mjs', import.meta.url).href);
  } catch {
    process.stderr.write('CLI 安装资源无法加载；请重新安装完整 tgz\n');
    process.exitCode = 1;
  }
}
