import { useCallback, useEffect, useState } from 'react';
import { ResumePreview } from '../studio/ResumePreview';
import type { ResumeDocument } from '../core/types';
import type { LayoutIssue, LayoutReport } from '../core/layout';
import { setInstalledThemes, type InstalledTheme } from '../themes/registry';
export function RenderApp() {
  const [document, setDocument] = useState<ResumeDocument>();
  const [report, setReport] = useState<LayoutReport>();
  const [error, setError] = useState<string>();
  const onIssues = useCallback((_issues: LayoutIssue[]) => {}, []);
  useEffect(() => {
    const controller = new AbortController();
    const key = new URLSearchParams(location.search).get('job');
    if (!key || !/^[a-f0-9-]{36}$/.test(key)) {
      setError('无效快照任务');
      return;
    }
    const read = async <T,>(route: string) => {
      const response = await fetch(route, { credentials: 'same-origin', signal: controller.signal });
      if (!response.ok) throw new Error('渲染快照不可用');
      return response.json() as Promise<T>;
    };
    // An installed (or draft) theme travels with the job, so the page is laid out with exactly the CSS the job was started with.
    void Promise.all([
      read<ResumeDocument>(`/api/render/${key}`),
      read<{ theme: InstalledTheme | null }>(`/api/render/${key}/theme`),
    ])
      .then(([document, { theme }]) => {
        if (theme) setInstalledThemes([theme]);
        setDocument(document);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(String(error));
      });
    return () => controller.abort();
  }, []);
  return (
    <main data-render-ready={!!report && !error} data-render-error={error || undefined}>
      {error && <div role="alert">{error}</div>}
      <pre hidden data-render-report>
        {report ? JSON.stringify(report) : ''}
      </pre>
      {document && <ResumePreview record={document} onIssues={onIssues} onReady={setReport} onRenderError={setError} />}
    </main>
  );
}
