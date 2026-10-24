<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/wordmark-dark.svg">
    <img src="docs/assets/wordmark-light.svg" alt="履栗 LuliCV" width="240">
  </picture>
</p>

<p align="center">🌰 Agent 时代，更好的简历工作站。</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@arilabo/lulicv"><img src="https://img.shields.io/npm/v/@arilabo/lulicv?label=npm&style=flat-square&labelColor=3d322b&color=a0522d" alt="npm 版本"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-a0522d?style=flat-square&labelColor=3d322b" alt="MIT License"></a>
</p>

<p align="center">给 AI Agent 用的本地简历编辑工具。简历存在你自己的电脑上，不需要账号，也不内置 AI 服务。</p>

<br/>

<p align="center"><img src="https://github.com/user-attachments/assets/feed948f-8b02-47e3-9454-66287cf8879e" width="800" alt="同一份示例简历的三种样式：商务·松绿、编辑·赭红、标准·藏蓝"></p>

<br/>

# 和 Agent 一起改简历，每一处改动实时更新

你可以把想法告诉 Agent，简历会实时更新，不满意也可以随时撤销。

<!-- README 里的图片和动图都用 GitHub 附件托管（github.com/user-attachments/assets/…），不提交进仓库 -->
<p align="center"><img src="https://github.com/user-attachments/assets/51c66eb9-1e7b-44cb-b44e-8d0e9b467800" width="800" alt="对 Agent 说「现在这个内容太拥挤了，精简一些，风格也不好看」，简历换成编辑·藏蓝主题，内容也精简了，顶部出现「撤销这次修改」按钮"></p>

<br/>

> 给 AI Agent：用户让你安装或使用履栗时，请读 [`skills/lulicv/SKILL.md`](skills/lulicv/SKILL.md)，按里面的说明安装运行时、打开编辑器和修改简历。

## 开始使用

把这句话发给你的 Agent：

```text
帮我安装一下 https://github.com/AriLabo/LuliCV 的skill，做一份简历吧。
```

Agent 需要能读取 GitHub 仓库、能在你的电脑上执行命令。它会按 Skill 里的说明装好本地运行时，不用你自己安装 CLI。首次安装需要 Node.js 18+，详见 [Skill 安装说明](skills/lulicv/references/install.md)。

装好以后直接交代任务，比如：

> 导入这份旧简历，根据我发的 JD 新建一个简历吧。

<br/>

## 能做什么

### 编辑与排版

改经历、换主题、调间距，预览按 A4 实际分页，导出的 PDF 里文字可以复制。

<p align="center"><img src="https://github.com/user-attachments/assets/3f03e9a7-7173-4f86-953e-d9ecd3a07681" width="800" alt="左边对 Agent 说第一页下面的空白太大，Agent 取消了强制分页，微调了字号和间距；右边网页里，表单旁是简历预览，打开的页面与排版面板显示正文字号 10.5 pt、栏目间距 12 pt"></p>

### 人和 Agent 共用一个工作区

你可以直接操作简历，或者让 Agent 来改。每次修改都有记录，也可以随时恢复。

<p align="center"><img src="https://github.com/user-attachments/assets/4f00baa3-9b26-431f-a006-52b4a7000381" width="800" alt="左边让 Agent 去掉顶部的「RESUME / A4」；右边网页的修改记录里，你和 Agent 的修改交替排列，每条写明是谁、改了哪里、第几版"></p>

### 针对岗位保留不同版本

从母版复制出投递版。母版后来改了，投递版会提醒你，你挑需要的内容带过去。

<p align="center"><img src="https://github.com/user-attachments/assets/51943e32-d95a-476b-9bee-84add54a3367" width="800" alt="左边让 Agent 改母版的电话、邮箱和作品集；右边的投递版「小红书 · 内容运营」顶部提示「内容运营」在复制这份之后又改了 3 处：电话、邮箱、链接，下面的简历还是原来的联系方式"></p>

### 隐私模式

开启后，Agent 读到的姓名、电话、邮箱、照片都是占位符，网页里也只显示占位，真实信息只出现在导出的 PDF 里。Agent 要导出 PDF 得你在网页里批准。有本地文件权限的 Agent 仍然可以绕过履栗直接读数据库，详见 [隐私说明](docs/privacy.md)。

<p align="center"><img src="https://github.com/user-attachments/assets/ecb34ef7-9b32-445a-a3a0-8e9a49ce3610" width="800" alt="开着隐私模式，你在网页里改了名字后问 Agent，它回答读到的姓名是 {{private:name}}，电话和邮箱也是占位符；右边网页里姓名、手机号、邮箱同样只显示占位"></p>

<br/>

## 工作方式

履栗不自带聊天 Agent，也不限定模型。

- Agent 通过 [`skills/lulicv/`](skills/lulicv/SKILL.md) 了解工具和操作规则，用 CLI 修改结构化的简历数据。
- 本地 Bridge 负责保存版本、处理同时发生的修改，让网页编辑器看到最新结果。
- 排版预览、布局检查和 PDF 导出用的是同一套渲染逻辑。

Agent 主要通过 CLI 接入，部分功能也可以走 MCP。详见 [架构说明](docs/architecture.md) 和 [MCP 说明](docs/mcp.md)。

<br/>

## 常见问题

<details>
<summary><b>要付费吗？需要注册吗？</b></summary>

履栗免费开源（MIT），不需要履栗账号。它不内置 AI，Agent 用的是你自己客户端的额度，照常计费。
</details>

<details>
<summary><b>哪些 Agent 能用？</b></summary>

能读取 GitHub 仓库、能在你电脑上执行命令的 Agent 一般都可以。目前在 macOS、Windows 上用 WorkBuddy、豆包和 Trae 实测过部分流程，其他客户端和版本还没有逐一验证。
</details>

<details>
<summary><b>国内网络能装上吗？</b></summary>

运行时从你配置的 npm 源下载，约 40 MB。npm 源是 npmmirror 时速度正常；不需要装 git，也不从 GitHub Releases 下载。电脑上没有 Chrome 或 Edge 时，还要再下载约 100 MB 的 Chromium，npm 源是 npmmirror 时同样走镜像。
</details>

<details>
<summary><b>简历存在哪里？怎么备份？</b></summary>

默认存在本机的用户数据目录里（macOS 是 `~/Library/Application Support/LuliCV/`，Windows 是 `%LOCALAPPDATA%\LuliCV\`）。可以让 Agent 换到别的本地文件夹，但不要放进 iCloud、OneDrive 或网盘同步的目录，同步可能损坏数据库。

完整备份让 Agent 运行 `lulicv backup`。网页里也能把简历导出成 JSON，但不带修改记录和母版、投递版之间的关系。
</details>

<details>
<summary><b>能导入什么格式的旧简历？</b></summary>

旧简历由你的 Agent 读取，它能读 PDF、Word 或文字，履栗就能导入。扫描件要靠 Agent 自己的文字识别。导入的内容会作为一份新简历打开，请对照原件核对一遍。
</details>

<details>
<summary><b>怎么更新？</b></summary>

有新版本时，Agent 检查环境会提示你。更新就是让 Agent 从 GitHub 重新安装这个 Skill，它会接着装好对应的运行时。简历、设置和备份都不受影响。
</details>

<br/>

## 开发

开发需要 Node.js 22.22.3 或更高版本（只通过 Skill 使用时 18+ 就够了）。

```bash
npm ci
npm run dev
```

打开 `http://127.0.0.1:5173/`。这是独立的 Browser 模式，数据存在浏览器的 IndexedDB 里，和 Agent 工作区的 SQLite 数据库不互通。

文档：[数据格式](docs/resume-schema.md) · [MCP](docs/mcp.md) · [参与开发](CONTRIBUTING.md) · [报告安全问题](SECURITY.md)

MIT License。内置字体的许可见 [THIRD_PARTY_FONTS.md](src/assets/fonts/THIRD_PARTY_FONTS.md)。
