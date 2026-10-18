import { useEffect, useRef, useState } from 'react';
import { CHANGED_AFTER_REQUEST, privateDisplayNames } from '../core/privacy';
import { errorMessage, ResumeError } from '../core/errors';
import { InfoTip } from './InfoTip';
import { downloadBlob, pdfFilename } from './files';
import { privateNames, toDisplay } from './privacy';
import { useStudioStore } from './store';

/*
 * An agent asked for a PDF in privacy mode. The PDF has the real values, so the person decides here; approving
 * downloads it in this browser and the agent learns only the page count. Closing the dialog declines.
 */

const countdown = (ms: number) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

export function ExportApprovalDialog() {
  const request = useStudioStore((state) => state.exportRequests[0]);
  const privacy = useStudioStore((state) => state.privacy);
  const resume = useStudioStore((state) => state.workspace?.resumes.find((item) => item.id === request?.resumeId));
  const ref = useRef<HTMLDialogElement>(null);
  const decline = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState<'approve' | 'decline'>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    setError(undefined);
    if (!request) {
      if (dialog.open) dialog.close();
      return;
    }
    // Declining is the safe default: Enter on an unexpected dialog must not export.
    if (!dialog.open) {
      dialog.showModal();
      decline.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new request, not a refreshed copy of the same one, reopens the dialog
  }, [request?.requestId]);
  useEffect(() => {
    if (!request) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the countdown restarts only for a new request
  }, [request?.requestId]);

  const run = async (kind: 'approve' | 'decline', task: () => Promise<void>) => {
    setBusy(kind);
    setError(undefined);
    // A save after the request shows as the notice below once the Bridge announces it.
    try {
      await task();
    } catch (failure) {
      if (!(failure instanceof ResumeError && failure.code === 'REVISION_CONFLICT')) setError(errorMessage(failure));
    } finally {
      setBusy(undefined);
    }
  };
  const refuse = () => {
    if (request && !busy) void run('decline', () => useStudioStore.getState().declineExport(request.requestId));
  };
  const approve = () => {
    if (request)
      void run('approve', async () => {
        const { pdf } = await useStudioStore.getState().approveExport(request.requestId);
        downloadBlob(pdf, `${resume ? pdfFilename(resume) : 'resume'}.pdf`);
      });
  };

  const names = privateNames(privacy);
  return (
    <dialog
      ref={ref}
      className="privacy-dialog export-approval"
      aria-labelledby="export-approval-title"
      onCancel={(event) => {
        event.preventDefault();
        refuse();
      }}
    >
      {request && (
        <>
          <header className="privacy-dialog__head">
            <div className="privacy-dialog__title">
              <h2 id="export-approval-title">agent 请求导出 PDF</h2>
              <InfoTip label="关于导出审批">
                <span>批准后，PDF 填入真实信息，下载到这个浏览器的下载目录。agent 只收到页数，拿不到文件和路径。</span>
                <span>能操作此浏览器的 agent 也能点这里的按钮。不是你本人要求的导出，请拒绝。</span>
              </InfoTip>
            </div>
            <button
              type="button"
              className="privacy-dialog__close"
              aria-label="拒绝并关闭"
              disabled={!!busy}
              onClick={refuse}
            >
              ×
            </button>
          </header>
          {error && (
            <div role="alert" className="notice notice-error privacy-dialog__error">
              {error}
            </div>
          )}
          <div className="privacy-dialog__body">
            <dl className="export-approval__facts">
              <dt>简历</dt>
              <dd>{toDisplay(request.name, names)}</dd>
              <dt>版本</dt>
              <dd>
                第 {request.revision} 版 · {request.pages} 页
              </dd>
              <dt>会填入</dt>
              <dd>
                {request.fields.length ? (
                  <span className="export-approval__chips">
                    {request.fields.map((field) => (
                      <span key={field} className="export-approval__chip">
                        {privateDisplayNames[field]}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="export-approval__none">没有隐私信息</span>
                )}
              </dd>
            </dl>
            {request.changed && (
              <p role="status" className="notice notice-warning export-approval__changed">
                {CHANGED_AFTER_REQUEST}
              </p>
            )}
          </div>
          <footer className="privacy-dialog__footer">
            <span className="export-approval__countdown">{countdown(request.expiresAt - now)} 后自动拒绝</span>
            <span className="privacy-dialog__spacer" />
            <button type="button" ref={decline} disabled={!!busy} onClick={refuse}>
              拒绝
            </button>
            <button type="button" className="primary-button" disabled={!!busy || request.changed} onClick={approve}>
              {busy === 'approve' ? '正在导出…' : '批准并导出'}
            </button>
          </footer>
        </>
      )}
    </dialog>
  );
}
