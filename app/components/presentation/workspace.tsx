import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate, useParams } from 'react-router';
import { humanActor } from '../../lib/presentation/actors';
import { presentationSlidePath } from '../../lib/presentation/location';
import { downloadPptx } from '../../lib/presentation/pptx-download';
import { PresentationStore, type PresentationSnapshot } from '../../lib/presentation/store';
import { useWebMcp } from '../../lib/presentation/webmcp';
import type { ChangeSet, Comment, TextStyle } from '../../types/presentation';
import { AgentPanel } from './agent-panel';
import { CanvasStage } from './canvas-stage';
import {
  addShapeElement,
  addSlide as commandAddSlide,
  addSlideAfter as commandAddSlideAfter,
  alignElements,
  deleteElements,
  deleteSlide as commandDeleteSlide,
  duplicateElements,
  duplicateSlide as commandDuplicateSlide,
  reorderElements,
  updateTextStyle,
  type Alignment,
  type CommandEnv,
  type ElementOrderDirection,
} from './commands';
import { CommandBar, type ToolMode } from './command-bar';
import {
  commandsForSurface,
  deriveSelectionFlags,
  INSPECTOR_MIN_VIEWPORT,
  shortcutMatchesKey,
  type CommandContext,
} from './command-registry';
import { CommandPalette } from './command-palette';
import { CommentsPanel } from './comments-panel';
import { ActivityPanel } from './activity-panel';
import { EditorHeader, type DrawerKind } from './editor-header';
import { EditorStatusBar } from './editor-status-bar';
import { InspectorPanel } from './inspector-panel';
import { PanelDrawer } from './panel-drawer';
import { PresentMode } from './present-mode';
import { SlideRail } from './slide-rail';
import { slideDisplayName } from './slide-label';

const ZOOM_STEP = 0.25;

function usePresentation(store: PresentationStore): PresentationSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function PresentationWorkspace() {
  const storeRef = useRef<PresentationStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = new PresentationStore();
  }

  return <Workspace store={storeRef.current} />;
}

function Workspace({ store }: { store: PresentationStore }) {
  const snapshot = usePresentation(store);
  const webMcpAvailable = useWebMcp(store);
  const navigate = useNavigate();
  const { slideId } = useParams();

  // --- Transient shell/view state (never canonical) --------------------------
  // The inspector and the wide-viewport flag start deterministic on every
  // platform so the server and the first client render are identical; the
  // matchMedia effect below corrects them right after hydration.
  const [toolMode, setToolMode] = useState<ToolMode>('select');
  const [fitScale, setFitScale] = useState(1);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [drawer, setDrawer] = useState<DrawerKind | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | undefined>(undefined);

  const activeSlideId =
    slideId && snapshot.presentation.slides[slideId] ? slideId : snapshot.session.activeSlideId;
  const activeSlide = snapshot.presentation.slides[activeSlideId];
  const selectedIds = snapshot.session.selectedElementIds;

  // Collapse the inspector on narrow viewports so the canvas keeps its room;
  // the breakpoint is the registry's one inspector fact, so the toggle never
  // renders inline while the panel cannot open.
  const [wideViewport, setWideViewport] = useState(true);
  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${INSPECTOR_MIN_VIEWPORT - 1}px)`);
    const update = (): void => setWideViewport(!media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!wideViewport) {
      setInspectorOpen(false);
    }
  }, [wideViewport]);

  // Route <-> store synchronization: the URL names the canonical slide, the
  // store owns session focus; they converge through this single effect.
  useEffect(() => {
    if (activeSlideId !== snapshot.session.activeSlideId) {
      store.selectSlide(activeSlideId);
    }
    if (slideId !== activeSlideId) {
      navigate(presentationSlidePath(snapshot.presentation.id, activeSlideId), { replace: true });
    }
  }, [activeSlideId, navigate, slideId, snapshot.presentation.id, snapshot.session.activeSlideId, store]);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3600);
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimerRef.current), []);

  const env: CommandEnv = useMemo(
    () => ({ slideId: activeSlide.id, snapshot, store }),
    [activeSlide.id, snapshot, store],
  );

  // --- Slide lifecycle ---------------------------------------------------------

  function openSlide(nextSlideId: string): void {
    store.selectSlide(nextSlideId);
    navigate(presentationSlidePath(snapshot.presentation.id, nextSlideId));
  }

  function addSlide(): void {
    const result = commandAddSlide(env);
    if (!result.ok) {
      notify(result.notice);
      return;
    }
    store.selectSlide(result.slideId);
    navigate(presentationSlidePath(snapshot.presentation.id, result.slideId));
  }

  function addSlideAfter(slideId: string): void {
    const result = commandAddSlideAfter(env, slideId);
    if (!result.ok) {
      notify(result.notice);
      return;
    }
    store.selectSlide(result.slideId);
    navigate(presentationSlidePath(snapshot.presentation.id, result.slideId));
  }

  function duplicateSlide(slideId?: string): void {
    const targetSlideId = slideId ?? activeSlide.id;
    const result = commandDuplicateSlide(env, targetSlideId);
    if (!result.ok) {
      notify(result.notice);
      return;
    }
    store.selectSlide(result.slideId);
    navigate(presentationSlidePath(snapshot.presentation.id, result.slideId));
  }

  function deleteSlide(slideId?: string): void {
    const targetSlideId = slideId ?? activeSlide.id;
    if (snapshot.presentation.slideOrder.length <= 1) {
      notify('The final slide cannot be deleted.');
      return;
    }
    const result = commandDeleteSlide(env, targetSlideId);
    if (!result.ok) {
      notify(result.notice);
    }
  }

  // --- Selection commands ---------------------------------------------------------

  const selection = useMemo(() => deriveSelectionFlags(activeSlide, selectedIds), [activeSlide, selectedIds]);

  function duplicateSelection(): void {
    const result = duplicateElements(env, selectedIds);
    if (!result.ok) {
      notify(result.notice);
      return;
    }
    store.selectElements(result.newIds);
  }

  function deleteSelection(): void {
    const result = deleteElements(env, selectedIds);
    if (!result.ok) {
      notify(result.notice);
    }
  }

  function alignSelection(alignment: Alignment): void {
    const result = alignElements(env, selectedIds, alignment);
    if (!result.ok) {
      notify(result.notice);
    }
  }

  function reorderSelection(direction: ElementOrderDirection): void {
    const result = reorderElements(env, selectedIds, direction);
    if (!result.ok) {
      notify(result.notice);
    }
  }

  /** The single-selection style commit, read fresh against the current selection. */
  function applyTextStyle(style: TextStyle): void {
    const element = selection.singleUnlockedText;
    if (!element) {
      return;
    }
    const result = updateTextStyle(env, element, style);
    if (!result.ok) {
      notify(result.notice);
    }
  }

  /** Registry menu creation: a canonical shape at the menu point, selected after creation. */
  function addShapeElementAt(point?: { x: number; y: number }): void {
    const result = addShapeElement(env, point);
    if (!result.ok) {
      notify(result.notice);
      return;
    }
    store.selectElement(result.elementId);
    setToolMode('select');
  }

  // --- Comments ---------------------------------------------------------------

  function openComment(comment: Comment): void {
    store.selectSlide(comment.slideId);
    if (comment.elementId) {
      store.selectElement(comment.elementId);
    }
    navigate(presentationSlidePath(snapshot.presentation.id, comment.slideId));
    setDrawer(null);
  }

  function resolveComment(comment: Comment): void {
    const result = store.dispatch({
      actor: humanActor,
      label: 'Resolved a comment',
      operations: [
        {
          type: 'resolve_comment',
          commentId: comment.id,
          resolved: true,
          expectedResolved: comment.resolved,
        },
      ],
    });
    notify(result.ok ? 'Comment resolved.' : 'That comment could not be resolved. Please try again.');
  }

  function addComment(body: string): boolean {
    const comment: Comment = {
      id: crypto.randomUUID(),
      actor: humanActor,
      body,
      createdAt: new Date().toISOString(),
      resolved: false,
      slideId: activeSlide.id,
    };
    const result = store.dispatch({
      actor: humanActor,
      label: 'Left a comment',
      operations: [{ type: 'add_comment', comment }],
    });
    if (!result.ok) {
      notify('The comment could not be added. Please try again.');
      return false;
    }
    return true;
  }

  // --- Agent / history -----------------------------------------------------------

  function revertAgentChange(changeSet: ChangeSet): void {
    const reverted = store.revertAgentChange(changeSet.id);
    notify(
      reverted
        ? 'The agent change set was reverted.'
        : 'The artifact changed after this proposal. Review it before reverting.',
    );
  }

  function undoHumanChange(): void {
    const undone = store.undoLatestHumanChange();
    notify(undone ? 'Your latest change was undone.' : 'There is no safe human change to undo.');
  }

  function redoHumanChange(): void {
    const redone = store.redoLatestHumanChange();
    notify(redone ? 'Your latest undone change was redone.' : 'There is no safe change to redo.');
  }

  // --- Export / Present ------------------------------------------------------------

  /** Present is a modal surface: it closes every panel and palette first. */
  const startPresent = useCallback(() => {
    setDrawer(null);
    setPaletteOpen(false);
    setPresenting(true);
  }, []);

  function exportPresentation(): void {
    try {
      downloadPptx(snapshot.presentation);
      notify('Your editable PowerPoint file is downloading.');
    } catch {
      notify('The presentation could not be exported. Please try again.');
    }
  }

  // --- Zoom -------------------------------------------------------------------------

  const zoom = snapshot.session.zoom;
  const zoomPercent = Math.round(fitScale * zoom * 100);

  function zoomIn(): void {
    store.setZoom(zoom + ZOOM_STEP);
  }

  function zoomOut(): void {
    store.setZoom(zoom - ZOOM_STEP);
  }

  function zoomFit(): void {
    store.setZoom(1);
  }

  // --- The one command context --------------------------------------------------------

  const primaryId = selectedIds[0];
  const primaryElement = primaryId ? activeSlide.elements[primaryId] : undefined;

  /**
   * The single memoized registry context of the whole editor: every surface
   * (bar, canvas menu, slide-rail menus, palette, global keys) reads the
   * same command vocabulary from here, and no per-surface arrays or props
   * duplicate it. The actions wrap the canonical `./commands` functions and
   * the store; the registry never reimplements kernel logic.
   */
  const ctx: CommandContext = useMemo(
    () => ({
      snapshot,
      store,
      activeSlideId: activeSlide.id,
      selectedIds,
      primaryElement,
      selection,
      toolMode,
      inspectorOpen,
      zoomPercent,
      inspectorSupported: wideViewport,
      undoAvailable: snapshot.userUndoStack.length > 0,
      redoAvailable: snapshot.userRedoStack.length > 0,
      notify,
      menuTarget: null,
      menuSlideId: undefined,
      actions: {
        setToolMode,
        undo: undoHumanChange,
        redo: redoHumanChange,
        addSlide,
        addSlideAfter,
        duplicateSlide,
        deleteSlide,
        duplicateSelection,
        deleteSelection,
        selectAll: () => store.selectAll(),
        align: alignSelection,
        reorder: reorderSelection,
        textStyle: applyTextStyle,
        addShape: addShapeElementAt,
        zoomIn,
        zoomOut,
        zoomFit,
        toggleInspector: () => setInspectorOpen((current) => !current),
        toggleDrawer: (kind) => setDrawer((current) => (current === kind ? null : kind)),
        startPresent,
        exportPptx: exportPresentation,
      },
    }),
    [
      activeSlide,
      env,
      inspectorOpen,
      notify,
      primaryElement,
      selectedIds,
      selection,
      snapshot,
      startPresent,
      store,
      toolMode,
      wideViewport,
      zoomPercent,
    ],
  );

  // --- Keyboard controller: the shell owns Escape and ⌘K; every other
  // shortcut is bound from the registry's 'keys' surface. ---------------------------

  const keyboardRef = useRef({
    drawer: null as DrawerKind | null,
    menuOpen: false,
    paletteOpen: false,
    presenting: false,
  });
  keyboardRef.current = { drawer, menuOpen, paletteOpen, presenting };
  const ctxRef = useRef<CommandContext | null>(null);
  ctxRef.current = ctx;

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      // Another document handler (canvas resize keys, present-mode
      // navigation, an input's own controls) already consumed this key.
      if (event.defaultPrevented) {
        return;
      }
      const target = event.target;
      const editable =
        target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'));
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      // The palette is a shell surface, not a command: ⌘K toggles it from
      // anywhere except underneath Present mode or an open context menu.
      if (mod && key === 'k') {
        event.preventDefault();
        const kb = keyboardRef.current;
        if (!kb.presenting && !kb.menuOpen) {
          setPaletteOpen((current) => !current);
        }
        return;
      }
      if (event.key === 'Escape') {
        // One ordered Escape owner: present -> palette -> drawer -> reset
        // tool and selection (the canvas reset path that used to live in
        // CanvasStage). Closing modals works even while editing; the reset
        // fallback keeps the old input-safe behavior.
        const kb = keyboardRef.current;
        if (kb.presenting) {
          event.preventDefault();
          setPresenting(false);
          return;
        }
        if (kb.paletteOpen) {
          event.preventDefault();
          setPaletteOpen(false);
          return;
        }
        if (kb.drawer) {
          event.preventDefault();
          setDrawer(null);
          return;
        }
        if (!editable) {
          event.preventDefault();
          setToolMode('select');
          store.clearSelection();
        }
        return;
      }
      if (editable) {
        return;
      }
      // Modals and transient owners suppress the registry shortcuts: inline
      // text editing is editable; open menus, the palette, drawers, and
      // Present mode own their keys and never let a command fire behind them.
      const kb = keyboardRef.current;
      if (kb.presenting || kb.paletteOpen || kb.drawer || kb.menuOpen) {
        return;
      }
      // A focused resize handle owns its keys (keyboard resize); keyboard
      // focus inside a menu popup must never trigger a canvas command.
      if (target instanceof HTMLElement && target.closest('.resize-handle, [role="menu"]')) {
        return;
      }

      const commandCtx = ctxRef.current;
      if (!commandCtx) {
        return;
      }
      for (const command of commandsForSurface(commandCtx, 'keys')) {
        if (command.state !== 'enabled' || !command.shortcut) {
          continue;
        }
        if (
          shortcutMatchesKey(
            command.shortcut,
            { alt: event.altKey, mod, shift: event.shiftKey },
            event.key,
          )
        ) {
          event.preventDefault();
          command.run(commandCtx);
          return;
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // --- Derived header facts ---------------------------------------------------------

  const openCommentCount = Object.values(snapshot.comments).filter((comment) => !comment.resolved).length;
  const pendingAgentChanges = snapshot.changeSetOrder.filter((id) => {
    const changeSet = snapshot.changeSets[id];
    return changeSet && changeSet.actor.kind === 'agent' && !changeSet.revertedAt;
  }).length;

  // --- Render --------------------------------------------------------------------------

  return (
    <main className="editor-app">
      <EditorHeader
        activeDrawer={drawer}
        canExport
        onExport={exportPresentation}
        onOpenDrawer={(kind) => setDrawer((current) => (current === kind ? null : kind))}
        onPresent={startPresent}
        openCommentCount={openCommentCount}
        pendingAgentChanges={pendingAgentChanges}
        snapshot={snapshot}
        webMcpAvailable={webMcpAvailable}
      />
      <CommandBar ctx={ctx} />

      <div className={`editor-main${inspectorOpen && wideViewport ? '' : ' inspector-closed'}`}>
        <SlideRail ctx={ctx} onOpenSlide={openSlide} />
        <section aria-label="Canvas" className="canvas-column">
          <CanvasStage
            ctx={ctx}
            keyboardEnabled={!paletteOpen && !drawer && !presenting && !menuOpen}
            notify={notify}
            onFitScaleChange={setFitScale}
            onMenuOpenChange={setMenuOpen}
            onToolModeChange={setToolMode}
            selectedIds={selectedIds}
            slideId={activeSlide.id}
            snapshot={snapshot}
            store={store}
            toolMode={toolMode}
            zoom={zoom}
          />
        </section>
        {inspectorOpen && wideViewport ? (
          <InspectorPanel
            notify={notify}
            primaryId={primaryId}
            selectedIds={selectedIds}
            slideId={activeSlide.id}
            snapshot={snapshot}
            store={store}
          />
        ) : null}
      </div>

      <EditorStatusBar
        revision={snapshot.presentation.revision}
        selectedCount={selectedIds.length}
        slideCount={snapshot.presentation.slideOrder.length}
        slideName={slideDisplayName(activeSlide)}
        slideNumber={snapshot.presentation.slideOrder.indexOf(activeSlide.id) + 1}
      />

      {drawer === 'agent' ? (
        <PanelDrawer onClose={() => setDrawer(null)} title="Agent">
          <AgentPanel
            onRevertAgentChange={revertAgentChange}
            snapshot={snapshot}
            webMcpAvailable={webMcpAvailable}
          />
        </PanelDrawer>
      ) : null}
      {drawer === 'comments' ? (
        <PanelDrawer onClose={() => setDrawer(null)} title="Comments">
          <CommentsPanel
            onAddComment={addComment}
            onOpenComment={openComment}
            onResolveComment={resolveComment}
            snapshot={snapshot}
          />
        </PanelDrawer>
      ) : null}
      {drawer === 'activity' ? (
        <PanelDrawer onClose={() => setDrawer(null)} title="Activity">
          <ActivityPanel onRevertAgentChange={revertAgentChange} snapshot={snapshot} />
        </PanelDrawer>
      ) : null}

      <CommandPalette ctx={ctx} onClose={() => setPaletteOpen(false)} open={paletteOpen} />

      {presenting ? (
        <PresentMode
          onExit={() => setPresenting(false)}
          snapshot={snapshot}
          startSlideId={activeSlide.id}
        />
      ) : null}

      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </main>
  );
}