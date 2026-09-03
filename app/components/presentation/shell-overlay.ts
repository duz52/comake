import type { DrawerKind } from './command-registry';

/**
 * Inspector open intent is independent of viewport presentation.
 * `'default'` is the SSR/hydration value: open as the desktop column, closed
 * once a narrow viewport is known. Explicit `'open' | 'closed'` survives resize.
 * The viewport never writes this.
 */
export type InspectorIntent = 'default' | 'open' | 'closed';

export function inspectorIsOpen(intent: InspectorIntent, wideViewport: boolean): boolean {
  return intent === 'open' || (intent === 'default' && wideViewport);
}

export interface ShellChromeInput {
  intent: InspectorIntent;
  wideViewport: boolean;
  presenting: boolean;
}

export interface ShellChrome {
  inspectorOpen: boolean;
  inspectorInline: boolean;
  inspectorOverlay: boolean;
}

/** Derived inspector chrome. Drawer occupancy is the `drawer` state itself. */
export function deriveShellChrome(input: ShellChromeInput): ShellChrome {
  const inspectorOpen = inspectorIsOpen(input.intent, input.wideViewport);
  return {
    inspectorOpen,
    inspectorInline: inspectorOpen && input.wideViewport,
    inspectorOverlay: inspectorOpen && !input.wideViewport && !input.presenting,
  };
}

export interface InspectorToggleResult {
  intent: 'open' | 'closed';
  drawer: DrawerKind | null;
  dismissTransientMenus: boolean;
}

/** Toggle from the derived open bit. Occupying the narrow overlay slot clears the drawer. */
export function toggleInspectorTransition(input: {
  inspectorOpen: boolean;
  wideViewport: boolean;
  drawer: DrawerKind | null;
}): InspectorToggleResult {
  const nextOpen = !input.inspectorOpen;
  const occupiesOverlay = nextOpen && !input.wideViewport;
  return {
    intent: nextOpen ? 'open' : 'closed',
    drawer: occupiesOverlay ? null : input.drawer,
    dismissTransientMenus: occupiesOverlay,
  };
}

export interface DrawerToggleResult {
  drawer: DrawerKind | null;
  inspectorIntent: 'closed' | undefined;
  dismissTransientMenus: boolean;
}

/** Opening a review drawer occupies the right overlay; on a narrow viewport it closes inspector. */
export function toggleDrawerTransition(input: {
  drawer: DrawerKind | null;
  kind: DrawerKind;
  wideViewport: boolean;
}): DrawerToggleResult {
  const next = input.drawer === input.kind ? null : input.kind;
  const occupiesOverlay = next !== null;
  return {
    drawer: next,
    inspectorIntent: occupiesOverlay && !input.wideViewport ? 'closed' : undefined,
    dismissTransientMenus: occupiesOverlay,
  };
}

export interface ViewportChangeResult {
  wideViewport: boolean;
  drawer: DrawerKind | null;
  dismissTransientMenus: boolean;
}

/**
 * matchMedia handler: presentation flips, intent does not. If the inspector
 * remains open as an overlay, the review drawer and transient menus yield in
 * this same turn.
 */
export function viewportChangeTransition(input: {
  wide: boolean;
  intent: InspectorIntent;
  drawer: DrawerKind | null;
}): ViewportChangeResult {
  const wouldBeOpen = inspectorIsOpen(input.intent, input.wide);
  const inspectorOccupiesOverlay = !input.wide && wouldBeOpen;
  return {
    wideViewport: input.wide,
    drawer: inspectorOccupiesOverlay && input.drawer !== null ? null : input.drawer,
    dismissTransientMenus: inspectorOccupiesOverlay,
  };
}

export type OverlayOpenerKind = 'more' | 'review' | 'active';

/**
 * A menu item is not a persistent surface. Restore to the expanded trigger
 * that owns the open menu; otherwise keep the event target (stable bar button).
 */
export function overlayOpenerFromMenuState(input: {
  fromMenu: boolean;
  expandedMore: boolean;
  expandedReview: boolean;
}): OverlayOpenerKind {
  if (!input.fromMenu) {
    return 'active';
  }
  if (input.expandedReview && !input.expandedMore) {
    return 'review';
  }
  return 'more';
}

/**
 * Dirty inspector fields own Escape: cancel the draft and consume the event
 * so the overlay does not close (and does not blur-commit). A clean field
 * lets Escape bubble to the workspace overlay handler.
 */
export function consumeDirtyInspectorEscape(
  event: { key: string; preventDefault: () => void },
  dirty: boolean,
  revert: () => void,
): void {
  if (event.key !== 'Escape' || !dirty) {
    return;
  }
  event.preventDefault();
  revert();
}
