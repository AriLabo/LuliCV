import { useMemo, useState } from 'react';
import { useBackupFile } from './BackupPanel';
import { sampleResumeInput } from './defaults';
import { ResumePreview } from './ResumePreview';
import { Wordmark } from './brand';
import { usePreviewZoom } from './preview-zoom';
import type { ResumeRecord } from './types';

const ignore = () => {};

/**
 * What an empty workspace shows: the built-in example, laid out for real but not saved. Nothing is created until the
 * user picks the example or a blank resume, so trying the page leaves nothing behind.
 */
export function EmptyWorkspace({
  onUseSample,
  onCreateBlank,
  error,
  notice,
  onDismissNotice,
}: {
  onUseSample: () => Promise<void>;
  onCreateBlank: () => Promise<void>;
  error?: string;
  notice?: string;
  onDismissNotice: () => void;
}) {
  // One click creates one resume: the buttons wait until the create has finished or failed.
  const [busy, setBusy] = useState(false);
  const run = (create: () => Promise<void>) => {
    setBusy(true);
    void create().finally(() => setBusy(false));
  };
  const paneRef = usePreviewZoom();
  const backupFile = useBackupFile();
  const record = useMemo<ResumeRecord>(
    () => ({ id: 'sample-preview', createdAt: 0, updatedAt: 0, ...sampleResumeInput() }),
    [],
  );
  return (
    <div className="app-shell">
      <header className="topbar topbar--empty studio-chrome">
        <div className="brand" role="img" aria-label="CVSlate">
          <Wordmark accent={record.appearance.layout.accentColor} />
        </div>
      </header>
      <main className="preview-pane" ref={paneRef}>
        {error && (
          <div role="alert" className="notice notice-error studio-chrome">
            {error}
          </div>
        )}
        {notice && (
          <div className="notice notice-agent studio-chrome" role="status">
            <span>{notice}</span>
            <div className="notice-actions">
              <button type="button" className="notice-close" aria-label="关闭提示" onClick={onDismissNotice}>
                ×
              </button>
            </div>
          </div>
        )}
        <section className="empty-intro studio-chrome" aria-labelledby="empty-intro-title">
          <h1 id="empty-intro-title">先看看简历效果</h1>
          <p>这是一份虚构的内容运营简历。你可以用它体验编辑和排版，也可以直接开始制作自己的简历。</p>
          <div className="empty-intro__actions">
            <button type="button" className="primary-button" disabled={busy} onClick={() => run(onUseSample)}>
              使用这份示例
            </button>
            <button type="button" className="subtle-button" disabled={busy} onClick={() => run(onCreateBlank)}>
              新建空白简历
            </button>
            <button type="button" className="subtle-button" disabled={busy} onClick={backupFile.open}>
              导入简历 JSON
            </button>
            {backupFile.input}
          </div>
          <p className="empty-intro__hint">导入的简历会加成新简历，修订记录和母版、投递版之间的关系不会带过来。</p>
          <p className="empty-intro__hint">已有旧简历？可以发给 Agent 帮你导入。</p>
        </section>
        <ResumePreview record={record} onIssues={ignore} />
      </main>
    </div>
  );
}
