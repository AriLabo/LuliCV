import { buildTree, resumeKind, type TreeNode } from '../../src/core/tree';
import type { ResumeDocument } from '../../src/core/types';
import type { SourceChanges, SqliteRepository } from './sqlite-repository';

export interface TreeSummaryNode {
  id: string;
  name: string;
  kind: 'base' | 'job';
  revision: number;
  updatedAt: number;
  purpose?: string;
  sample?: true;
  target?: { company: string; role: string };
  /** Number of content changes in the source since this resume was copied from it. */
  sourceChanges?: number;
  children: TreeSummaryNode[];
}

/** A compact, agent-readable view of the workspace: placement, purpose, targets and stale copies. */
export async function treeSummary(
  repository: SqliteRepository,
  documents: ResumeDocument[],
): Promise<TreeSummaryNode[]> {
  const changes = new Map<string, number>();
  for (const document of documents)
    if (document.source) {
      const result = await repository.sourceChanges(document.id);
      if (result?.changes.length) changes.set(document.id, result.changes.length);
    }
  const toNode = ({ document, children }: TreeNode): TreeSummaryNode => ({
    id: document.id,
    name: document.name,
    kind: resumeKind(document),
    revision: document.revision,
    updatedAt: document.updatedAt,
    ...(document.purpose ? { purpose: document.purpose } : {}),
    ...(document.sample ? { sample: true as const } : {}),
    ...(document.target ? { target: { company: document.target.company, role: document.target.role } } : {}),
    ...(changes.has(document.id) ? { sourceChanges: changes.get(document.id) } : {}),
    children: children.map(toNode),
  });
  return buildTree(documents).map(toNode);
}

/** Source changes as the agent reads them: readable labels, plus pointers into the source's current content. */
export function describeSourceChanges(result: SourceChanges) {
  return {
    sourceId: result.sourceId,
    sourceName: result.sourceName,
    fromRevision: result.fromRevision,
    toRevision: result.toRevision,
    changes: result.changes,
    paths: result.paths.slice(0, 50),
  };
}
