# 履栗 LuliCV

**Agent 时代，更好的简历工作站。**

履栗是一套供 AI Agent 使用的本地简历编辑工具，由 Skill、CLI 和网页编辑器组成。你可以让已有的 Agent 创建或修改简历，直接在浏览器里查看 A4 排版，也可以自己接着编辑。

简历保存在本机，不需要履栗账号或内置 AI 服务。

## 开始使用

把下面这句话发给能够读取 GitHub 仓库并执行本地命令的 Agent：

> 帮我安装一下 https://github.com/AriLabo/LuliCV 的skill，做一份简历吧。

安装后，可以直接给它任务。例如：

> 导入这份旧简历，根据我发的 JD 新建一个简历吧。

Skill 会指导 Agent 安装配套的本地运行时，不需要全局安装 CLI。首次安装需要可用的 Node.js 18+ 环境；具体流程见 [Skill 安装说明](skills/lulicv/references/install.md)。

## 功能

**编辑与排版。** 修改经历、调整栏目顺序、切换主题和配色。Agent 还可以修改简历专属样式，或创建可复用的主题。编辑器按照 A4 实际分页；Agent 可以检查页面布局，再导出可复制文字的 PDF。

**人和 Agent 共用一个工作区。** Agent 的修改会更新网页中的简历；你可以直接编辑、撤销或重做。CLI 保存修订记录，支持读取历史版本和比较差异。

**针对岗位保留不同版本。** 从母版复制岗位版，保存公司、岗位和 JD。来源简历有变化时，可以查看差异，选择要带到岗位版的内容；不会自动覆盖已经定制好的部分。

**隐私模式。** 可以把姓名、电话、邮箱、照片等字段设为仅在本机保留真实值。Agent 通过履栗读取时只获得占位符；包含真实信息的 PDF 由你在网页里批准导出。隐私模式不能阻止拥有本地文件读取权限的 Agent 绕过工具访问数据库，详见 [隐私说明](docs/privacy.md)。

## 工作方式

履栗不自带聊天 Agent，也不要求使用特定模型。

- Agent 通过 [`skills/lulicv/`](skills/lulicv/SKILL.md) 了解工具与操作规则，通过 CLI 修改结构化简历。
- 本地 Bridge 负责保存版本、处理并发修改，并让网页编辑器看到最新结果。
- 排版预览、布局检查和 PDF 导出使用同一套页面渲染逻辑。

CLI 是主要的 Agent 接入方式；需要时也可以通过 MCP 使用部分功能。更多细节见 [架构说明](docs/architecture.md) 和 [MCP 说明](docs/mcp.md)。

## 兼容性

早期预览版在 macOS、Windows 上使用 WorkBuddy、豆包和 Trae 做过部分实测，这不代表所有客户端和版本均已完成兼容性验证。

首次使用需要 Agent 可以执行本地命令。运行时从用户配置的 npm 源安装；缺少可用浏览器时，可能还需要安装 Chromium。

## 开发

开发需要 Node.js 22.22.3 或更高版本；只通过 Skill 使用履栗时，Node.js 18+ 就够了。

```bash
npm ci
npm run dev
```

打开 `http://127.0.0.1:5173/`。这会启动独立的 Browser 模式，数据保存在 IndexedDB 中，不与 Agent 工作区的 SQLite 数据库共用。

文档：[数据格式](docs/resume-schema.md) · [MCP](docs/mcp.md) · [参与开发](CONTRIBUTING.md) · [报告安全问题](SECURITY.md)

MIT License。内置字体的许可见 [THIRD_PARTY_FONTS.md](src/assets/fonts/THIRD_PARTY_FONTS.md)。
