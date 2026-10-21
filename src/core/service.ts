import { validateResumeData, isAppearance } from './validation';
import { creationIdentity } from './creation';
import { sampleResumeInput } from './defaults';
import { normalizeDocument, normalizeImport, validateDocument } from './document';
import { ResumeError } from './errors';
import { identity, patchTransform, type ResumePatch, type WriteIdentity } from './mutation';
import type { ResumeRepository } from './repository';
import type { ResumeDocument, ResumeRecord } from './types';
import { defaultParentForCopy, placementError, resumeKind } from './tree';
export class ResumeService {
  constructor(
    readonly repository: ResumeRepository,
    private readonly makeRecord: (name?: string) => ResumeRecord,
  ) {}
  list() {
    return this.repository.list();
  }
  get(id: string) {
    return this.repository.get(id);
  }
  async create(
    input: {
      name?: string;
      data?: ResumeRecord['data'];
      appearance?: ResumeRecord['appearance'];
      target?: ResumeRecord['target'];
      sample?: true;
    } = {},
    mutationId?: string,
  ) {
    input = structuredClone(input);
    const record = this.makeRecord(input.name);
    const document = normalizeDocument({
      ...record,
      data: input.data ?? record.data,
      appearance: input.appearance ?? record.appearance,
      ...(input.target ? { target: input.target } : {}),
      ...(input.sample ? { sample: true } : {}),
    });
    return this.repository.create(
      document,
      creationIdentity(mutationId === undefined ? `create-${document.id}` : mutationId, { kind: 'create', input }),
    );
  }
  async duplicate(
    id: string,
    name?: string,
    options: { mutationId?: string; expectedSourceRevision?: number; parentId?: string } = {},
  ) {
    const documents = await this.repository.list();
    if (options.parentId !== undefined) {
      const error = placementError(documents, '__new__', options.parentId, 'job');
      if (error) throw new ResumeError('VALIDATION_FAILED', error);
    }
    const parentId = options.parentId ?? defaultParentForCopy(documents, id);
    const candidate = normalizeDocument({ ...this.makeRecord(name), ...(parentId ? { parentId } : {}) });
    const source = { id, name, expectedRevision: options.expectedSourceRevision };
    // An explicit parent is part of the request; the derived default is not, so retries stay identical.
    return this.repository.create(
      candidate,
      creationIdentity(options.mutationId === undefined ? `duplicate-${candidate.id}` : options.mutationId, {
        kind: 'duplicate',
        source,
        parentId: options.parentId,
      }),
      source,
    );
  }
  /** The resume as it is laid out and exported: privacy tokens filled with the stored values. Never sent to a client. */
  renderable(document: ResumeDocument) {
    return this.repository.fill?.(document) ?? document;
  }
  async patch(id: string, request: ResumePatch) {
    const touches = (paths: string[]) =>
      Array.isArray(request.operations) && request.operations.some((operation) => paths.includes(operation?.path));
    const touchesTree = touches(['/parentId', '/target', '']),
      touchesSource = touches(['/source/revision']);
    const documents = touchesTree || touchesSource ? await this.repository.list() : [];
    const apply = patchTransform(request);
    return (await this.repository.transact(id, identity(request, request), (current, previous) => {
      const next = apply(current, previous);
      if (next && touchesTree)
        this.checkPlacement(
          documents.map((document) => (document.id === id ? next : document)),
          next,
          current,
        );
      if (next && touchesSource) checkSourceRevision(documents, next, current);
      return next;
    }))!;
  }
  private checkPlacement(documents: ResumeDocument[], next: ResumeDocument, current: ResumeDocument) {
    if (next.parentId !== current.parentId) {
      const error = placementError(documents, next.id, next.parentId, resumeKind(next));
      if (error) throw new ResumeError('VALIDATION_FAILED', error);
    }
    if (
      resumeKind(next) === 'job' &&
      resumeKind(current) === 'base' &&
      documents.some((document) => document.parentId === next.id)
    )
      throw new ResumeError('VALIDATION_FAILED', '这份简历下面还有其他简历，不能设为投递版；先移走下级简历');
  }
  async importResume(input: unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new ResumeError('VALIDATION_FAILED', '导入需要单份 ResumeData v1');
    const value = input as Record<string, unknown>;
    if (
      Object.keys(value).some((key) => !['mutationId', 'data', 'name', 'appearance', 'sample'].includes(key)) ||
      typeof value.mutationId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(value.mutationId) ||
      (value.name !== undefined && (typeof value.name !== 'string' || value.name.length > 200))
    )
      throw new ResumeError('VALIDATION_FAILED', '导入只允许 mutationId、data、name、appearance、sample');
    if (value.appearance !== undefined && !isAppearance(value.appearance))
      throw new ResumeError('VALIDATION_FAILED', '无效 Appearance');
    if (value.sample !== undefined) {
      if (value.sample !== true || value.data !== undefined)
        throw new ResumeError('VALIDATION_FAILED', '导入内置示例时 sample 为 true，且不带 data');
      const document = await this.create(
        {
          ...sampleResumeInput(),
          ...(value.name === undefined ? {} : { name: value.name as string }),
          ...(value.appearance === undefined ? {} : { appearance: value.appearance as ResumeRecord['appearance'] }),
        },
        value.mutationId,
      );
      return { document, warnings: validateDocument(document).warnings };
    }
    const errors = validateResumeData(value.data);
    if (errors.length) throw new ResumeError('VALIDATION_FAILED', errors.join('; '));
    const document = await this.create(
      {
        data: value.data as ResumeRecord['data'],
        ...(value.name === undefined ? {} : { name: value.name as string }),
        ...(value.appearance === undefined ? {} : { appearance: value.appearance as ResumeRecord['appearance'] }),
      },
      value.mutationId,
    );
    return { document, warnings: validateDocument(document).warnings };
  }
  async importNew(value: unknown) {
    const source = normalizeImport(value, () => this.makeRecord());
    const results: ResumeDocument[] = [];
    for (const document of source) results.push(await this.create(document));
    return results;
  }
  async replace(id: string, request: WriteIdentity, input: Pick<ResumeRecord, 'data' | 'appearance'>) {
    if (!input || !input.data || !input.appearance)
      throw new ResumeError('VALIDATION_FAILED', '显式导入需要 data 和 appearance');
    // What replaces the content is the person's own, so a resume that was the example is not any more.
    return (await this.repository.transact(
      id,
      identity(request, { kind: 'import', input }),
      ({ sample: _, ...current }) => ({
        ...current,
        data: structuredClone(input.data),
        appearance: structuredClone(input.appearance),
      }),
    ))!;
  }
  async restorePrevious(id: string, request: WriteIdentity) {
    return (await this.repository.transact(id, identity(request, { kind: 'restore' }), (_current, previous) => {
      if (!previous) throw new ResumeError('NOT_FOUND', '没有上一版本');
      return previous;
    }))!;
  }
  async delete(id: string, request: WriteIdentity) {
    await this.repository.transact(id, identity(request, { kind: 'delete' }), () => null);
  }
  // Checked as it will be exported, so contact formats and typography are judged on the real values.
  async validate(id: string) {
    const document = await this.get(id);
    return { id, revision: document.revision, ...validateDocument(this.renderable(document)) };
  }
}

/** Marking source changes as seen may only move forward, to a revision the source actually has. */
function checkSourceRevision(documents: ResumeDocument[], next: ResumeDocument, current: ResumeDocument) {
  const head = documents.find((document) => document.id === current.source?.id)?.revision;
  const revision = next.source?.revision;
  if (
    !current.source ||
    !head ||
    !Number.isSafeInteger(revision) ||
    revision! < current.source.revision ||
    revision! > head
  )
    throw new ResumeError(
      'VALIDATION_FAILED',
      `source.revision 只能在 ${current.source?.revision ?? '?'}–${head ?? '?'} 之间`,
    );
}
