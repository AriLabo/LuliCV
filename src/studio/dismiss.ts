import { useEffect, useRef, type RefObject } from 'react';

/** While `active`, a mouse press outside `ref` or Escape calls `dismiss`, which learns whether it was Escape. */
export function useDismiss(ref: RefObject<HTMLElement | null>, active: boolean, dismiss: (byKey: boolean) => void) {
  const latest = useRef(dismiss);
  latest.current = dismiss;
  useEffect(() => {
    if (!active) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) latest.current(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') latest.current(true);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, active]);
}

/** useDismiss for a <details> menu: closes it if open, and after Escape puts focus back on its summary. */
export function useDetailsDismiss(ref: RefObject<HTMLDetailsElement | null>) {
  useDismiss(ref, true, (byKey) => {
    const details = ref.current;
    if (!details?.open) return;
    details.open = false;
    if (byKey) details.querySelector('summary')?.focus();
  });
}
