import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
} from 'react';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../lib/presentation/canvas';
import type { PresentationStore, PresentationSnapshot } from '../../lib/presentation/store';
import type { Frame, PresentationElement, TextElement } from '../../types/presentation';
import {
  newTextElement,
  addTextElement,
  updateFrameElements,
  updateText,
} from './commands';
import type { CommandContext } from './command-registry';
import type { ToolMode } from './command-bar';
import { CanvasContextMenu, type CanvasMenuTarget } from './canvas-context-menu';
import {
  beginGesture,
  cancelGesture,
  elementPreviewFrame,
  framesEqual,
  gestureCommitTargets,
  gesturePreviewFrame,
  keyboardMoveFrame,
  keyboardResizeDelta,
  keyboardResizeFrame,
  releaseGesture,
  settleGesture,
  slidePointFromClient,
  trackGesture,
  type GestureState,
  type ResizeDirection,
} from './gesture';
import { InlineTextEditor } from './inline-text-editor';
import { SelectionActionBar } from './selection-action-bar';
import {
  placeSelectionActionBar,
  SELECTION_BAR_ESTIMATED_WIDTH_PX,
  SELECTION_BAR_HEIGHT_PX,
} from './selection-bar-placement';
import { SlideArtwork } from './slide-artwork';

const ARROW_DELTAS: Record<string, [number, number]> = {
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
};

function blurActiveElement(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement) {
    active.blur();
  }
}

function unionFrames(frames: readonly Frame[]): Frame | null {
  if (frames.length === 0) {
    return null;
  }
  let left = frames[0].x;
  let top = frames[0].y;
  let right = frames[0].x + frames[0].width;
  let bottom = frames[0].y + frames[0].height;
  for (let index = 1; index < frames.length; index++) {
    const frame = frames[index];
    left = Math.min(left, frame.x);
    top = Math.min(top, frame.y);
    right = Math.max(right, frame.x + frame.width);
    bottom = Math.max(bottom, frame.y + frame.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** A session of inline text editing: the canonical baseline and the draft state. */
interface EditingSession {
  elementId: string;
  /** Canonical text when the session began; the commit guard reads it again. */
  baseline: string;
  /** Whether the user changed the draft at least once. */
  dirty: boolean;
  /** Caret anchor from the double-click that opened the session. */
  caret: { clientX: number; clientY: number } | null;
}

/**
 * The interactive canvas: one browser-only gesture transaction for move and
 * resize (`tracking` while the pointer is down, `committing` until the
 * atomic frame batch settles), tool-mode element creation, the Base UI
 * context menu, inline text editing, and the element keyboard shortcuts.
 * Everything here is ephemeral; durable state goes through human
 * store.dispatch calls in `./commands`.
 */
export function CanvasStage({
  ctx,
  keyboardEnabled,
  notify,
  onFitScaleChange,
  onMenuOpenChange,
  onToolModeChange,
  selectedIds,
  slideId,
  snapshot,
  store,
  toolMode,
  zoom,
}: {
  ctx: CommandContext;
  keyboardEnabled: boolean;
  notify: (message: string) => void;
  onFitScaleChange: (scale: number) => void;
  onMenuOpenChange?: (open: boolean) => void;
  onToolModeChange: (mode: ToolMode) => void;
  selectedIds: readonly string[];
  slideId: string;
  snapshot: PresentationSnapshot;
  store: PresentationStore;
  toolMode: ToolMode;
  zoom: number;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const slideRef = useRef<HTMLDivElement>(null);
  const [gesture, setGesture] = useState<GestureState | null>(null);
  const gestureRef = useRef<GestureState | null>(null);
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const keyboardEnabledRef = useRef(keyboardEnabled);
  keyboardEnabledRef.current = keyboardEnabled;
  const creating = toolMode !== 'select';
  const selectionBarObserverRef = useRef<ResizeObserver | null>(null);
  const [selectionBarSize, setSelectionBarSize] = useState({
    width: SELECTION_BAR_ESTIMATED_WIDTH_PX,
    height: SELECTION_BAR_HEIGHT_PX,
  });

  const attachSelectionBar = useCallback((node: HTMLDivElement | null): void => {
    selectionBarObserverRef.current?.disconnect();
    selectionBarObserverRef.current = null;
    if (!node) {
      return;
    }
    const measure = (): void => {
      const width = node.offsetWidth;
      const height = node.offsetHeight;
      setSelectionBarSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    selectionBarObserverRef.current = observer;
  }, []);

  useEffect(() => {
    return () => {
      selectionBarObserverRef.current?.disconnect();
      selectionBarObserverRef.current = null;
    };
  }, []);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuOpenRef = useRef(menuOpen);
  menuOpenRef.current = menuOpen;
  const [menuTarget, setMenuTarget] = useState<CanvasMenuTarget | null>(null);
  const menuTargetRef = useRef(menuTarget);
  menuTargetRef.current = menuTarget;

  const [editing, setEditing] = useState<EditingSession | null>(null);
  const editingRef = useRef<EditingSession | null>(null);
  editingRef.current = editing;
  /** The latest draft the editor reported; the source of truth at commit time. */
  const editingDraftRef = useRef('');

  // Measurements: the fit scale keeps the whole 960x540 slide inside the
  // viewport at zoom level 1 (fit); the editor reports it upward so the zoom
  // readout and status bar stay truthful.
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const measure = (): void => {
      setViewport((current) =>
        current.width === stage.clientWidth && current.height === stage.clientHeight
          ? current
          : { width: stage.clientWidth, height: stage.clientHeight },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const computedFit = useMemo(() => {
    const availableWidth = Math.max(viewport.width - 52, 120);
    const availableHeight = Math.max(viewport.height - 52, 68);
    return Math.min(availableWidth / SLIDE_WIDTH, availableHeight / SLIDE_HEIGHT);
  }, [viewport]);

  const fitScaleRef = useRef(computedFit);
  useEffect(() => {
    if (Math.abs(fitScaleRef.current - computedFit) > 1e-4) {
      fitScaleRef.current = computedFit;
      onFitScaleChange(computedFit);
    }
  }, [computedFit, onFitScaleChange]);

  const scale = computedFit * zoom;

  function applyGesture(next: GestureState | null): void {
    gestureRef.current = next;
    setGesture(next);
  }

  function env() {
    return { slideId, snapshot, store };
  }

  function handleFailedCommit(result: { ok: false; notice: string }): void {
    notify(result.notice);
  }

  function elementNode(elementId: string): HTMLElement | null {
    const nodes = slideRef.current?.querySelectorAll<HTMLElement>('[data-element-id]') ?? [];
    for (const node of nodes) {
      if (node.getAttribute('data-element-id') === elementId) {
        return node;
      }
    }
    return null;
  }

  // --- Inline text editing ---------------------------------------------------

  /**
   * Enter the inline editor for a text element. Only a selected, unlocked
   * text element can be edited, and only while nothing is mid-gesture: the
   * editor owns every pointer and key event until commit or cancel.
   */
  function startEditing(elementId: string, caret: { clientX: number; clientY: number } | null): void {
    if (gestureRef.current || creating) {
      // Editing is a Select-mode behavior: never while a creation tool is
      // active (its clicks place elements) or a gesture transaction owns
      // the canvas.
      return;
    }
    const element = snapshot.presentation.slides[slideId].elements[elementId];
    if (
      !element ||
      element.kind !== 'text' ||
      element.locked ||
      !selectedIdsRef.current.includes(elementId)
    ) {
      return;
    }
    editingDraftRef.current = element.text;
    setEditing({ elementId, baseline: element.text, dirty: false, caret });
  }

  /**
   * Enter the inline editor on the element a creation flow just placed and
   * selected (Text tool click, canvas-menu Add text): the session opens
   * directly because the fresh element is already known-good, and its empty
   * seed makes an untouched commit delete the element instead of leaving a
   * placeholder behind.
   *
   * The session opens one task after the flow that created the element: a
   * press or menu activation blurs the focused node as its default behavior
   * completes, and an editor mounted inside that same input would be blurred
   * again immediately — committing (and deleting) the empty element before
   * the user can type.
   */
  function beginEditingCreatedElement(element: TextElement): void {
    window.setTimeout(() => {
      editingDraftRef.current = element.text;
      setEditing({ elementId: element.id, baseline: element.text, dirty: false, caret: null });
    }, 0);
  }

  /** End the session and return keyboard focus to the element. */
  function endEditing(session: EditingSession): void {
    setEditing(null);
    elementNode(session.elementId)?.focus({ preventScroll: true });
  }

  function cancelEditing(): void {
    const session = editingRef.current;
    if (session) {
      endEditing(session);
    }
  }

  /**
   * Commit a draft through the guarded canonical command; resolves true when
   * the session may end. A session that changed nothing ends without any
   * write; an empty draft deletes the element (the tldraw/Excalidraw rule —
   * an empty text box is meaningless, so committing one removes it); a stale
   * draft (canonical changed while dirty) is blocked and the review UI asks
   * the user to cancel or retry instead of overwriting. The commit resolves
   * only after the server accepted or rejected the write.
   */
  async function commitEditing(text: string): Promise<boolean> {
    const session = editingRef.current;
    if (!session) {
      return true;
    }
    const element = snapshot.presentation.slides[slideId].elements[session.elementId];
    if (!element || element.kind !== 'text') {
      endEditing(session);
      return true;
    }
    if (text === '') {
      if (element.text !== session.baseline) {
        // The element changed elsewhere while the draft was emptied: the
        // conflict review decides, never a silent delete.
        return false;
      }
      const deletion = await store.dispatch({
        actorKind: 'human',
        label: `Deleted ${element.name}`,
        operations: [
          { type: 'delete_element', slideId, elementId: session.elementId, expectedElement: element },
        ],
      });
      if (!deletion.ok) {
        notify('That element could not be removed. Please review and try again.');
        return false;
      }
      endEditing(session);
      return true;
    }
    if (text === session.baseline) {
      // Nothing was changed by the user: the canonical text stays authoritative.
      endEditing(session);
      return true;
    }
    if (element.text !== session.baseline) {
      return false;
    }
    const result = await updateText(env(), element, text);
    if (!result.ok) {
      notify(result.notice);
      return false;
    }
    endEditing(session);
    return true;
  }

  /** Retry a stale draft against the current canonical text with a fresh guard. */
  async function retryEditing(): Promise<void> {
    const session = editingRef.current;
    if (!session) {
      return;
    }
    const element = snapshot.presentation.slides[slideId].elements[session.elementId];
    if (!element || element.kind !== 'text') {
      endEditing(session);
      return;
    }
    if (editingDraftRef.current === '') {
      const deletion = await store.dispatch({
        actorKind: 'human',
        label: `Deleted ${element.name}`,
        operations: [
          { type: 'delete_element', slideId, elementId: session.elementId, expectedElement: element },
        ],
      });
      if (!deletion.ok) {
        notify('That element could not be removed. Please review and try again.');
        return;
      }
      endEditing(session);
      return;
    }
    const result = await updateText(env(), element, editingDraftRef.current);
    if (!result.ok) {
      notify(result.notice);
      return;
    }
    endEditing(session);
  }

  const editingElement =
    editing && snapshot.presentation.slides[slideId].elements[editing.elementId];
  const stale =
    editing !== null &&
    editing.dirty &&
    editingElement?.kind === 'text' &&
    editingElement.text !== editing.baseline;

  // A canonical change can remove the element mid-session (e.g. an agent
  // deletes it): the session must not hold the canvas without a surface.
  useEffect(() => {
    if (editing && !snapshot.presentation.slides[slideId].elements[editing.elementId]) {
      setEditing(null);
    }
  }, [editing, slideId, snapshot]);

  // While the context menu is open it owns Escape and the modal keyboard: no
  // shell shortcut may fire behind it. The gate runs in the capture phase so
  // it marks the event consumed before the workspace (and canvas) bubble
  // handlers ever see them; Base UI's own menu handler still runs and closes
  // the menu itself.
  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const listener = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' || event.metaKey || event.ctrlKey) {
        event.preventDefault();
      }
    };
    document.addEventListener('keydown', listener, { capture: true });
    return () => document.removeEventListener('keydown', listener, { capture: true });
  }, [menuOpen]);

  // --- Creation (Text / Shape tools) -----------------------------------------

  function handleStagePointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) {
      return;
    }
    if (editingRef.current || gestureRef.current) {
      // The edit session or a gesture transaction owns the canvas.
      return;
    }
    blurActiveElement();
    if (!creating) {
      // A blank Select-mode click clears the whole selection.
      store.clearSelection();
      return;
    }
    const point = slidePointFromClient(slideRef.current!.getBoundingClientRect(), event.clientX, event.clientY);
    if (toolMode === 'text') {
      const element = newTextElement(point);
      void store
        .dispatch({
          actorKind: 'human',
          label: `Added ${element.name}`,
          operations: [{ type: 'create_element', slideId, element }],
        })
        .then((result) => {
          if (!result.ok) {
            notify('That element could not be added. Please try again.');
            return;
          }
          store.selectElement(element.id);
          onToolModeChange('select');
          // The Text tool never lands a placeholder: the fresh element opens in
          // the inline editor, and an untouched commit removes it again.
          beginEditingCreatedElement(element);
        });
      return;
    }
    ctx.actions.addShape(point);
  }

  // --- Pointer gestures --------------------------------------------------------

  function handleElementPointerDown(event: PointerEvent<HTMLDivElement>, element: PresentationElement): void {
    if (creating) {
      // Creation modes place a new element on any canvas click; let the
      // event bubble to the slide frame.
      return;
    }
    if (editingRef.current || gestureRef.current) {
      // The edit session or a gesture transaction owns the canvas: this
      // press never selects or starts a second move.
      event.stopPropagation();
      return;
    }
    if (event.button !== 0) {
      // Right/middle button never mutates the selection: the context menu
      // owns the button and preserves multi-selections. Blur first so an
      // inspector draft commits against the element it was editing, like any
      // other selection-changing press.
      blurActiveElement();
      event.stopPropagation();
      return;
    }
    // Commit any focused inspector draft before the selection change below
    // re-renders it: the browser's own blur fires only during the mousedown
    // default action, which runs after this handler and after React flushed
    // the new selection, so a natural blur would commit the draft against
    // the newly selected element. Blurring first keeps the draft on the
    // element it was editing.
    blurActiveElement();
    event.stopPropagation();
    if (event.shiftKey || event.metaKey) {
      store.toggleElementSelection(element.id);
      return;
    }
    // The selection stays intact when the press lands on an element that is
    // already selected: the drag carries every selected element instead of
    // silently collapsing to the pressed one.
    if (!selectedIdsRef.current.includes(element.id)) {
      store.selectElement(element.id);
    }
    if (element.locked) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const originPointer = slidePointFromClient(slideRef.current!.getBoundingClientRect(), event.clientX, event.clientY);
    applyGesture(
      beginGesture(gestureRef.current, {
        kind: 'move',
        elementId: element.id,
        elementName: element.name,
        pointerId: event.pointerId,
        originPointer,
        origin: null,
        frame: null,
        pointer: originPointer,
      }),
    );
  }

  function handleResizePointerDown(
    event: PointerEvent<HTMLButtonElement>,
    element: PresentationElement,
    direction: ResizeDirection,
  ): void {
    if (event.button !== 0 || gestureRef.current) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const originPointer = slidePointFromClient(slideRef.current!.getBoundingClientRect(), event.clientX, event.clientY);
    applyGesture(
      beginGesture(gestureRef.current, {
        kind: 'resize',
        elementId: element.id,
        elementName: element.name,
        pointerId: event.pointerId,
        originPointer,
        origin: null,
        frame: null,
        pointer: originPointer,
        direction,
      }),
    );
  }

  function handleGesturePointerMove(event: PointerEvent<HTMLElement>): void {
    const current = gestureRef.current;
    if (!current || current.phase !== 'tracking' || event.pointerId !== current.pointerId) {
      return;
    }
    const pointer = slidePointFromClient(slideRef.current!.getBoundingClientRect(), event.clientX, event.clientY);
    let origin = current.origin;
    let moveTargets = current.moveTargets;
    if (!origin) {
      // First move: capture the canonical frames of every carried element so
      // the preview is exact and the pointer-up commit is fully guarded.
      const targets = selectedIdsRef.current
        .map((id) => snapshot.presentation.slides[slideId].elements[id])
        .filter((element): element is PresentationElement => Boolean(element) && !element.locked)
        .map((element) => ({ id: element.id, name: element.name, origin: element.frame }));
      if (targets.length === 0) {
        applyGesture(cancelGesture(current, event.pointerId));
        return;
      }
      moveTargets = targets;
      origin = targets.find((target) => target.id === current.elementId)?.origin ?? targets[0].origin;
    }
    applyGesture(
      trackGesture(current, {
        kind: current.kind,
        elementId: current.elementId,
        elementName: current.elementName,
        pointerId: current.pointerId,
        originPointer: current.originPointer,
        origin,
        moveTargets,
        pointer,
        frame: gesturePreviewFrame(current.kind, origin, current.originPointer, pointer, current.direction),
        direction: current.direction,
      }),
    );
  }

  function handleGesturePointerUp(event: PointerEvent<HTMLElement>): void {
    const released = releaseGesture(gestureRef.current, event.pointerId);
    applyGesture(released.gesture);
    if (!released.commit) {
      return;
    }
    const committing = released.gesture;
    const targets = gestureCommitTargets(committing);
    const label =
      committing.kind === 'move'
        ? targets.length === 1
          ? `Moved ${targets[0].elementId === committing.elementId ? committing.elementName : 'an element'}`
          : `Moved ${targets.length} elements`
        : `Resized ${committing.elementName}`;
    void updateFrameElements(env(), label, targets).then((result) => {
      applyGesture(settleGesture(gestureRef.current));
      if (!result.ok) {
        handleFailedCommit(result);
      }
    });
  }

  function handleGesturePointerCancel(event: PointerEvent<HTMLElement>): void {
    applyGesture(cancelGesture(gestureRef.current, event.pointerId));
  }

  // --- Keyboard resize on the visible handles -----------------------------------

  function handleResizeKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    element: PresentationElement,
    direction: ResizeDirection,
  ): void {
    const [deltaWidth, deltaHeight] = keyboardResizeDelta(direction, event.key, event.shiftKey ? 10 : 1);
    if (deltaWidth === 0 && deltaHeight === 0) {
      return;
    }
    if (gestureRef.current) {
      event.preventDefault();
      return;
    }
    // Mark the event consumed so the editor-wide document handlers below
    // stop (they bail on defaultPrevented) and never also nudge the
    // selection from this same key.
    event.preventDefault();
    // Read the live canonical frame so key auto-repeat always steps from the
    // latest committed state — never from a stale expected frame that would
    // raise a false conflict.
    const current = store.getSnapshot().presentation.slides[slideId].elements[element.id];
    if (!current) {
      return;
    }
    const frame = keyboardResizeFrame(current.frame, deltaWidth, deltaHeight, direction);
    if (framesEqual(frame, current.frame)) {
      return;
    }
    void updateFrameElements(env(), `Resized ${current.name}`, [
      { elementId: current.id, expected: current.frame, next: frame },
    ]).then((result) => {
      if (!result.ok) {
        handleFailedCommit(result);
      }
    });
  }

  // --- Context menu -----------------------------------------------------------------

  function handleContextMenu(event: ReactMouseEvent): void {
    event.preventDefault();
    if (editingRef.current || gestureRef.current) {
      // The editor or a gesture transaction owns the surface: no menu, and no
      // selection mutation from the same event. Base UI's own handler is
      // skipped so nothing opens.
      event.preventBaseUIHandler?.();
      return;
    }
    // The target can be any visual descendant: shapes render their fill
    // through nested SVG nodes, so the guard must accept every Element,
    // not just HTMLElement.
    const target = event.target instanceof Element ? event.target.closest('[data-element-id]') : null;
    const elementId = target?.getAttribute('data-element-id') ?? null;
    if (elementId && snapshot.presentation.slides[slideId].elements[elementId]) {
      // Right-clicking an unselected element selects it first; a selected or
      // multi-selected element keeps the selection intact.
      if (!selectedIdsRef.current.includes(elementId)) {
        store.selectElement(elementId);
      }
      // No focus move here: Base UI restores focus to the previously focused
      // element when the menu closes, and a focus-driven re-select would
      // collapse a selection a command just changed (e.g. Duplicate).
      setMenuTarget({ kind: 'element', elementId });
      return;
    }
    store.clearSelection();
    setMenuTarget({
      kind: 'background',
      point: slidePointFromClient(slideRef.current!.getBoundingClientRect(), event.clientX, event.clientY),
    });
  }

  function handleMenuOpenChange(open: boolean): void {
    setMenuOpen(open);
    onMenuOpenChange?.(open);
  }

  /**
   * Where the menu returns focus when it closes. The default return-to-
   * previously-focused behavior can silently re-select an element a command
   * just replaced (Duplicate switches the selection to the copy, Delete
   * empties it), so focus follows the current selection instead: the
   * right-clicked element while it stays selected, else the primary, else
   * nothing. Returning false keeps focus untouched when nothing is selected.
   */
  function contextMenuFinalFocus(): HTMLElement | false {
    const target = menuTargetRef.current;
    const targetId = target?.kind === 'element' ? target.elementId : null;
    const selected = selectedIdsRef.current;
    const focusId =
      targetId && selected.includes(targetId) ? targetId : (selected[0] ?? null);
    if (!focusId) {
      return false;
    }
    return elementNode(focusId) ?? false;
  }

  // --- Element menu actions ------------------------------------------------------------

  // Menu actions live in the registry and run through `ctx.actions`; the
  // only canvas-owned menu behavior is entering the inline editor, so the
  // menu context overlays that action — and the text creation that must
  // open it — on the workspace context.
  const menuContext: CommandContext =
    menuTarget !== null
      ? {
          ...ctx,
          menuTarget,
          actions: {
            ...ctx.actions,
            editText: (elementId) => startEditing(elementId, null),
            addText: (point) => {
              void addTextElement(env(), point).then((result) => {
                if (!result.ok) {
                  notify(result.notice);
                  return;
                }
                store.selectElement(result.elementId);
                onToolModeChange('select');
                const element = snapshot.presentation.slides[slideId].elements[result.elementId];
                if (element?.kind === 'text') {
                  beginEditingCreatedElement(element);
                }
              });
            },
          },
        }
      : ctx;

  // --- Editor keyboard shortcuts ------------------------------------------------

  function nudgeSelection(event: KeyboardEvent): void {
    const delta = ARROW_DELTAS[event.key];
    if (!delta) {
      return;
    }
    const distance = event.shiftKey ? 10 : 1;
    const slide = snapshot.presentation.slides[slideId];
    const targets = selectedIds
      .map((id) => slide.elements[id])
      .filter((element): element is PresentationElement => Boolean(element) && !element.locked)
      .map((element) => ({
        elementId: element.id,
        expected: element.frame,
        next: keyboardMoveFrame(element.frame, delta[0] * distance, delta[1] * distance),
      }))
      .filter((target) => target.next.x !== target.expected.x || target.next.y !== target.expected.y);
    if (targets.length === 0) {
      return;
    }
    void updateFrameElements(
      env(),
      targets.length === 1 ? `Moved ${slide.elements[targets[0].elementId].name}` : `Moved ${targets.length} elements`,
      targets,
    ).then((result) => {
      if (!result.ok) {
        handleFailedCommit(result);
      }
    });
  }

  function handleEditorKeyDown(event: KeyboardEvent): void {
    // A prior owner (resize-handle keys, modal navigation, an input's own
    // controls) consumed this key; never process it twice.
    if (event.defaultPrevented) {
      return;
    }
    if (gestureRef.current) {
      // A tracking or committing gesture owns the canvas: consume the key
      // so the shell registry cannot fire delete/nudge behind it.
      event.preventDefault();
      return;
    }
    if (!keyboardEnabledRef.current || menuOpenRef.current) {
      // A modal context menu owns the keyboard: no element shortcut may
      // fire from its keys.
      return;
    }
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.closest('input, textarea, select') ||
        // A focused resize handle owns its keys: Delete/Backspace here must
        // never remove the element from under a keyboard resize.
        target.closest('.resize-handle'))
    ) {
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
        if (selectedIdsRef.current.length > 0) {
          event.preventDefault();
          nudgeSelection(event);
        }
        return;
    }
  }

  // The document listener reads the latest render through a ref so the single
  // subscription stays stable while gestures re-render the stage.
  const keyHandlerRef = useRef(handleEditorKeyDown);
  useEffect(() => {
    keyHandlerRef.current = handleEditorKeyDown;
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      keyHandlerRef.current(event);
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);

  const slideWidth = Math.round(SLIDE_WIDTH * scale);
  const slideHeight = Math.round(SLIDE_HEIGHT * scale);

  const showSelectionBar =
    toolMode === 'select' &&
    editing === null &&
    gesture === null &&
    !menuOpen &&
    keyboardEnabled &&
    selectedIds.length > 0;

  const selectionUnion = useMemo(() => {
    if (!showSelectionBar) {
      return null;
    }
    const slide = snapshot.presentation.slides[slideId];
    const frames = selectedIds
      .map((id) => slide.elements[id])
      .filter((element): element is PresentationElement => element !== undefined)
      .map((element) => elementPreviewFrame(element, gesture));
    return unionFrames(frames);
  }, [gesture, selectedIds, showSelectionBar, slideId, snapshot]);

  const selectionBarBox =
    selectionUnion === null
      ? null
      : placeSelectionActionBar({
          union: selectionUnion,
          slideWidthPx: slideWidth,
          slideHeightPx: slideHeight,
          barWidth: selectionBarSize.width,
          barHeight: selectionBarSize.height,
        });

  const editingInline =
    editing && editingElement?.kind === 'text' ? (
      <InlineTextEditor
        caretPoint={editing.caret}
        element={editingElement}
        onCommit={(text) => commitEditing(text)}
        onDraftChange={(text) => {
          editingDraftRef.current = text;
          setEditing((current) => (current ? { ...current, dirty: text !== current.baseline } : current));
        }}
      />
    ) : null;

  return (
    <div className={`canvas-stage${creating ? ' is-creating' : ''}`} ref={stageRef}>
      <div className="canvas-wrap" style={{ width: slideWidth + 52, height: slideHeight + 52 }}>
        <CanvasContextMenu
          ctx={menuContext}
          finalFocus={contextMenuFinalFocus}
          onContextMenu={handleContextMenu}
          onOpenChange={handleMenuOpenChange}
          render={
            <div
              className="slide-frame"
              onPointerDown={handleStagePointerDown}
              ref={slideRef}
              style={{ width: slideWidth, height: slideHeight }}
            >
              <SlideArtwork
                editingElementId={editing?.elementId ?? null}
                gesture={gesture}
                inlineEditor={editingInline}
                interactive
                onElementFocus={(elementId) => {
                  // Focus reveals an unselected element (Tab navigation) but
                  // never dismembers an existing selection: right-click
                  // focus-restore must keep a multi-selection intact.
                  if (gestureRef.current || selectedIdsRef.current.includes(elementId)) {
                    return;
                  }
                  store.selectElement(elementId);
                }}
                onElementPointerDown={handleElementPointerDown}
                onGesturePointerCancel={handleGesturePointerCancel}
                onGesturePointerMove={handleGesturePointerMove}
                onGesturePointerUp={handleGesturePointerUp}
                onResizeKeyDown={handleResizeKeyDown}
                onResizePointerDown={handleResizePointerDown}
                onStartEditing={startEditing}
                selectedElementIds={creating ? [] : selectedIds}
                slideId={slideId}
                snapshot={snapshot}
              />
              {showSelectionBar && selectionUnion && selectionBarBox ? (
                <SelectionActionBar
                  box={selectionBarBox}
                  ctx={ctx}
                  ref={attachSelectionBar}
                />
              ) : null}
            </div>
          }
        />
      </div>
      {stale ? (
        <div className="edit-conflict" role="alert">
          <span>This text changed elsewhere while you were editing.</span>
          <button onMouseDown={(event) => event.preventDefault()} onClick={cancelEditing} type="button">
            Use latest
          </button>
          <button
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void retryEditing()}
            type="button"
          >
            Try again
          </button>
        </div>
      ) : null}
    </div>
  );
}