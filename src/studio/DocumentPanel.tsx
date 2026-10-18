import { useState } from 'react';
import { InfoTip } from './InfoTip';
import { effectiveParentId, resumeKind } from '../core/tree';
import { parentChoices, targetLabel } from './ResumeTree';
import { useStudioStore } from './store';
import type { ResumeDocument, ResumeTarget } from './types';
import type { SourceDiff } from './bridge-repository';

/** Placement, purpose and job target for the open resume: what people and agents use to organise versions. */
export function DocumentPanel({
  record,
  resumes,
  onTarget,
  onMeta,
}: {
  record: ResumeDocument;
  resumes: ResumeDocument[];
  onTarget: (target: ResumeTarget | undefined) => void;
  onMeta: (patch: { parentId?: string | null; purpose?: string }) => void;
}) {
  const isJob = resumeKind(record) === 'job';
  const [showTarget, setShowTarget] = useState(isJob);
  const target = record.target ?? { company: '', role: '', jd: '' };
  const updateTarget = (patch: Partial<ResumeTarget>) => {
    const next = { ...target, ...patch };
    onTarget(next.company || next.role || next.jd ? next : undefined);
  };
  const byId = new Map(resumes.map((resume) => [resume.id, resume]));
  const parentId = effectiveParentId(record, byId);
  const choices = parentChoices(resumes, record.id, resumeKind(record));
  const summary = isJob
    ? `投递版 · ${targetLabel(record.target) || '未填公司'}`
    : `主简历${record.purpose ? ` · ${record.purpose}` : ' · 未写定位'}`;
  // Open only while something is missing (a direction without a purpose, a job version without its JD);
  // otherwise the one-line summary is enough and the content editor stays near the top.
  const [initiallyOpen] = useState(() => (isJob ? !record.target?.jd : !record.purpose));
  return (
    <details className="tool-panel doc-panel" open={initiallyOpen}>
      <summary>{summary}</summary>
      <div className="doc-panel__body">
        <label className="field">
          <span>放在</span>
          <select
            aria-label="放在"
            value={parentId ?? ''}
            onChange={(event) => onMeta({ parentId: event.target.value || null })}
          >
            <option value="">顶层（不放在任何简历下）</option>
            {choices.map(({ resume, error }) => (
              <option key={resume.id} value={resume.id} disabled={!!error}>
                {resume.name}
                {error ? `（${error}）` : ''}
              </option>
            ))}
          </select>
        </label>
        {!isJob && (
          <label className="field">
            <span className="field__label">
              定位<InfoTip label="关于定位">写给自己和 Agent 看，用来决定新岗位放在哪个方向下。</InfoTip>
            </span>
            <input
              aria-label="定位"
              maxLength={200}
              placeholder="例如：投后端、高并发岗位，突出性能与稳定性"
              value={record.purpose ?? ''}
              onChange={(event) => onMeta({ purpose: event.target.value })}
            />
          </label>
        )}
        {showTarget || isJob ? (
          <>
            <div className="field-grid">
              <label className="field">
                <span>目标公司</span>
                <input
                  aria-label="投递目标公司"
                  value={target.company}
                  onChange={(event) => updateTarget({ company: event.target.value })}
                />
              </label>
              <label className="field">
                <span>目标岗位</span>
                <input
                  aria-label="投递目标岗位"
                  value={target.role}
                  onChange={(event) => updateTarget({ role: event.target.value })}
                />
              </label>
            </div>
            <label className="field">
              <span className="field__label">
                JD 原文<InfoTip label="关于 JD 原文">只保存在本机，供你和 Agent 对照修改。</InfoTip>
              </span>
              <textarea
                aria-label="JD 原文"
                rows={4}
                value={target.jd}
                onChange={(event) => updateTarget({ jd: event.target.value })}
              />
            </label>
          </>
        ) : (
          <button type="button" className="subtle-button doc-panel__add" onClick={() => setShowTarget(true)}>
            ＋ 投递目标
          </button>
        )}
      </div>
    </details>
  );
}

/** Shown when the resume this one was copied from has gained content since the copy. */
export function SourceNotice({
  record,
  resumes,
  changes,
}: {
  record: ResumeDocument;
  resumes: ResumeDocument[];
  changes: number;
}) {
  const loadSourceDiff = useStudioStore((state) => state.loadSourceDiff);
  const acknowledgeSource = useStudioStore((state) => state.acknowledgeSource);
  const [diff, setDiff] = useState<SourceDiff>();
  const [open, setOpen] = useState(false);
  const sourceName = resumes.find((resume) => resume.id === record.source?.id)?.name ?? '来源简历';
  const toggle = () => {
    if (!open && !diff)
      void loadSourceDiff(record.id)
        .then(setDiff)
        .catch(() => setDiff({ sourceId: null, changes: [] }));
    setOpen(!open);
  };
  return (
    <div role="status" className="notice notice-source">
      <span>
        <i className="dot dot--stale" />「{sourceName}」在复制这份之后又改了 {changes} 处内容，这份还没带过来
      </span>
      <div className="notice-actions">
        <button type="button" aria-expanded={open} onClick={toggle}>
          {open ? '收起' : '查看改动'}
        </button>
        <button
          type="button"
          title="这些改动不需要带过来；来源以后再改时会重新提示"
          onClick={() =>
            void (diff?.toRevision ? Promise.resolve(diff) : loadSourceDiff(record.id)).then((current) => {
              if (current?.toRevision) acknowledgeSource(current.toRevision);
            })
          }
        >
          忽略
        </button>
      </div>
      {open && (
        <ul className="notice-list">
          {diff ? (
            diff.changes.length ? (
              diff.changes.map((change) => <li key={change}>{change}</li>)
            ) : (
              <li>没有可显示的改动</li>
            )
          ) : (
            <li>正在读取…</li>
          )}
        </ul>
      )}
    </div>
  );
}
