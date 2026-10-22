# 本地 stdio MCP

多数 Agent 都能执行命令，推荐优先使用 CLI（见 [Skill](../skills/lulicv/SKILL.md)）；MCP 仅在客户端不能执行命令时使用。适配器只通过 HTTP 连接 Bridge。

MCP 是 Bridge 的客户端，不打开 SQLite，也不停止 Bridge；Bridge 没运行时，它像 CLI 一样在后台启动一个。运行时按 Skill 的[安装说明](../skills/lulicv/references/install.md)安装。

标准本地 stdio 配置示例，和 Skill 的 [MCP 配置说明](../skills/lulicv/references/mcp-client.md)一致；客户端具体入口和外层字段可能不同，路径要写绝对路径：

```json
{
  "mcpServers": {
    "lulicv": {
      "command": "node",
      "args": ["<Skill 目录的绝对路径>/scripts/lulicv.mjs", "mcp"]
    }
  }
}
```

`scripts/lulicv.mjs` 在 Node 18 或更新版本上都能运行，它再用安装运行时时选定的 Node（22.22.3 或更新）启动 MCP 服务，和 CLI 走同一条路。用 `npm install -g` 直接装了运行时包的开发环境，也可以把 `command` 写成 `lulicv-mcp`。

目前的实测都走 CLI，还没有在真实客户端里完整走过 MCP。GUI 应用的 PATH 和 Windows 的 `.cmd` 启动器都要在客户端里实测；不要把协议级 SDK 测试当作实机兼容证据。

不要把 Bridge token 写进客户端配置或对话。适配器从 CLI 所用的同一个工作区读取凭证，每次调用校验回环 URL、工作区 ID、Bridge PID 和协议版本。重启 Bridge 后，既有 MCP 进程会读取新凭证继续连接；如果工作区被替换为另一 ID，拒绝调用。MCP 关闭不停止 Bridge。stdout 仅承载 MCP JSON-RPC，启动错误输出 stderr。

## 工具与契约

| 工具 | 参数 | 行为 |
|---|---|---|
| get_resume_schema | 无 | 返回同一 ResumeData v1 Schema |
| list_themes | 无 | 返回注册 metadata 与默认排版 |
| import_resume | mutationId, data, name?, appearance? | 校验后幂等创建新简历，返回 document/warnings；先核对原文 |
| list_resumes | 无 | 仅返回 ID、名称、revision、更新时间摘要 |
| get_resume | id | 读取完整当前文档 |
| duplicate_resume | id, sourceRevision, mutationId, name? | 事务内复制指定当前源版本；持久幂等 |
| patch_resume | id, baseRevision, mutationId, operations | 同 CLI 的受限 RFC 6902 原子写入 |
| validate_resume | id | 检查当前结构及内容警告 |
| inspect_resume_layout | id, revision, maxPages? | 使用真实 DOM 检查并保留固定快照 |
| export_resume_pdf | id, revision, filename?, requestId? | 写入工作区 exports/；只接受 .pdf 文件名，不覆盖已有文件，不跟随 exports 符号链接。隐私模式下不写文件，见下文 |

成功返回 JSON 文本及 structuredContent。业务错误返回 isError=true，JSON 包含 code、message、针对操作的 nextAction，冲突含 currentRevision。参数错误由 SDK 拒绝。写入（import_resume、duplicate_resume、patch_resume）的结果带 `editor`：用户开着编辑器时为 `{"open": true}`，否则带一个新的一次性 `url` 和 `nextAction`。Bridge 启动失败时返回错误，message 带 `.lulicv/bridge.log` 的最后一行。

复制岗位版本前先 get，并将读到的 revision 作为 sourceRevision。复制和 patch 的 mutationId 由调用者生成，重试必须保留完全相同的参数。响应丢失时重复调用会返回首次提交结果；参数变化必须使用新 ID。冲突时重新 get、理解人工修改并重新计算 patch，不能仅更换 baseRevision 重放旧数组路径。

修改后 validate、inspect，用户确认后 export 同一 revision。工具描述和 Skill 提供此工作流程，适配器不替 Agent 判断用户授权。旧快照未保留或 Bridge 重启丢失快照时明确报错，不能悄悄导出最新版。

隐私模式下 `filename` 可省略：导出请求先发到网页，由用户批准，PDF 由用户的浏览器下载，工具只返回 `{status: "approved", pages, delivered: "browser"}`，拿不到文件和路径。工具最多等 50 秒；用户还没处理时返回 `{status: "pending", requestId}`，用相同 id、revision 加 `requestId` 再调用继续等，请求 5 分钟后自动取消。没有打开的网页时返回 `webOpen: false`，请用户打开网页。用户拒绝或超时报 `EXPORT_DECLINED`；已有别的请求在等时报 `EXPORT_PENDING`。请求之后简历又被保存过，网页不能批准，需拒绝后重新 inspect 再请求。

重新构建后先 stop，下一次调用会用新的构建启动 Bridge。MCP 不提供远程 HTTP 服务、云端认证或客户端自动配置；修订记录只在网页里查看，MCP 没有对应工具。

验收使用官方 TypeScript MCP SDK 客户端与真实 stdio 子进程，覆盖双客户端共享、重启、幂等、冲突、非法路径及实际中文 PDF。参考：[官方 TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)。
