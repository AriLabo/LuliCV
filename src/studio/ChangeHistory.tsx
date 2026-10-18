import { useEffect, useRef, useState } from 'react';
import type { RevisionSummary } from './bridge-repository';
import { formatChanges } from '../core/change-summary';
import { useStudioStore } from './store';
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
}
const sourceNames: Record<string, string> = { human: '你', agent: 'Agent', import: '导入', system: '系统' };
const GROUP_WINDOW_MS = 3 * 60 * 1000;

/** Autosave commits every pause, so consecutive edits from one source within a few minutes read as one change. */
export function groupRevisions(revisions: RevisionSummary[]): HistoryGroup[] {
  const groups: HistoryGroup[] = [];
  for (const revision of revisions) {
    const last = groups.at(-1);
    if (
      last &&
      last.source === revision.source &&
      revision.source !== 'agent' &&
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
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<HistoryGroup[]>();
  const [error, setError] = useState<string>();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    loadHistory(record.id)
      .then((revisions) => {
        if (!cancelled) {
          setGroups(groupRevisions(revisions));
          setError(undefined);
        }
      })
      .catch((reason) => {
        if (!cancelled) setError(errorMessage(reason));
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
              {groups.map((group) => (
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
                    {group.created ? '创建了这份简历' : `修改了${formatChanges(group.changes) || '简历内容'}`}
                    {group.count > 1 ? `（${group.count} 次保存）` : ''}
                  </div>
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
