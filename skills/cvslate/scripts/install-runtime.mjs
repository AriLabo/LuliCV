#!/usr/bin/env node
// Bootstrap with the Agent's existing Node 18+. Installs CVSlate of this Skill's version (and any downloaded Node) into this
// device's per-user data directory, one directory per version, where the Skill's scripts/cvslate.mjs finds it. The package comes
// from the user's npm registry, or from a .tgz given with --package (pre-release builds, offline machines).
import { access, mkdir, mkdtemp, readFile, writeFile, rm, rename } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { readInstall, removeOlder, runtimeRoot, skillVersion } from './runtime-location.mjs';
const VERSION = '22.22.3';
const PACKAGE = '@arilabo/cvslate';
// Pinned here rather than read from SHASUMS256.txt, so a download through --node-mirror is held to the same bytes as nodejs.org.
const SHA256 = {
  'node-v22.22.3-darwin-arm64.tar.gz': '0da7ff74ef8611328c8212f17943368713a2ad953fb7d89a8c8a0eae87c23207',
  'node-v22.22.3-darwin-x64.tar.gz': '45830ba752fa0d892c6dcd640946669801293cac820a33591ded40ac075198ec',
  'node-v22.22.3-linux-arm64.tar.gz': 'cc8bc82b2dd0b595c3b95a4c3c9c8c350907cff011afbdee3d1379e812e1e3e3',
  'node-v22.22.3-linux-x64.tar.gz': 'c7a10d6816da8eaaa7534dd73c71c6e2b2c391dbbf845e364902d156615dd1b8',
  'node-v22.22.3-win-arm64.zip': '00be129a09e8872cd52d3bb8bba12412c5733d2224123a482a2dca4a6fbf2586',
  'node-v22.22.3-win-x64.zip': '6c8d54f635feff4df76c2ca80f45332eb2ff57d25226edce36592e51a177ee33',
};
// The Bridge needs Node's built-in SQLite 3.51.3 or later; the Node version itself does not matter.
function sqliteReady(sqlite = process.versions.sqlite) {
  const [major, minor, patch] = (sqlite ?? '').split('.').map(Number);
  return Number.isFinite(patch) && (major > 3 || (major === 3 && (minor > 51 || (minor === 51 && patch >= 3))));
}
// A cold-cache dependency install dominates the whole bootstrap: installing this same tgz
// takes about 270s on a Windows runner, so the default budget would kill correct work.
// Keep a real bound so a genuine hang still fails instead of waiting forever.
const INSTALL_TIMEOUT_MS = 600000;
function run(executable, args, options = {}, timeout = 180000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { ...options, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (data) => process.stderr.write(data));
    child.stderr.on('data', (data) => process.stderr.write(data));
    const deadline = setTimeout(() => {
      child.kill();
      reject(
        new Error(
          `Installer command timed out after ${Math.round(timeout / 1000)}s; retry after checking network/disk`,
        ),
      );
    }, timeout);
    child.once('error', (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(deadline);
      if (code === 0) resolve();
      else reject(new Error(`Installer command failed (${code})`));
    });
  });
}
// Doctor runs here, in a child whose output this process reads itself, so the agent gets the result with the install
// instead of in another shell call (some agent shell tools drop a command's output).
function doctor(entry) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [entry, 'doctor'], { shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    child.stdout.on('data', (data) => {
      output += data;
    });
    const deadline = setTimeout(() => child.kill(), 120000);
    child.once('error', () => {
      clearTimeout(deadline);
      resolve(undefined);
    });
    child.once('close', () => {
      clearTimeout(deadline);
      try {
        resolve(JSON.parse(output));
      } catch {
        resolve(undefined);
      }
    });
  });
}
// `mirror` is a dist root laid out like https://nodejs.org/dist, the same convention as nvm's NVM_NODEJS_ORG_MIRROR.
async function downloadNode(mirror, filename, destination) {
  const url = `${mirror.replace(/\/+$/, '')}/v${VERSION}/${filename}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Node download failed (HTTP ${response.status}): ${url}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(data).digest('hex') !== SHA256[filename])
    throw new Error(`Node checksum mismatch: ${url}`);
  await writeFile(destination, data);
}
// Where official builds, Homebrew and nvm keep npm relative to the node binary.
function bundledNpm(node) {
  const root = path.dirname(node);
  return process.platform === 'win32'
    ? path.join(root, 'node_modules/npm/bin/npm-cli.js')
    : path.join(root, '../lib/node_modules/npm/bin/npm-cli.js');
}
// Read package/package.json straight from the npm tarball, so a wrong or mismatched package fails before anything is installed.
async function packageVersion(archive) {
  let tar;
  try {
    tar = gunzipSync(await readFile(archive));
  } catch {
    throw new Error('Use the provided CVSlate .tgz');
  }
  for (let offset = 0; offset + 512 <= tar.length;) {
    const field = (start, length) =>
      tar
        .subarray(offset + start, offset + start + length)
        .toString('utf8')
        .replace(/\0.*$/s, '');
    const name = field(0, 100),
      size = parseInt(field(124, 12).trim() || '0', 8);
    if (!name) break;
    offset += 512;
    if (name === 'package/package.json') {
      const manifest = JSON.parse(tar.subarray(offset, offset + size).toString('utf8'));
      if (manifest.name !== PACKAGE || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(manifest.version ?? '')) break;
      return manifest.version;
    }
    offset += Math.ceil(size / 512) * 512;
  }
  throw new Error('Use the provided CVSlate .tgz');
}
async function main() {
  const { values } = parseArgs({
    options: {
      package: { type: 'string' },
      'private-node': { type: 'boolean' },
      'node-mirror': { type: 'string', default: 'https://nodejs.org/dist' },
    },
  });
  const version = await skillVersion();
  if (!version)
    throw new Error(
      'This Skill is incomplete: scripts/release.json is missing. Reinstall the whole Skill directory, including every file under scripts/. Nothing was installed.',
    );
  let archive;
  if (values.package) {
    archive = path.resolve(values.package);
    if (!archive.endsWith('.tgz')) throw new Error('Use the provided CVSlate .tgz');
    await access(archive);
    const found = await packageVersion(archive);
    if (found !== version)
      throw new Error(
        `This package is CVSlate ${found} but this Skill is ${version}. To stay on ${version}, install arilabo-cvslate-${version}.tgz or run without --package to install from npm. To use ${found}, install the Skill of ${found} (cvslate-skill-${found}.zip, released with the package) and run its installer; editing scripts/release.json instead leaves this Skill's instructions driving a runtime they were not written for. Nothing was installed.`,
      );
  }
  const root = runtimeRoot();
  const destination = path.join(root, version);
  const entry = fileURLToPath(new URL('./cvslate.mjs', import.meta.url));
  const report = async (install, extra) => {
    const checked = await doctor(entry);
    // When every check passed the agent only needs to know it is ready; paths and checks it would only repeat to the user.
    if (checked?.valid === true && checked.checks?.every((check) => check.status === 'ok')) {
      process.stdout.write(
        JSON.stringify({
          installed: true,
          ready: true,
          version,
          source: install.source,
          ...extra,
          nextAction:
            'doctor already ran as part of this install and passed every check, so there is nothing to run again before starting. Tell the user CVSlate is ready as the last step of references/install.md says.',
        }) + '\n',
      );
      return;
    }
    process.stdout.write(
      JSON.stringify({
        installed: true,
        version,
        source: install.source,
        directory: destination,
        invocation: ['node', entry],
        node: install.systemNode ? 'system' : 'private',
        ...extra,
        ...(checked ? { doctor: checked } : {}),
        nextAction: checked
          ? 'Run setup only if the doctor above reports no browser, then doctor again. Then tell the user CVSlate is ready as the last step of references/install.md says; this report is for you: leave its paths, versions and checks out of the reply unless a check failed.'
          : 'Run doctor through the invocation; run setup only if it reports no browser. Then tell the user CVSlate is ready as the last step of references/install.md says; this report is for you: leave its paths, versions and checks out of the reply unless a check failed.',
      }) + '\n',
    );
  };
  const existing = await readInstall(destination);
  if (existing) {
    await report(existing, { alreadyInstalled: true });
    return;
  }
  try {
    await access(destination);
    throw new Error(`${destination} exists but is not a complete installation; delete it and retry.`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(root, { recursive: true });
  const stage = await mkdtemp(path.join(root, '.install-'));
  try {
    const platform = process.platform,
      arch = process.arch;
    if (!['darwin', 'linux', 'win32'].includes(platform) || !['arm64', 'x64'].includes(arch))
      throw new Error('Unsupported platform/architecture');
    // Reuse the Node running this helper when its SQLite is new enough and its npm sits beside it; otherwise download a private one.
    const systemNpm = bundledNpm(process.execPath);
    const system =
      !values['private-node'] &&
      sqliteReady() &&
      (await access(systemNpm).then(
        () => true,
        () => false,
      ));
    let node = process.execPath,
      nodeRelative;
    if (system)
      process.stderr.write(
        `Using this Node ${process.versions.node} (SQLite ${process.versions.sqlite}); nothing is downloaded for it.\n`,
      );
    else {
      const os = platform === 'win32' ? 'win' : platform;
      const extension = platform === 'win32' ? 'zip' : 'tar.gz';
      const basename = `node-v${VERSION}-${os}-${arch}`;
      const filename = `${basename}.${extension}`;
      process.stderr.write(`Installing isolated official Node ${VERSION}; system Node and PATH are unchanged.\n`);
      await downloadNode(values['node-mirror'], filename, path.join(stage, filename));
      if (platform === 'win32') {
        const quote = (value) => `'${value.replaceAll("'", "''")}'`;
        // Suppress PowerShell progress: it serializes one record per archive entry to stderr,
        // which floods the parent pipe and adds no diagnostic value.
        const script = `$ProgressPreference = 'SilentlyContinue'; Expand-Archive -LiteralPath ${quote(path.join(stage, filename))} -DestinationPath ${quote(stage)}`;
        await run('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64'),
        ]);
      } else await run('tar', ['-xzf', path.join(stage, filename), '-C', stage]);
      await rename(path.join(stage, basename), path.join(stage, 'node'));
      await rm(path.join(stage, filename));
      nodeRelative = platform === 'win32' ? 'node/node.exe' : 'node/bin/node';
      node = path.join(stage, nodeRelative);
    }
    const npm = bundledNpm(node);
    // npm uses the registry from the user's own npm config; the package's npm-shrinkwrap.json pins every dependency's integrity either way.
    const spec = archive ?? `${PACKAGE}@${version}`;
    if (!archive) process.stderr.write(`Installing ${spec} from the npm registry.\n`);
    try {
      await run(
        node,
        [
          npm,
          'install',
          '--prefix',
          path.join(stage, 'app'),
          '--omit=dev',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          spec,
        ],
        { env: { ...process.env, PATH: path.dirname(node) + path.delimiter + (process.env.PATH ?? '') } },
        INSTALL_TIMEOUT_MS,
      );
    } catch (error) {
      throw archive
        ? error
        : new Error(
            `${error.message}. npm could not install ${spec}: a registry mirror can lag a new release by some minutes, so retry later; with a provided arilabo-cvslate-${version}.tgz, pass --package <path> instead`,
          );
    }
    const installed = JSON.parse(await readFile(path.join(stage, 'app/node_modules', PACKAGE, 'package.json'), 'utf8'));
    if (installed.name !== PACKAGE || installed.version !== version)
      throw new Error(`npm installed ${installed.name}@${installed.version}, not ${PACKAGE}@${version}`);
    await access(path.join(stage, 'app/node_modules', PACKAGE, 'agent-dist/cli.mjs'));
    // The entry reads this to pick the Node: a private one by its path inside the directory, or the system Node by absolute path.
    const install = {
      version,
      source: archive ? 'package' : 'npm',
      systemNode: system,
      node: system ? node : nodeRelative,
      installedAt: new Date().toISOString(),
    };
    await writeFile(path.join(stage, 'install.json'), JSON.stringify(install, null, 2) + '\n');
    // A concurrent install of the same version may finish first; its result is as good as ours.
    try {
      await rename(stage, destination);
    } catch (error) {
      const winner = await readInstall(destination);
      if (!winner) throw error;
      await report(winner, { alreadyInstalled: true });
      return;
    }
    await report(install, await removeOlder(root, version));
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
try {
  await main();
} catch (error) {
  process.stderr.write(
    JSON.stringify({
      code: 'INSTALL_FAILED',
      message: error.message,
      nextAction:
        'Check network/disk/permissions and retry. Do not modify global Node, CLI wrappers, or workspace files.',
    }) + '\n',
  );
  process.exitCode = 1;
}
