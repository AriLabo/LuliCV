# ResumeData v1 规范

`ResumeData` 是 CVSlate 的唯一内容格式。它只描述“写什么”，不包含 Theme、字体、颜色、密度、页边距或分页结果；同一份数据可以无损切换任何 Theme。

机器可读的 JSON Schema 位于 [`schema/resume-data.schema.json`](../schema/resume-data.schema.json)，代码、CLI 与 MCP 引用同一份。应用内的“校验 JSON”检查同一组核心字段，并额外检查重复 ID，错误会带具体字段路径。

## 顶层结构

```json
{
  "schemaVersion": 1,
  "basics": {},
  "sections": []
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `schemaVersion` | `1` | 格式版本，当前固定为 1 |
| `basics` | object | 姓名和联系方式 |
| `sections` | array | 按数组顺序渲染的栏目 |

未知字段不属于 v1 规范。字段暂时不用时保留为空字符串或空数组，不要删除必填字段。

## Basic Information

`basics` 必须包含以下字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | string | 姓名 |
| `headline` | string | 职位方向或一句话定位 |
| `phone` | string | 电话 |
| `email` | string | 邮箱 |
| `location` | string | 所在地 |
| `links` | array | 链接（个人网站、GitHub、作品集、博客，或「小红书 @账号名」这样的账号），最多 3 个，元素为 `{ id, label, url, show?, icon? }`；`label` 最多 30 个字，`url` 最多 500 个字符。`show` 决定页面上显示什么：`url` 网址（不写时的默认值）、`label` 名称、`both` 名称＋网址；显示名称时 `url` 可以留空，这时链接不能点击。`icon` 是主题显示图标时链接前的标志：`none` 不显示、`link` 链接、`globe` 地球，或平台标志 `xiaohongshu`、`douyin`、`bilibili`、`weibo`、`zhihu`、`wechat`、`github`、`linkedin`；不写就自动选：先按网址的域名认平台，认不出再看名称里提到的平台，都没有时「个人网站」用地球，其他用链接 |
| `photo` | string，可选 | 浏览器本地读取的图片 data URL |

以下补充信息都可选，不写就不要带这个键；每项最多 20 个字。页面按表中顺序排成联系方式下面的一行，籍贯和工作年限带名称，其余只写值，如「男 ｜ 2000.05 ｜ 群众 ｜ 籍贯 上海」。

| 字段 | 说明 |
| --- | --- |
| `gender` | 性别，`男` 或 `女` |
| `birthDate` | 出生年月，如 `2000.05` |
| `politicalStatus` | 政治面貌，如 `群众`、`共青团员`、`中共党员` |
| `hometown` | 籍贯，如 `上海`；不是现居地（现居地写在 `location`） |
| `yearsOfExperience` | 工作年限，如 `3 年` |

照片不接受必须联网才能访问的远程资源。导出的当前简历 JSON 如果包含照片，data URL 也会包含在文件中。

## Section 公共字段

每个 section 都必须包含：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | 非空 string | 稳定且在整份简历内唯一的栏目 ID |
| `type` | enum | `summary`、`experience`、`projects`、`education`、`skills` 或 `custom` |
| `title` | string | 显示标题 |
| `visible` | boolean | 是否渲染 |
| `layout.pageBreakBefore` | boolean | 在栏目之前手动换页。这是唯一的栏目级排版设置：间距只在整份简历上调整，分页自动让标题不落单、条目拆页时两边至少各留两块 |
| `entries` | array | 条目数组；`summary` 使用空数组 |

Section 在 `sections` 中的顺序就是编辑器和简历中的顺序。`visible: false` 只隐藏，不删除内容。

## 各类 Section

### Summary

额外必填 `text: string`；`entries` 应为空数组。

### Experience

每个 entry 必须包含：`id`、`company`、`role`、`location`、`startDate`、`endDate`、`description` 和 `bullets: string[]`。

### Projects

每个 entry 必须包含：`id`、`name`、`subtitle`、`date`、`link`、`description` 和 `bullets: string[]`。

### Education

每个 entry 必须包含：`id`、`school`、`degree`、`major`、`date`、`additional` 和 `bullets: string[]`。

### Skills

每个 entry 必须包含：`id`、`category` 和 `items: string[]`。数据层不规定技能最终以行、列表还是其他文本形式展示。

### Custom

每个 entry 必须包含：`id`、`title`、`subtitle`、`date`、`link`、`description` 和 `bullets: string[]`。

## ID、日期和空值约定

- 所有 section ID 和 entry ID 必须是非空字符串（不能只有空格），并在各自范围内保持唯一；修改文字时不要改变 ID。
- 日期是展示用字符串，例如 `2022.06 — 至今`，数据层不解析或改写它。
- 可选内容使用空字符串或空数组，不使用 `null`。
- URL 也是字符串；Theme 会把非空链接渲染为可点击链接。
- 文本可以包含中文、英文和换行，但 bullet 数组的每一项都必须是字符串。
- `summary.text`、各 entry 的 `description` / `additional`、`bullets[]` 和技能 `items[]` 支持轻量行内强调：使用 `**重点文字**`。该标记作为普通字符串保存在 JSON 中，由 Theme 安全渲染为真实粗体文本；不接受 HTML。`summary.text`、`description` / `additional` 和 `bullets[]` 里的换行（`\n`）在页面上照样换行，连续的空格仍然合并。

## 导入行为

- “校验 JSON”只读取并检查，不修改任何数据。
- “覆盖当前简历”只替换当前记录的 `ResumeData`，保留简历名称、Theme、Density 和页面设置，并在覆盖前二次确认。
- “导入为新简历”创建一份新记录，沿用当前 Theme 和页面设置。
- “从文件导入（作为新简历）”还可以读取完整的 `ResumeRecord` 或“导出全部 JSON”得到的 `ResumeWorkspace`。文件里的每份简历都作为新简历加入，不覆盖现有简历，也不带修订记录、`parentId` 和 `source`；完整备份和恢复用 CLI 的 `backup` / `restore-workspace`。

所有导入、校验和持久化都在当前浏览器本地完成。

## 文档层字段（不属于 ResumeData）

以下字段属于完整简历文档，和名称、Appearance 并列，不进入 `ResumeData`，“导出纯内容 JSON”也不包含它们：

| 字段 | 说明 |
| --- | --- |
| `appearance.density` | `comfortable` / `balanced` / `dense`。只是预设：在网页选择时按当前主题的推荐值改写下面四个间距参数；渲染始终以 `appearance.layout` 中的数值为准 |
| `appearance.themeId` | 主题 id。内置 `standard`（标准）、`editorial`（编辑）、`minimal`（简约） |
| `appearance.preset` | 可选。最近一次应用的主题配色预设 id（如 `navy`），仅作记录；颜色和字体实际保存在 `layout` 中 |
| `appearance.settings` | 可选。主题声明的设置项取值，例如标准主题 `{"header": "center", "contacts": "icons", "rule": "short"}`；当前主题没有声明的项在渲染时忽略 |
| `appearance.layout.fontFamily` | 可选。`noto-sans-sc`、`misans` 或 `lxgw-neo-xihei`，用随包字体替换 Theme 自带字体；缺省时使用 Theme 字体 |
| `appearance.css` | 可选。这份简历自己的 CSS（最多 20 KB），作用于骨架的类名和变量，排在主题样式之后，换主题时保留。检查规则和主题 CSS 相同：不能加载任何外部资源，不合格的写入会被拒绝。网页上只提示有自定义样式并可以删除，不显示也不能编辑 CSS。没有自定义样式时不写这一项 |
| `target` | 可选。投递版的目标 `{company, role, jd}`，均为字符串（JD 最多 20000 字），仅保存在本地。可用 patch 的 `/target` 路径修改或删除。有 target 的是投递版，否则是主简历或方向 |
| `parentId` | 可选。在简历树中放在哪份主简历或方向下，只是组织关系，不继承任何内容。最多三层；投递版下面不能再放简历；不能形成循环。复制时默认放在来源下（来源是投递版时与它同级），可用 patch 的 `/parentId` 修改或删除（删除即放到顶层） |
| `purpose` | 可选。主简历或方向的一句话定位（最多 200 字），例如“投后端、高并发岗位”，供人和 Agent 选择方向 |
| `source` | 复制时由存储层写入 `{id, revision}`，记录内容从哪份、哪个版本复制而来；用于提示“来源在复制后又改过”。`id` 只读；`revision` 只能用 `replace /source/revision` 向前移动到来源已有的版本，表示之前的来源改动已看过 |
| `sample` | 可选，只能是 `true`。内置的虚构示例（网页“使用这份示例”、CLI `import --sample`、MCP `import_resume` 的 `sample: true`）带这个标记，复制时沿用；`remove /sample` 或网页的“取消示例标记”去掉它；Agent 不能用 patch 加上它。不是示例时不写这一项 |

## 版本策略

`schemaVersion` 只在不兼容的数据结构变化时递增。新增 Theme 不得改变 ResumeData。未来如出现 v2，应提供显式的 `v1 -> v2` 迁移函数；应用不得静默猜测未知版本。

## 最小有效示例

```json
{
  "schemaVersion": 1,
  "basics": {
    "name": "张三",
    "headline": "软件工程师",
    "phone": "13800000000",
    "email": "example@example.com",
    "location": "上海",
    "links": []
  },
  "sections": [
    {
      "id": "summary",
      "type": "summary",
      "title": "个人简介",
      "visible": true,
      "layout": {
        "pageBreakBefore": false
      },
      "text": "专注于可靠、可维护的软件系统。",
      "entries": []
    }
  ]
}
```
