import { useEffect, useRef, useState } from 'react';
import type { RevisionSummary } from './bridge-repository';
import { formatChanges } from '../core/change-summary';
import { GROUP_WINDOW_MS, useStudioStore } from './store';
import { useDismiss } from './dismiss';
import { errorMessage } from '../core/errors';
import type { ResumeDocument } from './types';

interface HistoryGroup {
  source: string;
  from: number;
  to: number;
  at: number;
  created: boolean;
  changes: string[];
  count: number;
  restoredFrom?: number;
}
const sourceNames: Record<string, string> = { human: '你', agent: 'Agent', import: '导入', system: '系统' };

/**
 * Autosave commits every pause and an agent in many quick commits, so consecutive commits from one source within a
 * few minutes read as one change. A restore always stands on its own.
 */
export function groupRevisions(revisions: RevisionSummary[]): HistoryGroup[] {
  const groups: HistoryGroup[] = [];
  for (const revision of revisions) {
    const last = groups.at(-1);
    if (
      last &&
      last.source === revision.source &&
      !last.restoredFrom &&
      !revision.restoredFrom &&
      !revision.created &&
      last.at - revision.createdAt <= GROUP_WINDOW_MS
    ) {
      last.from = revision.revision;
      last.count += 1;
      last.at = revision.createdAt;
      last.changes.push(...revision.changes.filter((change) => !last.changes.includes(change)));
    } else
      groups.push({
        source: revision.source,
        from: revision.revision,
        to: revision.revision,
        at: revision.createdAt,
        created: revision.created,
        changes: [...revision.changes],
        count: 1,
        ...(revision.restoredFrom ? { restoredFrom: revision.restoredFrom } : {}),
      });
  }
  return groups;
}

function relativeTime(at: number, now = Date.now()) {
  const minutes = Math.round((now - at) / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} 小时前`;
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
}

export function ChangeHistory({ record }: { record: ResumeDocument }) {
  const loadHistory = useStudioStore((state) => state.loadHistory);
  const restoreRevision = useStudioStore((state) => state.restoreRevision);
  const [open, setOpen] = useState(false);
  // Each result keeps the resume it was read for: after switching resumes, the previous one's list is never shown
  // or restored from while the new one loads.
  const [history, setHistory] = useState<{ id: string; groups?: HistoryGroup[]; error?: string }>();
  const [restoring, setRestoring] = useState(false);
  const current = history?.id === record.id ? history : undefined;
  const groups = current?.groups;
  const error = current?.error;
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const id = record.id;
    loadHistory(id)
      .then((revisions) => {
        if (!cancelled) setHistory({ id, groups: groupRevisions(revisions) });
      })
      .catch((reason) => {
        if (!cancelled) setHistory({ id, error: errorMessage(reason) });
      });
    return () => {
      cancelled = true;
    };
  }, [open, record.id, record.revision, loadHistory]);
  useDismiss(panel, open, () => setOpen(false));
  return (
    <div className="history" ref={panel}>
      <button type="button" className="history-trigger" aria-expanded={open} onClick={() => setOpen(!open)}>
        修改记录
      </button>
      {open && (
        <div className="history-panel" role="dialog" aria-label="修改记录">
          <div className="history-title">「{record.name}」的修改记录</div>
          {error && <p className="history-empty">{error}</p>}
          {!groups && !error && <p className="history-empty">正在读取…</p>}
          {groups && (
            <ol className="history-list">
              {groups.map((group, index) => (
                <li
                  key={group.to}
                  data-history-source={group.source}
                  className={`history-item history-item--${group.source}`}
                >
                  <div className="history-item__head">
                    <strong>{sourceNames[group.source] ?? group.source}</strong>
                    <span>
                      {relativeTime(group.at)} ·{' '}
                      {group.from === group.to ? `r${group.to}` : `r${group.from}–r${group.to}`}
                    </span>
                  </div>
                  <div className="history-item__body">
                    {group.created
                      ? '创建了这份简历'
                      : group.restoredFrom
                        ? `恢复到 r${group.restoredFrom}`
                        : `修改了${formatChanges(group.changes) || '简历内容'}`}
                    {group.count > 1 ? `（${group.count} 次保存）` : ''}
                  </div>
                  {group.from > 1 && (
                    // Shown on hover or focus only; the whole document goes back, and the notice it leaves can undo it.
                    <button
                      type="button"
                      className="history-item__restore"
                      disabled={restoring}
                      onClick={() => {
                        const id = current!.id;
                        setRestoring(true);
                        restoreRevision(
                          id,
                          group.from - 1,
                          `已恢复到 r${group.from - 1}，之后的 ${index + 1} 次修改一并撤掉`,
                        )
                          .then(
                            () => setOpen(false),
                            (reason) => setHistory({ id, groups, error: errorMessage(reason) }),
                          )
                          .finally(() => setRestoring(false));
                      }}
                    >
                      回到这之前
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
          {groups && !groups.length && <p className="history-empty">还没有修改记录</p>}
        </div>
      )}
    </div>
  );
}
