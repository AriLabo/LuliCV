# 隐私模式

让 AI agent 改简历时，agent 读到的内容会发给云端模型。不希望姓名、手机号、照片这类信息离开本机，就开启隐私模式：agent 照常改内容、调版面，但只看到占位；真实信息存在本机，只在你批准导出的 PDF 里填入。

隐私模式只在工作区模式（`lulicv preview` 打开的网页）里可用；浏览器模式没有 agent 接入，不需要它。

## 能防什么，不能防什么

隐私模式开启后，通过履栗读取简历的 agent 只能看到占位，真实信息只出现在你在浏览器里批准的 PDF 中。这能防止 AI 助手在正常工作时把你的联系方式发给模型服务商；但它不能阻止拥有本机命令行权限的程序直接读取数据文件，需要更强隔离时请为 agent 开启沙箱（见下面的 [Claude Code 示例](#用-claude-code-沙箱挡住数据文件)）。即使隐藏了联系方式，公司、学校、时间的组合仍可能识别出你本人。

另外两点：

- agent 能操作你的浏览器时（比如浏览器插件、内置浏览器），它也能点网页上的按钮。不是你本人要求的导出，请拒绝。
- 导出的 PDF 里是真实信息。把 PDF 交给 agent 看，就等于把信息给了它。

## 开启

1. 点预览上方工具栏的「隐私模式」。
2. 勾选要隐藏的信息。默认勾选姓名、电话、邮箱、照片、出生年月、籍贯、政治面貌；所在地、链接网址（个人网站、GitHub 等）可以按需加上。链接只隐藏网址，名称照常显示；名称里写了真名的话，会和别处的真名一样换成【姓名】。出生年月、籍贯、政治面貌只在「补充信息」那一栏里隐藏：「上海」「群众」这类词在经历里也常见，正文里写的不会被换掉，需要的话自己改掉。
3. 点「下一步」，确认会收起哪些内容。如果几份简历里同一项写得不一样（比如换过手机号），这里会让你选导出时统一用哪个。
4. 点「开启隐私模式」。

开启后，各份简历里这些信息换成占位，网页显示为【手机号】【邮箱】这样的标签，工具栏的「隐私模式」变成蓝色。agent 也可以按你的要求用 `lulicv privacy on` 开启或加隐藏项，但关闭、减少隐藏项只能在网页里做。

## 修改隐私信息

点工具栏的「隐私模式」，打开「隐私信息」：

- 已保存的值不再显示，只能「重新填写」。想核对，看导出的 PDF。
- 填写时输入的内容显示为圆点，需要核对时点输入框里的「显示」。
- 勾选或取消某一项，就是增减隐藏项，同样会先让你确认。
- 「关闭隐私模式…」会把真实信息写回各份简历，之后预览和 agent 都会看到。已填写的值仍留在本机，下次开启时可以再用。

简历正文里的占位可以像普通文字一样删除、挪动或复制，导出时每一处都会换成真实内容。

## agent 导出 PDF

agent 请求导出时，网页会弹出「agent 请求导出 PDF」，写明哪份简历、第几版、几页、会填入哪些信息。

- **批准并导出**：PDF 填入真实信息，下载到这个浏览器的下载目录。agent 只收到页数，拿不到文件和路径。
  如果浏览器弹出保存对话框而你点了取消，文件不会保存，但网页无法知道这一点，agent 收到的仍是成功。这时让 agent 再请求一次就行。
- **拒绝**，或 5 分钟内没处理：这次导出取消，agent 会问你下一步。
- 如果请求之后简历又改过，网页不能批准这一版，请拒绝，让 agent 重新检查后再请求。

自己导出直接点顶栏「导出 PDF」，不需要批准。

## 导出记录

「隐私信息」里点「导出记录」，能看到隐私模式下每次导出：时间、简历、版本、页数，以及是你自己导出、批准的 agent 请求，还是被拒绝或过期的请求。记录只存在本机，保留最近 50 条，不保存 PDF。

## 用 Claude Code 沙箱挡住数据文件

隐私模式只管通过履栗读取的内容。agent 如果直接打开工作区的数据库文件，仍能读到真实信息。Claude Code 的[沙箱](https://code.claude.com/docs/en/sandboxing)可以禁止 agent 执行的命令读取这些文件，[权限规则](https://code.claude.com/docs/en/permissions)可以禁止它用读文件工具打开。

> 下面的配置按 Claude Code 官方文档写成，还没有在真机上逐项验证。使用前请先自己确认一下：开启后让 agent 执行 `cat` 读数据库，应该被拒绝。

### 要挡住的文件

以工作区在 `~/lulicv` 为例：

| 文件 | 内容 |
| --- | --- |
| `lulicv.db`、`lulicv.db-wal`、`lulicv.db-shm` | 简历和隐私信息 |
| `.lulicv/before-restore-*` | 恢复备份前自动留的副本 |
| `.lulicv/backup-*.db` | 网页备份时的临时文件 |
| 浏览器下载目录里的 PDF（如 `~/Downloads/*.pdf`） | 导出的简历 |

不要挡 `.lulicv/runtime.json` 和 `lulicv.json`：CLI 要读它们才能连上 Bridge。

### 配置

写进 `~/.claude/settings.json`（所有项目生效）或 agent 工作目录下的 `.claude/settings.json`：

```json
{
  "sandbox": {
    "enabled": true,
    "network": {
      "allowLocalBinding": true
    },
    "filesystem": {
      "denyRead": [
        "~/lulicv/lulicv.db*",
        "~/lulicv/.lulicv/before-restore-*",
        "~/lulicv/.lulicv/backup-*",
        "~/Downloads/*.pdf"
      ]
    }
  },
  "permissions": {
    "deny": [
      "Read(~/lulicv/lulicv.db*)",
      "Read(~/lulicv/.lulicv/before-restore-*)",
      "Read(~/lulicv/.lulicv/backup-*)",
      "Read(~/Downloads/*.pdf)"
    ]
  }
}
```

- `sandbox.filesystem.denyRead` 挡住 agent 执行的命令（`cat`、`sqlite3`、`pdftotext` 等）。它管不到 Claude Code 自带的读文件工具，所以 `permissions.deny` 里再写一遍 `Read(...)`。
- `network.allowLocalBinding` 让沙箱里的 CLI 能连本机的 Bridge（Bridge 只监听 `127.0.0.1`，每个工作区用固定端口）。官方文档写明这一项在 macOS 上允许连接 localhost。其他系统上如果 CLI 连不上，可以把 CLI 加进 `sandbox.excludedCommands`，例如 `"node /Skill目录/scripts/lulicv.mjs *"`；这样 CLI 本身不在沙箱里运行，但 agent 的其他命令仍受限制。
- 沙箱挡不住一条路：CLI 要用 token 连 Bridge，agent 因此也能自己兑换 `lulicv preview` 的链接，以你的身份登录浏览器去批准导出。这和读数据库一样属于故意绕路，靠 Skill 里的规则约束。
- 不希望命令绕开沙箱执行，可以在 `sandbox` 里加 `"allowUnsandboxedCommands": false`，关掉「沙箱里失败就到沙箱外重试」。

### Bridge 由你来启动

沙箱对 agent 启动的所有子进程都生效。agent 在沙箱里执行 `lulicv preview` 启动的 Bridge 也读不了数据库，无法正常工作。所以开了沙箱后，请自己启动 Bridge：在自己的终端里执行，或在 Claude Code 里用 `!` 开头直接输入（`!` 输入的命令一般不进沙箱）：

```bash
node "<Skill目录>/scripts/lulicv.mjs" preview
```

Bridge 启动后，agent 在沙箱里照常用 CLI 或 MCP 工作。
