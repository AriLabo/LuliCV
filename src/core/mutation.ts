import jsonPatch, { type Operation } from 'fast-json-patch';
import { normalizeDocument } from './document';
import { ResumeError, conflict, errorMessage } from './errors';
import type { MutationIdentity, Transform } from './repository';
import type { ResumeDocument } from './types';
export interface ResumePatch {
  baseRevision: number;
  mutationId: string;
  operations: Operation[];
}
export interface WriteIdentity {
  baseRevision: number;
  mutationId: string;
}

export function identity(input: WriteIdentity, payload: unknown): MutationIdentity {
  if (
    !Number.isSafeInteger(input.baseRevision) ||
    input.baseRevision < 1 ||
    typeof input.mutationId !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(input.mutationId)
  )
    throw new ResumeError('VALIDATION_FAILED', '非法提交标识或 baseRevision');
  return { ...input, fingerprint: JSON.stringify(payload) };
}
function checkPath(path: unknown, write: boolean): void {
  if (typeof path !== 'string' || !path.startsWith('/') || /~(?![01])/u.test(path))
    throw new ResumeError('VALIDATION_FAILED', '无效 JSON Pointer');
  const parts = path
    .slice(1)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (parts.some((part) => ['__proto__', 'constructor', 'prototype'].includes(part)))
    throw new ResumeError('VALIDATION_FAILED', '禁止访问原型');
  // `source` is provenance; only its revision moves, to mark source changes as seen.
  if (parts[0] === 'source' && path === '/source/revision') return;
  if (!['name', 'data', 'appearance', 'target', 'parentId', 'purpose', 'sample'].includes(parts[0]))
    throw new ResumeError('VALIDATION_FAILED', '禁止修改文档元数据');
  if (['parentId', 'purpose', 'sample'].includes(parts[0]) && parts.length !== 1)
    throw new ResumeError('VALIDATION_FAILED', `非法 ${parts[0]} 路径`);
  if (write && (path === '/data' || path === '/data/sections'))
    throw new ResumeError('VALIDATION_FAILED', '整份内容替换请使用显式导入');
  if (parts[0] === 'name' && parts.length !== 1) throw new ResumeError('VALIDATION_FAILED', '非法 name 路径');
}
export function patchTransform(request: ResumePatch): Transform {
  if (!Array.isArray(request.operations) || request.operations.length === 0 || request.operations.length > 1000)
    throw new ResumeError('VALIDATION_FAILED', 'operations 必须包含 1–1000 个操作');
  for (const operation of request.operations) {
    if (!operation || !['add', 'remove', 'replace', 'move', 'copy', 'test'].includes(operation.op))
      throw new ResumeError('VALIDATION_FAILED', '不支持的 patch 操作');
    checkPath(operation.path, operation.op !== 'test');
    if (operation.path === '/source/revision' && operation.op !== 'replace' && operation.op !== 'test')
      throw new ResumeError('VALIDATION_FAILED', 'source.revision 只能 replace');
    if (operation.op === 'move' || operation.op === 'copy') checkPath(operation.from, operation.op === 'move');
  }
  return (current) => {
    let next: ResumeDocument;
    try {
      next = jsonPatch.applyPatch(structuredClone(current), request.operations, true, true, true).newDocument;
    } catch (error) {
      // fast-json-patch appends the whole document to its message; keep only what identifies the failing operation.
      const detail = error as {
        message?: string;
        name?: string;
        index?: number;
        operation?: { op?: string; path?: string };
      };
      const first = String(detail.message ?? error).split('\n')[0];
      const where = detail.operation
        ? `（第 ${(detail.index ?? 0) + 1} 个操作 ${detail.operation.op} ${detail.operation.path}）`
        : '';
      throw new ResumeError('VALIDATION_FAILED', `Patch 失败: ${first}${where}`);
    }
    return next;
  };
}
export function completeMutation(
  current: ResumeDocument,
  expected: number,
  transform: Transform,
  previous?: ResumeDocument,
): ResumeDocument | null {
  if (current.revision !== expected) conflict(current.revision);
  const result = transform(structuredClone(current), previous && structuredClone(previous));
  if (!result) return null;
  try {
    return normalizeDocument({
      ...result,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: Date.now(),
      revision: current.revision + 1,
      documentVersion: 1,
    });
  } catch (error) {
    throw new ResumeError('VALIDATION_FAILED', errorMessage(error));
  }
}
export function diffDocuments(before: ResumeDocument, after: ResumeDocument): Operation[] {
  // Omit absent optional fields so a first value diffs as `add` and a cleared one as `remove`.
  const editable = (document: ResumeDocument) => ({
    name: document.name,
    data: document.data,
    appearance: document.appearance,
    ...(document.target ? { target: document.target } : {}),
    ...(document.parentId ? { parentId: document.parentId } : {}),
    ...(document.purpose ? { purpose: document.purpose } : {}),
    ...(document.sample ? { sample: true } : {}),
    ...(document.source ? { source: document.source } : {}),
  });
  return jsonPatch.compare(editable(before), editable(after));
}
