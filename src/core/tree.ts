import type { ResumeDocument } from './types';

/**
 * Resume tree rules. The tree is organisation only: a child is an independent copy and inherits
 * nothing from its parent. `parentId` says where a resume sits; `source` (read-only) says where its
 * content was copied from and drives "the source changed" hints.
 *
 * A base resume (no target) may hold children; a job version (with a target) is always a leaf.
 * At most three levels, e.g. full master → direction → job version.
 */
export const MAX_TREE_LEVELS = 3;

export type ResumeKind = 'base' | 'job';
export const resumeKind = (document: Pick<ResumeDocument, 'target'>): ResumeKind => (document.target ? 'job' : 'base');

type ById = Map<string, ResumeDocument>;
const index = (documents: ResumeDocument[]): ById => new Map(documents.map((document) => [document.id, document]));

/** The parent a resume is shown under: its parentId while that resume exists and can hold children, otherwise the top level. */
export function effectiveParentId(document: ResumeDocument, byId: ById): string | undefined {
  const recorded = document.parentId ? byId.get(document.parentId) : undefined;
  return recorded && recorded.id !== document.id && resumeKind(recorded) === 'base' ? recorded.id : undefined;
}

function ancestors(id: string, byId: ById): string[] {
  const chain: string[] = [];
  let current = byId.get(id);
  while (current) {
    const parent = effectiveParentId(current, byId);
    if (!parent || chain.includes(parent) || parent === id) break;
    chain.push(parent);
    current = byId.get(parent);
  }
  return chain;
}
const levelOf = (id: string, byId: ById) => ancestors(id, byId).length;
function subtreeHeight(id: string, documents: ResumeDocument[], byId: ById): number {
  const children = documents.filter((document) => document.id !== id && effectiveParentId(document, byId) === id);
  return children.length ? 1 + Math.max(...children.map((child) => subtreeHeight(child.id, documents, byId))) : 0;
}

/** Why `id` cannot be placed under `parentId` (undefined = top level), or undefined when it can. */
export function placementError(
  documents: ResumeDocument[],
  id: string,
  parentId: string | undefined,
  kind?: ResumeKind,
): string | undefined {
  const byId = index(documents);
  const self = byId.get(id);
  const ownKind = kind ?? (self ? resumeKind(self) : 'base');
  if (parentId === undefined)
    return ownKind === 'job' || !self
      ? undefined
      : subtreeHeight(id, documents, byId) + 1 > MAX_TREE_LEVELS
        ? `最多 ${MAX_TREE_LEVELS} 层`
        : undefined;
  if (parentId === id) return '不能放在自己下面';
  const parent = byId.get(parentId);
  if (!parent) return '找不到要放入的简历';
  if (resumeKind(parent) === 'job') return '投递版下面不能再放简历';
  if (ancestors(parentId, byId).includes(id)) return '不能放进自己的下级';
  const height = self && ownKind === 'base' ? subtreeHeight(id, documents, byId) : 0;
  if (levelOf(parentId, byId) + 2 + height > MAX_TREE_LEVELS) return `最多 ${MAX_TREE_LEVELS} 层`;
  return undefined;
}

/** Default placement for a copy of `sourceId`: under a base resume, or beside a copied job version. */
export function defaultParentForCopy(
  documents: ResumeDocument[],
  sourceId: string,
  kind: ResumeKind = 'job',
): string | undefined {
  const byId = index(documents);
  const source = byId.get(sourceId);
  if (!source) return undefined;
  let candidate = resumeKind(source) === 'base' ? source.id : effectiveParentId(source, byId);
  // Climb until the copy fits within the level limit.
  while (candidate && placementError(documents, '__new__', candidate, kind))
    candidate = effectiveParentId(byId.get(candidate)!, byId);
  return candidate;
}

export interface TreeNode {
  document: ResumeDocument;
  level: number;
  children: TreeNode[];
}

/**
 * Builds the display tree. Base resumes come before job versions; drafts before sent versions;
 * newest first within each. Anything deeper than the level limit is lifted to the last allowed level.
 */
export function buildTree(documents: ResumeDocument[]): TreeNode[] {
  const byId = index(documents);
  const children = new Map<string | undefined, ResumeDocument[]>();
  for (const document of documents) {
    let parent = effectiveParentId(document, byId);
    const chain = parent ? [parent, ...ancestors(parent, byId)] : [];
    if (chain.length >= MAX_TREE_LEVELS) parent = chain[chain.length - MAX_TREE_LEVELS + 1];
    children.set(parent, [...(children.get(parent) ?? []), document]);
  }
  const rank = (document: ResumeDocument) => (resumeKind(document) === 'base' ? 0 : 1);
  const sort = (list: ResumeDocument[]) =>
    [...list].sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (resumeKind(a) === 'base' && rank(b) === 0 ? a.createdAt - b.createdAt : b.updatedAt - a.updatedAt),
    );
  const build = (parent: string | undefined, level: number, seen: Set<string>): TreeNode[] =>
    sort(children.get(parent) ?? [])
      .filter((document) => !seen.has(document.id))
      .map((document) => ({
        document,
        level,
        children: build(document.id, level + 1, new Set([...seen, document.id])),
      }));
  return build(undefined, 0, new Set());
}

/** The resumes from the root down to `id`, for breadcrumbs. */
export function pathTo(documents: ResumeDocument[], id: string): ResumeDocument[] {
  const byId = index(documents);
  const self = byId.get(id);
  return self
    ? [
        ...ancestors(id, byId)
          .reverse()
          .map((ancestor) => byId.get(ancestor)!),
        self,
      ]
    : [];
}
