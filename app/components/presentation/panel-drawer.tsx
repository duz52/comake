import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

/**
 * One on-demand right-side panel (Agent / Comments / Activity). The drawers
 * are mutually exclusive — the workspace renders at most one — and the scrim
 * click closes it. Focus moves to the drawer's close control on open and is
 * restored to the opener on close; Tab/Shift+Tab stay trapped inside. Escape
 * is owned by the workspace keyboard controller (present -> palette ->
 * drawer), never here.
 */
export function PanelDrawer({ children, onClose, title }: { children: ReactNode; onClose: () => void; title: string }) {
  const rootRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // The element that owned focus before the drawer opened; restored on close.
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      const previous = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previous && previous.isConnected) {
        previous.focus();
      }
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key !== 'Tab' || !rootRef.current) {
      return;
    }
    const focusables = Array.from(
      rootRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.getClientRects().length > 0);
    if (focusables.length === 0) {
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const activeElement = document.activeElement;
    if (event.shiftKey) {
      if (activeElement === first || !rootRef.current.contains(activeElement)) {
        event.preventDefault();
        last.focus();
      }
    } else if (activeElement === last || !rootRef.current.contains(activeElement)) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <section
        aria-label={title}
        className="panel-drawer"
        onKeyDown={handleKeyDown}
        ref={rootRef}
        role="region"
      >
        <div className="drawer-head">
          <h2 className="drawer-title">{title}</h2>
          <button
            aria-label={`Close ${title.toLowerCase()}`}
            className="drawer-close"
            onClick={onClose}
            ref={closeRef}
            type="button"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </section>
    </>
  );
}