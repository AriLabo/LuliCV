# Resume Workspace 架构

履栗是 Human + Agent 共用的中文简历工作区。ResumeData v1 是公开 JSON 内容协议；Appearance 是 Theme、密度和排版状态。完整 ResumeDocument 增加 documentVersion 和 revision，包含名称、内容、Appearance、ID 和时间戳，以及可选的投递目标 target 与复制来源 source（见 [resume-schema](resume-schema.md)）。

```text
Browser Editor → ResumeService → BrowserRepository → IndexedDB
Workspace Web → ResumeService → BridgeRepository ─┐
CLI → authenticated local HTTP ──────────────────┤
                                                  ↓
                                      Bridge ResumeService
                                                  ↓
                                         SqliteRepository
                                                  ↓
                        Theme / Pagination / Layout QA / PDF
```

src/core 不依赖 React、DOM、Node 或文件系统，维护文档归一化、校验、RFC 6902 patch 和 Service。数据损坏时明确报错，不用示例覆盖。

src/studio 保留编辑器和逐文档状态机：committed、draft、in-flight、conflict。每份文档一次提交；外部更新通过 BroadcastChannel（Browser）或 SSE（Workspace）触发重新读取。恢复网络后重建事件流、重新读取版本，不回退较新状态。草稿单独保存在浏览器恢复区，不自动合并冲突。Undo/Redo 通过同一 Service 提交，外部修改使旧历史失效。

agent/bridge/sqlite-repository.ts 是 Node-only adapter。数据库表为 workspace_meta、resumes、resume_revisions、mutations；完整 JSON snapshot 不拆成经历、bullet、教育等关系表。head、snapshot、receipt 同一 BEGIN IMMEDIATE 事务提交；receipt 用请求 fingerprint 校验并引用 immutable revision，不重复保存文档。删除持久保存 tombstone，ID 不复用。来源由 Bridge 凭证赋值，当前区分 human/agent/system/import，不宣称验证 Agent 的具体供应商身份。

数据库 schema 版本与内容 schema 分离。新数据库事务建表，过新的数据库拒绝打开。运行时要求 Node 自带 SQLite 3.51.3+（该版本包含 WAL-reset 修复；Node 22.22.3+、24.15+、26+ 满足），只检查 SQLite 版本，foreign_keys ON、WAL、synchronous FULL、有限 busy timeout。Workspace 进程锁保留，SQLite 事务锁不是 Bridge singleton。备份与离线恢复见 Skill 的 [recovery.md](../skills/lulicv/references/recovery.md)。

SQLite 保存每份简历的所有版本，网页的修订记录可以查看历史版本、比较差异、撤销和重做。照片仍为本地 data URL；Browser/Workspace 不双写。无任意文件手改同步、自动合并、Hosted、ATS scoring或内置 AI。本地 stdio MCP 和 CLI 一样，Bridge 没运行时在后台启动一个，自己只通过 HTTP 调用 Bridge，不成为第二个数据库写者；工具与配置见 [mcp.md](mcp.md)。

## 存储与事务约束

- 表语义：`resumes` 保存 head 与删除标记，`resume_revisions` 保存完整 ResumeDocument，`mutations` 保存请求 fingerprint 与结果 revision。
- 每个 mutation 在 BEGIN IMMEDIATE 内按固定顺序执行：先查 receipt，再校验 revision，然后应用同步 JSON Patch 并校验，最后一次性写入 snapshot / head / receipt；COMMIT 之后才发送事件。
- 事务中不得 await、渲染或发起网络调用；真实 renderer 在事务外运行。
- `SQLITE_BUSY` 是存储忙，不是 revision conflict，不得按冲突返回给调用者。
- 补丁协议固定为 RFC 6902 JSON Patch；不使用 SQLite MergePatch，也不允许整份替换内容。
- 首版保留所有 snapshot 和 receipt，不自动清理；每个 JSON 文档最多 8 MiB，照片最多 2 MiB。

### 存储验收

- 提交成功但响应丢失时，Bridge 重启后以同一 mutation 重试返回原结果，且不增加 revision。
- 任一步失败时，head / snapshot / receipt 都保持不变。
- 删除可重试；第二个 Bridge 必须被拒绝。
- 数据库版本过新时拒绝打开。
- 活动 WAL 状态下用 backup API 生成的备份可恢复；进程终止前后的提交结果一致。

## Renderer

Theme 输出 ThemeBlock，标注 heading / entry header / description / bullet，以及 keepWithNext、groupId、pageBreakBefore 等语义。ResumePreview 在隐藏 A4 DOM 测量，然后 pagination 分配页面：同一条目（或技能栏的各行）拆页时两边至少各留两块，较短的条目因此整条换页；超大 entry 可按 bullet 拆分，单个超高 bullet 报 QA。间距只有整份简历一套，栏目只能手动设「从新页开始」。

Human Preview、独立 /render 入口、Agent inspect 和 PDF 复用 ResumePreview。渲染等待字体、照片解码、分页与 QA。Agent 渲染只允许 Bridge 同源资源，拒绝远程请求。固定 revision 的 JSON 快照在任务期间不可变；export 可复用最近 inspect 的版本，即使编辑器已继续修改。不可用的旧快照明确拒绝，不偷偷导出最新版本。PDF 使用同一 print CSS、真实可复制文字和链接；用户网页打印仍使用 window.print。

Theme 目录继续自动发现，核心边界不要求目录整体迁移。新的 SQL adapter 不进入 Vite browser bundle。

## 外部实践

[SQLite transaction](https://www.sqlite.org/lang_transaction.html)、[WAL](https://www.sqlite.org/wal.html)、[Backup](https://www.sqlite.org/backup.html)、[Node SQLite](https://nodejs.org/download/release/latest-jod/docs/api/sqlite.html) 是事务与运行时依据。JSON/SQLite 的实践参考 [Signal Desktop](https://github.com/signalapp/Signal-Desktop/blob/main/ts/sql/Server.node.ts)；显式迁移参考 [Actual Budget](https://actualbudget.org/docs/contributing/project-details/database) 和 [Joplin](https://github.com/laurent22/joplin/blob/dev/packages/lib/JoplinDatabase.ts)。这些实践不替代本项目的协作和故障验收。
