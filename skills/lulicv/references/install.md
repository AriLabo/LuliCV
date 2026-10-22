# Installation

The Skill and the runtime are two parts of one release: the Skill tells you how to work, and the runtime holds the CLI, the Bridge and the editor. They pair by version (`scripts/release.json`), and `lulicv` answers `RUNTIME_MISSING` until the runtime of this version is installed. To use another version, install that version's Skill too: editing `release.json` instead leaves this Skill's instructions driving a runtime they were not written for.

Before installing, tell the user in a sentence or two what will happen: LuliCV <version> is downloaded from their npm registry (about 40 MB) into their user data directory, their system Node and PATH stay unchanged, and it usually takes under a minute. A request to install or use this Skill covers this download; if the user only wanted to look at the Skill, ask first. Then run:

```sh
node "<skill-dir>/scripts/install-runtime.mjs"
```

The installer runs on any Node 18+. It installs `@arilabo/lulicv@<version>` with the user's own npm configuration, so a user in mainland China whose npm uses npmmirror gets it from there; the package pins every dependency's integrity. It keeps using the Node that runs it (often the agent client's own) when that Node's SQLite is new enough, and only otherwise downloads a Node of its own and checks its hash. Running it again reports `alreadyInstalled`. When it finishes it runs `lulicv doctor`: when every check passed it reports `ready`, otherwise it includes the report as `doctor`.

If npm cannot find this version, a registry mirror may not have caught up with a new release yet; retrying after a few minutes usually works. When the user provides `arilabo-lulicv-<version>.tgz` (a pre-release build), install that instead with `--package "<tgz path>"`; a package of another version is refused. A pre-release build comes with `lulicv-skill-<version>.zip` of the same version, which is the Skill to install with it. If Node is missing, tell the user. If the installer fails, report its message; its checks protect the user's machine, so do not bypass them.

Then run each of these as its own command. The workspace needs no setup: the first command that uses it creates it in the same data directory.

1. Rendering uses an installed Chrome or Edge when there is one, so `lulicv setup` is needed only when doctor's `chromium` check fails. It downloads a headless Chromium (about 100 MB), from npmmirror when the user's npm registry is npmmirror and otherwise from Playwright's CDN, which can crawl for a long time from mainland China instead of failing; `PLAYWRIGHT_DOWNLOAD_HOST` set for that command overrides both, and the result's `downloadHost` shows when the mirror was used. Then run `lulicv doctor` again. Keep them separate: doctor exits 1 while no browser is found, so `doctor && setup` would never reach setup.
2. Tell the user LuliCV is ready. The installer and doctor reports are for you; pass on a check only when it failed and affects the user, and leave out paths and versions.
   - When the user only asked to install, say what they can now do and how to start, drawing on "What LuliCV offers" in [SKILL.md](../SKILL.md), for example:
     > 履栗（LuliCV）已经安装好了。现在可以让我帮你制作简历，也可以修改已有简历的内容和排版。字体、配色、间距和整体风格都可以按你的要求调整。你也能在编辑器里自己修改，最后导出 PDF。如果需要投不同岗位，还可以分别制作投递版本，保留原来的简历。你可以把旧简历发给我，直接开始制作；也可以先试试示例，告诉我你想怎么调整排版。如果不想让我看到电话和邮箱，发之前可以先删掉，之后在编辑器里打开隐私模式自己填。
   - When they also asked for a resume, say it is ready in a clause and start on the resume, asking for an old resume or their background with the contact-details reminder from SKILL.md.

   Open the editor with `lulicv preview` once there is a resume to show; right after installing there usually is none.

## Updating

doctor's `update` check asks the user's npm registry whether a newer LuliCV is out. If it is, tell the user once; updating is their choice, and the current version keeps working. To update:

1. `lulicv stop`, so no Bridge of the old version keeps serving the editor.
2. Install this Skill again from where it came (for example the GitHub repository AriLabo/LuliCV), replacing this Skill directory as a whole.
3. The new Skill answers `RUNTIME_MISSING` for its own version; install that runtime as above.

Resumes, settings and backups stay in the workspace and are untouched. The installer keeps the previous runtime version next to the new one.
