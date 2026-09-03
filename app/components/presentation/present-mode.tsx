import { useEffect, useRef } from 'react';
import type { PresentationSnapshot, PresentationStore } from '../../lib/presentation/store';
import { SlideArtwork } from './slide-artwork';
import { slideDisplayName } from './slide-label';

/**
 * Controlled projection of the store session: the active slide scaled to the
 * window, navigation through the same `controlPresentation` transitions the
 * human chrome and WebMCP use, and exit via the on-screen bar. Escape is owned
 * by the workspace keyboard controller, never by this document handler.
 *
 * Focus contract: a modal dialog (`aria-modal`). The stage takes focus on
 * open and restores it to the opener on close; Tab and Shift+Tab stay trapped
 * inside.
 *
 * Live mutation safety: the store re-derives `activeSlideId` when the canonical
 * deck changes. This overlay never keeps a parallel index.
 */
export function PresentMode({
  snapshot,
  store,
}: {
  snapshot: PresentationSnapshot;
  store: PresentationStore;
}) {
  const slideOrder = snapshot.presentation.slideOrder;
  const slideId = snapshot.session.activeSlideId;
  const index = slideOrder.indexOf(slideId);
  const lastIndex = slideOrder.length - 1;
  const slide = snapshot.presentation.slides[slideId];
  const rootRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    rootRef.current?.focus();
    return () => {
      const previous = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previous && previous.isConnected) {
        previous.focus();
      }
    };
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) {
        return;
      }
      const order = store.getSnapshot().presentation.slideOrder;
      switch (event.key) {
        case 'ArrowRight':
        case ' ':
        case 'PageDown':
        case 'Enter':
          event.preventDefault();
          store.controlPresentation({ action: 'next' });
          return;
        case 'ArrowLeft':
        case 'PageUp':
          event.preventDefault();
          store.controlPresentation({ action: 'previous' });
          return;
        case 'Home':
          event.preventDefault();
          store.controlPresentation({ action: 'go_to_slide', slideId: order[0] });
          return;
        case 'End':
          event.preventDefault();
          store.controlPresentation({ action: 'go_to_slide', slideId: order[order.length - 1] });
          return;
        case 'Tab':
          trapTab(rootRef.current, event);
          return;
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [store]);

  return (
    <div
      aria-label={`Presenting: ${snapshot.presentation.title}`}
      aria-modal="true"
      className="present-mode"
      ref={rootRef}
      role="dialog"
      tabIndex={-1}
    >
      <div className="present-slide">
        <SlideArtwork slideId={slideId} snapshot={snapshot} />
      </div>
      <div className="present-bar">
        <button
          aria-label="Previous slide"
          className="present-btn"
          disabled={index <= 0}
          onClick={() => store.controlPresentation({ action: 'previous' })}
          type="button"
        >
          ←
        </button>
        <span className="present-counter">
          {index + 1} / {slideOrder.length}
        </span>
        <span className="present-name">{slideDisplayName(slide)}</span>
        <button
          aria-label="Next slide"
          className="present-btn"
          disabled={index >= lastIndex}
          onClick={() => store.controlPresentation({ action: 'next' })}
          type="button"
        >
          →
        </button>
        <button
          className="present-btn is-primary"
          onClick={() => store.controlPresentation({ action: 'exit' })}
          type="button"
        >
          Exit
        </button>
      </div>
    </div>
  );
}

/**
 * Cycle focus between the stage's own focusable controls; when the stage has
 * no controls, keep focus on the stage itself. Visibility is checked with
 * getClientRects, which works for fixed-position controls.
 */
function trapTab(root: HTMLElement | null, event: KeyboardEvent): void {
  if (!root) {
    return;
  }
  const focusables = Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.getClientRects().length > 0);
  if (focusables.length === 0) {
    event.preventDefault();
    root.focus();
    return;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  if (event.shiftKey) {
    if (active === first || !root.contains(active)) {
      event.preventDefault();
      last.focus();
    }
  } else if (active === last || !root.contains(active)) {
    event.preventDefault();
    first.focus();
  }
}
