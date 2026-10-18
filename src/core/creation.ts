import { normalizeDocument } from './document';
import { ResumeError, conflict } from './errors';
import type { ResumeDocument } from './types';
export interface CreationIdentity {
  mutationId: string;
  fingerprint: string;
}
export interface DuplicateSource {
  id: string;
  name?: string;
  expectedRevision?: number;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}
export function creationIdentity(mutationId: string, payload: unknown): CreationIdentity {
  if (typeof mutationId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(mutationId))
    throw new ResumeError('VALIDATION_FAILED', '非法创建 mutationId');
  return { mutationId, fingerprint: JSON.stringify(canonical(payload)) };
}
export function completeCreation(
  candidate: ResumeDocument,
  source?: DuplicateSource,
  current?: ResumeDocument,
): ResumeDocument {
  if (candidate.revision !== 1) throw new ResumeError('VALIDATION_FAILED', '新文档必须从 revision 1 开始');
  if (!source) return normalizeDocument(candidate);
  if (!current) throw new ResumeError('NOT_FOUND', source.id);
  if (source.expectedRevision !== undefined) {
    if (!Number.isSafeInteger(source.expectedRevision) || source.expectedRevision < 1)
      throw new ResumeError('VALIDATION_FAILED', '非法 source revision');
    if (source.expectedRevision !== current.revision) conflict(current.revision);
  }
  return normalizeDocument({
    ...candidate,
    name: source.name ?? `${current.name} 副本`,
    data: structuredClone(current.data),
    appearance: structuredClone(current.appearance),
    source: { id: current.id, revision: current.revision },
  });
}
