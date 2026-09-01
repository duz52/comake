import { useEffect, useRef, useState } from 'react';
import type { PresentationSnapshot } from '../../lib/presentation/store';
import { SlideArtwork } from './slide-artwork';
import { slideDisplayName } from './slide-label';

/**
 * Genuine full-screen presentation of the canonical deck: the active slide
 * scaled to the window, arrow-key navigation, and exit via Escape or the on
 * screen bar. No fake chrome — it presents the real snapshot.
 *
 * Focus contract: the stage takes focus on open and restores it to the
 * opener on close; Tab and Shift+Tab stay trapped inside. Escape is owned by
 * the workspace keyboard controller (present -> palette -> drawer), never by
 * this document handler.
 *
 * Live mutation safety: the canonical deck can change while presenting
 * (e.g. an agent deletes slides). The rendered index is clamped once against
 * the current order before any read or navigation; the kernel guarantees at
 * least one slide, so the clamped index always names a real slide.
 */
export function PresentMode({
  onExit,
  snapshot,
  startSlideId,
}: {
  onExit: () => void;
  snapshot: PresentationSnapshot;
  startSlideId: string;
}) {
  const slideOrder = snapshot.presentation.slideOrder;
  const [index, setIndex] = useState(() => Math.max(0, slideOrder.indexOf(startSlideId)));
  const rootRef = useRef<HTMLDivElement>(null);
  // The element that owned focus before the stage opened; restored on close.
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
    // The kernel guarantees a non-empty deck, so the last index is always >= 0.
    const lastIndex = slideOrder.length - 1;
    const handler = (event: KeyboardEvent): void => {
      // Another owner handled this key first; never process it twice.
      if (event.defaultPrevented) {
        return;
      }
      switch (event.key) {
        case 'ArrowRight':
        case ' ':
        case 'PageDown':
        case 'Enter':
          event.preventDefault();
          setIndex((current) => Math.min(current + 1, lastIndex));
          return;
        case 'ArrowLeft':
        case 'PageUp':
          event.preventDefault();
          setIndex((current) => Math.max(current - 1, 0));
          return;
        case 'Home':
          event.preventDefault();
          setIndex(0);
          return;
        case 'End':
          event.preventDefault();
          setIndex(lastIndex);
          return;
        case 'Tab':
          trapTab(rootRef.current, event);
          return;
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [slideOrder]);

  // One clamped index for render and navigation: a live deck shrinking under
  // the presenter never yields an out-of-range index or an undefined slide.
  const lastIndex = slideOrder.length - 1;
  const safeIndex = Math.min(index, lastIndex);

  const slideId = slideOrder[safeIndex];
  const slide = snapshot.presentation.slides[slideId];

  return (
    <div
      aria-label={`Presenting: ${snapshot.presentation.title}`}
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
          disabled={safeIndex === 0}
          onClick={() => setIndex((current) => Math.max(current - 1, 0))}
          type="button"
        >
          ←
        </button>
        <span className="present-counter">
          {safeIndex + 1} / {slideOrder.length}
        </span>
        <span className="present-name">{slideDisplayName(slide)}</span>
        <button
          aria-label="Next slide"
          className="present-btn"
          disabled={safeIndex === lastIndex}
          onClick={() => setIndex((current) => Math.min(current + 1, lastIndex))}
          type="button"
        >
          →
        </button>
        <button className="present-btn is-primary" onClick={onExit} type="button">
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