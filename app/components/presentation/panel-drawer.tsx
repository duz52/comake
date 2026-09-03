import { useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.getClientRects().length > 0,
  );
}

/** Keep Tab/Shift+Tab inside `root`. Escape is owned by the workspace keyboard controller. */
function trapTab(root: HTMLElement, event: KeyboardEvent<HTMLElement>): void {
  const focusables = focusableElements(root);
  if (focusables.length === 0) {
    return;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const activeElement = document.activeElement;
  if (event.shiftKey) {
    if (activeElement === first || !root.contains(activeElement)) {
      event.preventDefault();
      last.focus();
    }
  } else if (activeElement === last || !root.contains(activeElement)) {
    event.preventDefault();
    first.focus();
  }
}

function useOverlayFocus(rootRef: RefObject<HTMLElement | null>): void {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = rootRef.current;
    if (root) {
      focusableElements(root)[0]?.focus();
    }
    return () => {
      const previous = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previous && previous.isConnected) {
        previous.focus();
      }
    };
  }, [rootRef]);
}

/**
 * Shared right-side modal: named dialog, scrim, focus trap/restore, Tab wrap.
 * Escape is owned by the workspace (present → palette → this overlay).
 */
function OverlayDialog({
  children,
  className,
  label,
  labelledBy,
  onClose,
}: {
  children: ReactNode;
  className: string;
  label: string;
  labelledBy?: string;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useOverlayFocus(rootRef);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key !== 'Tab' || !rootRef.current) {
      return;
    }
    trapTab(rootRef.current, event);
  }

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <div
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        aria-modal="true"
        className={className}
        onKeyDown={handleKeyDown}
        ref={rootRef}
        role="dialog"
      >
        {children}
      </div>
    </>
  );
}

/**
 * One on-demand right-side panel (Agent / Comments / Activity). The workspace
 * renders at most one. Scrim click closes it. Focus moves to the close
 * control on open and is restored on close.
 */
export function PanelDrawer({ children, onClose, title }: { children: ReactNode; onClose: () => void; title: string }) {
  const titleId = useId();
  return (
    <OverlayDialog className="panel-drawer" label={title} labelledBy={titleId} onClose={onClose}>
      <div className="drawer-head">
        <h2 className="drawer-title" id={titleId}>
          {title}
        </h2>
        <button aria-label={`Close ${title.toLowerCase()}`} className="drawer-close" onClick={onClose} type="button">
          <span aria-hidden="true">✕</span>
        </button>
      </div>
      <div className="drawer-body">{children}</div>
    </OverlayDialog>
  );
}

/**
 * Stable host for the one InspectorPanel instance. Dock vs overlay is a class
 * and dialog chrome change on this same node; children do not remount.
 * Initial focus moves to the close control only when the overlay opens from
 * outside the panel (not when resizing inline ↔ overlay with focus inside).
 */
export function InspectorFrame({
  children,
  onClose,
  overlay,
  restoreFocusRef,
}: {
  children: ReactNode;
  onClose: () => void;
  overlay: boolean;
  restoreFocusRef: RefObject<HTMLElement | null>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!overlay) {
      return;
    }
    const root = rootRef.current;
    const active = document.activeElement;
    const inside = root !== null && active instanceof Node && root.contains(active);
    if (!inside && root) {
      focusableElements(root)[0]?.focus();
    }
  }, [overlay]);

  useLayoutEffect(() => {
    return () => {
      const previous = restoreFocusRef.current;
      if (previous && previous.isConnected) {
        previous.focus();
      }
    };
  }, [restoreFocusRef]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (!overlay || event.key !== 'Tab' || !rootRef.current) {
      return;
    }
    trapTab(rootRef.current, event);
  }

  return (
    <>
      {overlay ? <div className="drawer-scrim" onClick={onClose} /> : null}
      <div
        aria-label="Inspector"
        aria-modal={overlay ? true : undefined}
        className={overlay ? 'panel-drawer inspector-overlay' : 'inspector-dock'}
        data-inspector-frame={overlay ? 'overlay' : 'dock'}
        onKeyDown={handleKeyDown}
        ref={rootRef}
        role={overlay ? 'dialog' : 'region'}
      >
        {children}
      </div>
    </>
  );
}
