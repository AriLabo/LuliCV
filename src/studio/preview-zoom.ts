import { useEffect, useState } from 'react';

const A4_WIDTH_PX = (210 / 25.4) * 96;

/**
 * Scales the visible A4 pages to the pane width; the hidden measuring copy stays at real size. Returns a callback ref,
 * so a pane that mounts later (leaving the empty workspace, say) is observed too.
 */
export function usePreviewZoom() {
  const [pane, setPane] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!pane) return;
    const observer = new ResizeObserver(() =>
      pane.style.setProperty(
        '--preview-zoom',
        String(Math.min(1, Math.max(0.3, (pane.clientWidth - 8) / (A4_WIDTH_PX + 60)))),
      ),
    );
    observer.observe(pane);
    return () => observer.disconnect();
  }, [pane]);
  return setPane;
}
