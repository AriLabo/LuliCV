import { errorResult, type OperationCategory } from '../runtime/guidance';
import { isPortableFilename } from '../runtime/files';
import { buildInfo } from '../runtime/build';
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { mkdir, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { awaitExport, bridgeRequest, editorStatus, ensureBridge, privacyOf, type ExportApproval } from '../cli/client';
import { writeOutput } from '../cli/output';
import { ResumeError } from '../../src/core/errors';
import type { ResumeDocument } from '../../src/core/types';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const pointer = z.string().startsWith('/').max(4096);
const operation = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('add'), path: pointer, value: z.unknown() }),
  z.strictObject({ op: z.literal('replace'), path: pointer, value: z.unknown() }),
  z.strictObject({ op: z.literal('test'), path: pointer, value: z.unknown() }),
  z.strictObject({ op: z.literal('remove'), path: pointer }),
  z.strictObject({ op: z.literal('move'), path: pointer, from: pointer }),
  z.strictObject({ op: z.literal('copy'), path: pointer, from: pointer }),
]);
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
function result(value: Record<string, unknown>, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value,
    ...(isError ? { isError: true } : {}),
  };
}
async function guarded(action: () => Promise<Record<string, unknown>>, category: OperationCategory = 'read') {
  try {
    return result(await action());
  } catch (error) {
    return result(errorResult(error, category), true);
  }
}
/** `cli` is the CLI entry the Bridge is started from when none is running. */
export function createMcpServer(root: string, workspaceId: string, cli: string) {
  const server = new McpServer({ name: 'lulicv', version: buildInfo.version });
  const bridge = async () => (await ensureBridge(root, cli, { expectedWorkspaceId: workspaceId })).runtime;
  const request = async (route: string, method = 'GET', value?: unknown) =>
    bridgeRequest(await bridge(), route, method, value);
  // After a write, whether the person is watching in the editor, and if not a link to open it.
  const written = async (response: Response) => ({
    ...((await response.json()) as Record<string, unknown>),
    editor: await editorStatus(await bridge()),
  });
  server.registerTool(
    'get_resume_schema',
    {
      description: '获取当前单份 ResumeData v1 JSON Schema。导入前查询；不能提交 Workspace、id 或 revision。',
      inputSchema: z.strictObject({}),
      annotations: readOnly,
    },
    () => guarded(async () => await (await request('/api/schema/resume-data')).json()),
  );
  server.registerTool(
    'import_resume',
    {
      description:
        '完整校验后幂等创建新简历。缺失事实不以示例补齐，导入后必须在网页对照原材料核对。结果未知时使用相同 mutationId 与参数重试。warnings 仅为格式提示。sample: true 且不带 data 时创建内置的虚构示例简历，供用户试用。',
      inputSchema: z.strictObject({
        mutationId: id,
        data: z.record(z.string(), z.unknown()).optional(),
        sample: z.literal(true).optional(),
        name: z.string().max(200).optional(),
        appearance: z.record(z.string(), z.unknown()).optional(),
      }),
      annotations: write,
    },
    (input) => guarded(async () => await written(await request('/api/import-resume', 'POST', input)), 'write'),
  );
  server.registerTool(
    'list_themes',
    {
      description:
        '查询已注册 Theme、默认排版设置，以及 layout：四项间距的允许范围、密度预设、可选字体和栏目分页开关。修改使用 patch_resume。',
      inputSchema: z.strictObject({}),
      annotations: readOnly,
    },
    () => guarded(async () => await (await request('/api/themes')).json()),
  );
  server.registerTool(
    'list_resumes',
    {
      description:
        '列出当前本地工作区简历摘要：parentId 是在简历树中的位置（只是组织关系，不继承内容），purpose 是主简历或方向的定位，target 是投递版的目标公司与岗位，source 是复制来源，sample 表示内置的虚构示例。',
      inputSchema: z.strictObject({}),
      annotations: readOnly,
    },
    () =>
      guarded(async () => {
        const response = await request('/api/resumes');
        const documents = (await response.json()) as ResumeDocument[];
        return {
          ...privacyOf(response),
          resumes: documents.map(({ id, name, revision, updatedAt, target, source, parentId, purpose, sample }) => ({
            id,
            name,
            revision,
            updatedAt,
            ...(parentId ? { parentId } : {}),
            ...(purpose ? { purpose } : {}),
            ...(sample ? { sample } : {}),
            ...(target ? { target: { company: target.company, role: target.role } } : {}),
            ...(source ? { source } : {}),
          })),
        };
      }),
  );
  server.registerTool(
    'get_resume',
    {
      description: '读取真实简历、Appearance 和 revision。修改前先读取。带 revision 时读取那个历史版本。',
      inputSchema: z.strictObject({ id, revision: revision.optional() }),
      annotations: readOnly,
    },
    ({ id, revision }) =>
      guarded(async () => await (await request(`/api/resumes/${id}${revision ? `?revision=${revision}` : ''}`)).json()),
  );
  server.registerTool(
    'get_resume_history',
    {
      description:
        '列出一份简历的修改记录，新的在前：每个 revision 是谁改的（human、agent、import、system）、什么时候、改了哪些地方；restoredFrom 表示那次是恢复到更早的 revision。',
      inputSchema: z.strictObject({ id }),
      annotations: readOnly,
    },
    ({ id }) => guarded(async () => await (await request(`/api/resumes/${id}/history`)).json()),
  );
  server.registerTool(
    'duplicate_resume',
    {
      description:
        '从已读取的 sourceRevision 复制岗位版本。parentId 指定放在哪个主简历或方向下（省略时放在来源下，或与被复制的投递版同级）。mutationId 必须稳定；结果未知时使用完全相同参数重试。',
      inputSchema: z.strictObject({
        id,
        sourceRevision: revision,
        mutationId: id,
        name: z.string().max(200).optional(),
        parentId: id.optional(),
      }),
      annotations: write,
    },
    ({ id, sourceRevision, mutationId, name, parentId }) =>
      guarded(
        async () =>
          await written(
            await request(`/api/resumes/${id}/duplicate`, 'POST', {
              expectedSourceRevision: sourceRevision,
              mutationId,
              name,
              ...(parentId ? { parentId } : {}),
            }),
          ),
        'write',
      ),
  );
  server.registerTool(
    'patch_resume',
    {
      description:
        '提交有限 JSON Patch，覆盖 name、data、appearance、target、parentId、purpose、sample（用户要求时 remove，去掉示例标记），以及 /source/revision（把来源改动标记为已看过）。冲突后重新读取，禁止盲目重试旧草稿。结果未知时保留原 mutationId 与参数重试。',
      inputSchema: z.strictObject({
        id,
        baseRevision: revision,
        mutationId: id,
        operations: z.array(operation).min(1).max(1000),
      }),
      annotations: { ...write, destructiveHint: true },
    },
    ({ id, ...patch }) =>
      guarded(async () => await written(await request(`/api/resumes/${id}`, 'PATCH', patch)), 'write'),
  );
  server.registerTool(
    'restore_resume',
    {
      description:
        '把较早的 revision 恢复成最新版本（名称、内容、外观、投递目标整份回去，简历树位置不变）；之后的版本仍留在修改记录里，可以再恢复回来。只想撤掉其中一部分时，读取那个 revision 对照后用 patch_resume 改。baseRevision 是最近读取到的 revision。',
      inputSchema: z.strictObject({ id, revision, baseRevision: revision, mutationId: id }),
      annotations: { ...write, destructiveHint: true },
    },
    ({ id, ...input }) =>
      guarded(async () => await written(await request(`/api/resumes/${id}/restore`, 'POST', input)), 'write'),
  );
  server.registerTool(
    'validate_resume',
    { description: '验证当前简历结构并返回内容警告。', inputSchema: z.strictObject({ id }), annotations: readOnly },
    ({ id }) => guarded(async () => await (await request(`/api/resumes/${id}/validate`)).json()),
  );
  server.registerTool(
    'inspect_resume_layout',
    {
      description: '使用真实浏览器 Renderer 检查固定 revision 的排版。旧版本不可用时明确报错。',
      inputSchema: z.strictObject({ id, revision, maxPages: revision.optional() }),
      annotations: readOnly,
    },
    ({ id, ...options }) =>
      guarded(async () => await (await request(`/api/resumes/${id}/inspect`, 'POST', options)).json()),
  );
  const filename = z
    .string()
    .min(5)
    .max(128)
    .refine(
      (name) =>
        // eslint-disable-next-line no-control-regex -- control characters are exactly what this rejects
        isPortableFilename(name) && !name.startsWith('.') && !/[\\/\x00-\x1f]/.test(name) && name.endsWith('.pdf'),
      '需要不含路径的 .pdf 文件名',
    );
  server.registerTool(
    'export_resume_pdf',
    {
      description:
        '用户确认后导出已检查的固定 revision PDF 到工作区 exports/。filename 仅为 PDF 文件名，已有文件不覆盖。隐私模式下只能导出当前 revision，不需要 filename：用户在网页里批准后 PDF 下载到用户的浏览器，这里只返回页数；用户一直没处理时返回 status: pending 和 requestId，带上 requestId 再调用继续等待。',
      inputSchema: z.strictObject({
        id,
        revision,
        filename: filename.optional(),
        requestId: z.string().uuid().optional(),
      }),
      annotations: { ...write, idempotentHint: false },
    },
    ({ id, revision, filename, requestId }) =>
      guarded(async () => {
        const runtime = await bridge();
        const approval = async (state: ExportApproval) => {
          // Stay under the client's tool-call timeout; the agent calls again with requestId to keep waiting.
          const done = await awaitExport(runtime, state, Date.now() + 50000);
          if (done.status === 'pending')
            return {
              status: 'pending',
              requestId: done.requestId,
              id,
              revision,
              ...(done.webOpen === false ? { webOpen: false } : {}),
              message:
                done.webOpen === false
                  ? done.message
                  : '用户还没处理；加 requestId 再调用继续等待（请求 5 分钟后自动取消）',
            };
          return {
            status: 'approved',
            id,
            revision,
            pages: done.pages,
            delivered: 'browser',
            message: done.message,
            ...(filename ? { note: '隐私模式下 PDF 由用户的浏览器下载，没有写入 exports/' } : {}),
          };
        };
        if (requestId) {
          const state = (await (
            await bridgeRequest(runtime, `/api/export-requests/${requestId}`)
          ).json()) as ExportApproval;
          if (state.id !== id || state.revision !== revision)
            throw new ResumeError('VALIDATION_FAILED', 'requestId 与 id、revision 不匹配');
          return approval(state);
        }
        if (
          !filename &&
          !((await (await bridgeRequest(runtime, '/api/health')).json()) as { privacyMode?: boolean }).privacyMode
        )
          throw new ResumeError('VALIDATION_FAILED', '需要 filename');
        const response = await bridgeRequest(runtime, `/api/resumes/${id}/export`, 'POST', { revision });
        if (response.status === 202) return approval((await response.json()) as ExportApproval);
        if (!filename) throw new ResumeError('VALIDATION_FAILED', '需要 filename');
        if (
          response.headers.get('x-resume-revision') !== String(revision) ||
          response.headers.get('content-type') !== 'application/pdf'
        )
          throw new ResumeError('VALIDATION_FAILED', 'PDF 响应版本或格式不匹配');
        const directory = path.join(root, 'exports');
        try {
          if ((await lstat(directory)).isSymbolicLink())
            throw new ResumeError('VALIDATION_FAILED', 'exports 不能是符号链接');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        await mkdir(directory, { recursive: true, mode: 0o700 });
        if (
          (await lstat(directory)).isSymbolicLink() ||
          (await realpath(directory)) !== path.join(await realpath(root), 'exports')
        )
          throw new ResumeError('VALIDATION_FAILED', 'exports 不能是符号链接');
        const output = await writeOutput(
          root,
          path.join(directory, filename),
          Buffer.from(await response.arrayBuffer()),
        );
        // Saves after the inspected revision make this PDF older than the resume.
        const latest = Number(response.headers.get('x-resume-latest-revision'));
        return {
          id,
          revision,
          output,
          ...(latest > revision
            ? {
                latestRevision: latest,
                note: `导出的是第 ${revision} 版，这份简历之后又改过，现在是第 ${latest} 版；交付前确认用户要的是哪一版`,
              }
            : {}),
        };
      }, 'export'),
  );
  return server;
}
