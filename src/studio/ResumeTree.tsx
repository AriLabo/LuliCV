import { useMemo, useState, type CSSProperties } from 'react';
import { buildTree, placementError, resumeKind, type TreeNode } from '../core/tree';
import type { ResumeDocument, ResumeTarget } from './types';

const shortDate = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' });
export const formatDay = (at: number) => shortDate.format(at);
export const targetLabel = (target?: ResumeTarget) =>
  target ? [target.company, target.role].filter(Boolean).join(' · ') : '';

function hue(text: string) {
  let value = 0;
  for (const char of text) value = (value * 31 + char.charCodeAt(0)) % 360;
  return value;
}
const DocIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M4 1.75h5.2L12.25 4.8v9.45H4z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
    <path
      d="M9 1.9V5h3.1M6 8h4.2M6 10.5h4.2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
  </svg>
);
const Chevron = () => (
  <svg viewBox="0 0 10 10" aria-hidden="true">
    <path
      d="M3 1.5 6.5 5 3 8.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** Base resumes a resume (or a new job version, when `id` is undefined) can be placed under. */
export function parentChoices(resumes: ResumeDocument[], id: string | undefined, kind: 'base' | 'job') {
  return resumes
    .filter((resume) => resume.id !== id && resumeKind(resume) === 'base')
    .map((resume) => ({ resume, error: placementError(resumes, id ?? '__new__', resume.id, kind) }));
}

export function ResumeTree({
  resumes,
  activeId,
  sourceChanges,
  onSelect,
  onCreateVariant,
}: {
  resumes: ResumeDocument[];
  activeId: string;
  sourceChanges: Record<string, number>;
  onSelect: (id: string) => void;
  onCreateVariant: (parentId: string | undefined, target: ResumeTarget) => void;
}) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const tree = useMemo(() => buildTree(resumes), [resumes]);
  const active = resumes.find((resume) => resume.id === activeId);
  const choices = parentChoices(resumes, undefined, 'job').filter((choice) => !choice.error);
  const defaultParent =
    active && resumeKind(active) === 'base' && choices.some((choice) => choice.resume.id === active.id)
      ? active.id
      : active?.parentId && choices.some((choice) => choice.resume.id === active.parentId)
        ? active.parentId
        : choices[0]?.resume.id;
  const [parent, setParent] = useState<string | undefined>();
  const chosenParent = parent ?? defaultParent;

  const needle = query.trim().toLowerCase();
  const matches = (node: TreeNode): boolean =>
    !needle ||
    [node.document.name, node.document.purpose, node.document.target?.company, node.document.target?.role].some(
      (text) => text?.toLowerCase().includes(needle),
    ) ||
    node.children.some(matches);

  const row = (node: TreeNode) => {
    const { document } = node;
    const isJob = resumeKind(document) === 'job';
    const hasKids = node.children.length > 0;
    const open = !!needle || !collapsed.has(document.id);
    const changed = sourceChanges[document.id];
    const toggle = () =>
      setCollapsed((current) => {
        const next = new Set(current);
        if (next.has(document.id)) next.delete(document.id);
        else next.add(document.id);
        return next;
      });
    return (
      <li key={document.id} role="none">
        <div
          role="treeitem"
          aria-selected={document.id === activeId}
          aria-expanded={hasKids ? open : undefined}
          aria-level={node.level + 1}
          className="tree-row"
          style={{ '--depth': node.level } as CSSProperties}
        >
          <button
            type="button"
            className="tree-chevron"
            tabIndex={-1}
            aria-hidden={!hasKids}
            disabled={!hasKids}
            onClick={toggle}
          >
            {hasKids && <Chevron />}
          </button>
          <button
            type="button"
            className="tree-main"
            data-resume-row
            data-resume-id={document.id}
            title={document.purpose || targetLabel(document.target) || document.name}
            onClick={() => onSelect(document.id)}
          >
            {isJob ? (
              <span
                className="tree-glyph"
                style={{ background: `hsl(${hue(document.target!.company || document.name)} 40% 50%)` }}
              >
                {(document.target!.company || document.name).slice(0, 1)}
              </span>
            ) : (
              <span className="tree-glyph tree-glyph--doc">
                <DocIcon />
              </span>
            )}
            <span className="tree-label">
              {isJob && document.target!.company ? (
                <>
                  {document.target!.company}
                  <small>{document.target!.role}</small>
                </>
              ) : (
                document.name
              )}
            </span>
            <span className="tree-state">
              {changed ? (
                <span
                  className="dot dot--stale"
                  role="img"
                  aria-label="来源有更新"
                  title={`来源在复制后改了 ${changed} 处，这份还没带过来`}
                />
              ) : null}
              {formatDay(document.updatedAt)}
            </span>
          </button>
        </div>
        {hasKids && open && (
          <ul role="group" className="tree-group" style={{ '--guide': `${16 + node.level * 16}px` } as CSSProperties}>
            {node.children.filter(matches).map(row)}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="resume-tree">
      <div className="tree-head">
        <span>简历</span>
        <button
          type="button"
          className="tree-icon-button"
          aria-label="为新公司做一份"
          title="为新公司做一份"
          onClick={() => setCreating(true)}
        >
          ＋
        </button>
      </div>
      <input
        className="tree-search"
        type="search"
        placeholder="搜索公司、岗位或定位"
        aria-label="搜索简历"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <ul className="tree-list" role="tree" aria-label="简历树">
        {tree.filter(matches).map(row)}
      </ul>
      {!tree.filter(matches).length && <p className="tree-empty">没有匹配的简历</p>}
      <div className="tree-foot">
        {creating ? (
          <form
            className="tree-create"
            onSubmit={(event) => {
              event.preventDefault();
              if (!company.trim() && !role.trim()) return;
              onCreateVariant(chosenParent, { company: company.trim(), role: role.trim(), jd: '' });
              setCompany('');
              setRole('');
              setParent(undefined);
              setCreating(false);
            }}
          >
            <div className="tree-create__fields">
              <input
                aria-label="目标公司"
                placeholder="公司"
                value={company}
                autoFocus
                onChange={(event) => setCompany(event.target.value)}
              />
              <input
                aria-label="目标岗位"
                placeholder="岗位"
                value={role}
                onChange={(event) => setRole(event.target.value)}
              />
            </div>
            <label className="tree-create__parent">
              <span>从这份复制并放在它下面</span>
              <select
                aria-label="放在"
                value={chosenParent ?? ''}
                onChange={(event) => setParent(event.target.value || undefined)}
              >
                {choices.map(({ resume }) => (
                  <option key={resume.id} value={resume.id}>
                    {resume.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="tree-create__actions">
              <button type="submit" className="tree-create__submit" disabled={!company.trim() && !role.trim()}>
                创建投递版
              </button>
              <button type="button" onClick={() => setCreating(false)}>
                取消
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="tree-new" onClick={() => setCreating(true)}>
            ＋ 为新公司做一份
          </button>
        )}
      </div>
    </div>
  );
}
