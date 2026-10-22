# 参与开发

## 环境

- Node.js 22.22.3 或更高版本，`.nvmrc` 里写的就是这个版本。这是开发要求；用户通过 Skill 安装运行时，只需要 Node.js 18+。
- Playwright 自带的 Chromium：`npx playwright install chromium`。e2e 测试用它；PDF 渲染相关的测试也优先用它，找不到时才退回系统里的 Chrome 或 Edge。

## 常用命令

```bash
npm ci
npm run dev          # 浏览器模式，打开 http://127.0.0.1:5173/
npm test             # 单元测试和集成测试
npm run lint         # ESLint
npm run format       # 用 Prettier 统一格式；npm run format:check 只检查
npm run build
npm run test:e2e     # 先运行 npm run build：部分用例直接加载 dist/
```

修改 `src/themes/` 下的内置主题后，运行 `npm run themes:generate` 更新主题目录；`npm test` 和 `npm run build` 之前会检查它是否最新。

## 截图对比

`e2e-studio/lulicv.spec.ts` 里有 12 个页面截图用例，基线图片在 `e2e-studio/lulicv.spec.ts-snapshots/`。目前只有维护者在 macOS 上生成的基线，文件名带 `-darwin`。

在 Linux 或 Windows 上，这些用例会因为找不到本平台的基线而失败。先运行 `npm run snapshots:update` 生成本机基线，之后再跑 `npm run test:e2e` 就能比对你的改动。在其他平台生成的基线暂时不用提交。

有意修改页面外观时，同样运行 `npm run snapshots:update`，逐张看过新图片再提交。

## 提交前

- `npm test`、`npm run lint`、`npm run format:check`、`npm run build`、`npm run test:e2e` 都能通过。
- 测试和示例只用虚构的姓名、电话、邮箱和经历。
- 隐私或安全问题不要公开提 issue，见 [SECURITY.md](SECURITY.md)。
