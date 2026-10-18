import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/*
 * Background text behind a small ⓘ, so screens show what the person is deciding and not everything that is always
 * true. Opens on hover and on click or tap (touch screens have no hover); Escape or a click elsewhere closes it.
 */

const WIDTH = 300;

export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<number>(undefined);
  const [place, setPlace] = useState<{ top: number; left: number; width: number }>();
  const [pinned, setPinned] = useState(false);

  // Fixed, so a scrolling dialog body or a narrow header never clips it.
  const show = () => {
    window.clearTimeout(timer.current);
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const width = Math.min(WIDTH, window.innerWidth - 16);
    setPlace({
      top: box.bottom + 6,
      left: Math.max(8, Math.min(box.left + box.width / 2 - width / 2, window.innerWidth - width - 8)),
      width,
    });
  };
  const hide = () => {
    setPinned(false);
    setPlace(undefined);
  };
  // A short grace period lets the pointer cross the gap into the panel.
  const leave = () => {
    if (!pinned) timer.current = window.setTimeout(() => setPlace(undefined), 120);
  };

  useEffect(() => {
    if (!place) return;
    const onDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) hide();
    };
    // Captured first so Escape closes the tip without also closing the dialog around it.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        hide();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [place]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <span className="info-tip" ref={ref} onMouseEnter={show} onMouseLeave={leave}>
      <button
        type="button"
        className="info-tip__button"
        aria-label={label}
        aria-expanded={!!place}
        aria-describedby={place ? id : undefined}
        onClick={() => {
          if (pinned) hide();
          else {
            setPinned(true);
            show();
          }
        }}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M8 7.2v3.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="8" cy="5" r=".85" fill="currentColor" />
        </svg>
      </button>
      {place && (
        <span role="tooltip" id={id} className="info-tip__panel" style={place}>
          {children}
        </span>
      )}
    </span>
  );
}
