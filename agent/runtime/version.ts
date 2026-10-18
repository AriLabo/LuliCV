import { ResumeError } from '../../src/core/errors';
// The Bridge needs Node's built-in SQLite at 3.51.3 or later (that release fixes a WAL-reset bug); the Node version itself does not matter.
// Node 22.22.3+, 24.15+ and 26 bundle it.
export const MIN_SQLITE = '3.51.3';
export const SUPPORTED_NODE = 'Node 22.22.3+、24.15+ 或 26 起的版本';
export function checkRuntime(versions: { node: string; sqlite?: string } = process.versions) {
  if (!versions.sqlite)
    throw new ResumeError('STORAGE_FAILED', `Node ${versions.node} 没有内置 SQLite；请换用 ${SUPPORTED_NODE}`);
  checkSqlite(versions.sqlite, versions.node);
}
// The MCP adapter only talks HTTP to an existing Bridge and never opens SQLite, so it does not
// need the Bridge's SQLite; agent clients often launch it with their own bundled Node.
export const MIN_CLIENT_NODE_MAJOR = 20;
export function checkClientRuntime(nodeVersion = process.versions.node) {
  const major = Number(nodeVersion.split('.')[0]);
  if (!Number.isSafeInteger(major) || major < MIN_CLIENT_NODE_MAJOR)
    throw new ResumeError('STORAGE_FAILED', `MCP 需要 Node ${MIN_CLIENT_NODE_MAJOR} 或更新版本`);
}
export function checkSqlite(sqliteVersion: string, nodeVersion = process.versions.node) {
  const [major, minor, patch] = sqliteVersion.split('.').map(Number);
  if (!Number.isFinite(patch) || major < 3 || (major === 3 && (minor < 51 || (minor === 51 && patch < 3))))
    throw new ResumeError(
      'STORAGE_FAILED',
      `需要 SQLite ${MIN_SQLITE} 或更新版本，当前 Node ${nodeVersion} 自带的是 ${sqliteVersion}；请换用 ${SUPPORTED_NODE}`,
    );
}
const RELEASE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
export const isRelease = (value: unknown): value is string => typeof value === 'string' && RELEASE.test(value);
// Semver precedence: a prerelease sorts before its release, and numeric identifiers compare as numbers.
export function compareVersions(a: string, b: string) {
  const parse = (value: string) => {
    const [core, pre] = value.split(/-(.*)/s);
    return { core: core.split('.').map(Number), pre: pre ? pre.split('.') : [] };
  };
  const x = parse(a),
    y = parse(b);
  for (let index = 0; index < 3; index++) if (x.core[index] !== y.core[index]) return x.core[index] - y.core[index];
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let index = 0; index < Math.max(x.pre.length, y.pre.length); index++) {
    const left = x.pre[index],
      right = y.pre[index];
    if (left === right) continue;
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftNumeric = /^\d+$/.test(left),
      rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) return Number(left) - Number(right);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left < right ? -1 : 1;
  }
  return 0;
}
