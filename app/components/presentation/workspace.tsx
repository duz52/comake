import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate, useNavigationType, useParams } from 'react-router';
import { DEMO_DISPLAY_NAME } from '../../lib/presentation/actors';
import type { PresentationDocument } from '../../lib/presentation/document';
import { decideSessionRoute, presentationSlidePath } from '../../lib/presentation/location';
import { downloadPptx } from '../../lib/presentation/pptx-download';
import { PresentationStore, type PresentationSnapshot } from '../../lib/presentation/store';
import { HttpProjectTransport } from '../../lib/presentation/transport';
import { useWebMcp } from '../../lib/presentation/webmcp';
import type { ChangeSet, Comment, ShapeGeometry, TextStyle } from '../../types/presentation';
import { AgentPanel } from './agent-panel';
import { CanvasStage } from './canvas-stage';
import {
  addShapeElement,
  addSlide as commandAddSlide,
  addSlideAfter as commandAddSlideAfter,
  alignElements,
  DEFAULT_SHAPE_GEOMETRY,
  deleteElements,
  deleteSlide as commandDeleteSlide,
  duplicateElements,
  duplicateSlide as commandDuplicateSlide,
  reorderElements,
  updatePresentationTitle,
  updateTextStyle,
  type Alignment,
  type CommandEnv,
  type ElementOrderDirection,
} from './commands';
import { CommandBar, type ToolMode } from './command-bar';
import {
  commandsForSurface,
  deriveSelectionFlags,
  INSPECTOR_INLINE_VIEWPORT,
  shortcutMatchesKey,
  type CommandContext,
} from './command-registry';
import { CommandPalette } from './command-palette';
import { CommentsPanel } from './comments-panel';
import { ActivityPanel } from './activity-panel';
import { EditorHeader, type DrawerKind } from './editor-header';
import { EditorStatusBar } from './editor-status-bar';
import { InspectorPanel } from './inspector-panel';
import { InspectorFrame, PanelDrawer } from './panel-drawer';
import { PresentMode } from './present-mode';
import {
  deriveShellChrome,
  overlayOpenerFromMenuState,
  toggleDrawerTransition,
  toggleInspectorTransition,
  viewportChangeTransition,
  type InspectorIntent,
} from './shell-overlay';
import { SlideRail } from './slide-rail';
import { slideDisplayName } from './slide-label';
import { TooltipProvider } from '../ui/tooltip';

const ZOOM_STEP = 0.25;

function usePresentation(store: PresentationStore): PresentationSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/**
 * The editor shell. The store bootstraps from the loader's canonical
 * document (identical server render and client hydration) and talks to the
 * project server through the HTTP transport; session-only state (selection,
 * zoom, focus, presenting) lives on the store session; tool mode stays in
 * local React state.
 */
export function PresentationWorkspace({
  document,
  slideId,
  workspaceId,
}: {
  document: PresentationDocument;
  slideId: string;
  workspaceId: string;
}) {
  const storeRef = useRef<PresentationStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = new PresentationStore(
      document,
      slideId,
      new HttpProjectTransport(),
      document.presentation.id,
    );
  }

  return <Workspace store={storeRef.current} workspaceId={workspaceId} />;
}

function Workspace({ store, workspaceId }: { store: PresentationStore; workspaceId: string }) {
  const snapshot = usePresentation(store);
  const webMcpAvailable = useWebMcp(store);
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const { slideId: routeSlideId } = useParams();
  const lastRouteSlideIdRef = useRef(routeSlideId);
  // One-shot history policy for the route projection effect. Never a slide id.
  const navigationPolicyRef = useRef<'push' | 'replace'>('replace');

  // --- Transient shell/view state (never canonical) --------------------------
  // Inspector intent starts as 'default' so SSR and the first client paint
  // match (desktop column). matchMedia only flips presentation: a fresh
  // narrow viewport settles closed; an explicit open/close survives resize.
  const [toolMode, setToolMode] = useState<ToolMode>('select');
  const [pendingShapeGeometry, setPendingShapeGeometry] = useState<ShapeGeometry>(DEFAULT_SHAPE_GEOMETRY);
  const [fitScale, setFitScale] = useState(1);
  const [inspectorIntent, setInspectorIntent] = useState<InspectorIntent>('default');
  const [drawer, setDrawer] = useState<DrawerKind | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuEpoch, setMenuEpoch] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | undefined>(undefined);

  const presenting = snapshot.session.presenting;
  const activeSlideId = snapshot.session.activeSlideId;
  const activeSlide = snapshot.presentation.slides[activeSlideId];
  const selectedIds = snapshot.session.selectedElementIds;

  const [wideViewport, setWideViewport] = useState(true);
  const inspectorRestoreRef = useRef<HTMLElement | null>(null);
  const overlayStateRef = useRef({ drawer, intent: inspectorIntent });
  overlayStateRef.current = { drawer, intent: inspectorIntent };
  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${INSPECTOR_INLINE_VIEWPORT - 1}px)`);
    const apply = (): void => {
      const next = viewportChangeTransition({
        drawer: overlayStateRef.current.drawer,
        intent: overlayStateRef.current.intent,
        wide: !media.matches,
      });
      setWideViewport(next.wideViewport);
      if (next.drawer !== overlayStateRef.current.drawer) {
        setDrawer(next.drawer);
      }
      if (next.dismissTransientMenus) {
        setPaletteOpen(false);
        setMenuOpen(false);
        setMenuEpoch((epoch) => epoch + 1);
      }
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  const { inspectorOpen, inspectorInline, inspectorOverlay } = deriveShellChrome({
    intent: inspectorIntent,
    presenting,
    wideViewport,
  });

  // Route is a projection of session.activeSlideId. Equality first so the
  // initial POP load is idle. A POP whose route id actually moved is inbound
  // (Back/Forward) and never creates an entry. Every other mismatch writes the
  // URL once: a consumed editor push intent becomes PUSH, otherwise REPLACE.
  useEffect(() => {
    const decision = decideSessionRoute({
      activeSlideId,
      routeSlideId,
      navigationType,
      routeMoved: routeSlideId !== lastRouteSlideIdRef.current,
      routeSlideExists: routeSlideId !== undefined && snapshot.presentation.slides[routeSlideId] !== undefined,
      pushEditorHistory: navigationPolicyRef.current === 'push',
    });
    lastRouteSlideIdRef.current = routeSlideId;
    navigationPolicyRef.current = 'replace';
    if (decision.kind === 'idle') {
      return;
    }
    if (decision.kind === 'inbound-pop') {
      store.selectSlide(decision.slideId);
      return;
    }
    navigate(presentationSlidePath(workspaceId, snapshot.presentation.id, activeSlideId), {
      replace: decision.replace,
    });
  }, [
    activeSlideId,
    navigate,
    navigationType,
    routeSlideId,
    snapshot.presentation,
    store,
    workspaceId,
  ]);

  // Render-time exclusivity is `!presenting` on the drawer/palette JSX and
  // overlay chrome. This effect only clears drawer/palette React state so
  // they do not return on exit. Inspector intent survives Present.
  useEffect(() => {
    if (!presenting) {
      return;
    }
    setDrawer(null);
    setPaletteOpen(false);
  }, [presenting]);

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

  function openEditorSlide(slideId: string, elementId?: string): void {
    const previousId = store.getSnapshot().session.activeSlideId;
    navigationPolicyRef.current = 'push';
    store.selectSlide(slideId);
    if (elementId) {
      store.selectElement(elementId);
    }
    if (store.getSnapshot().session.activeSlideId === previousId) {
      navigationPolicyRef.current = 'replace';
    }
  }

  async function addSlide(): Promise<void> {
    const result = await commandAddSlide(env);
    if (!result.ok) {
      notify(result.notice);
      return;
    }
    openEditorSlide(result.slideId);
  }

  async function addSlideAfter(slideId: string): Promise<void> {
    const result = await commandAddSlideAfter(env, slideId);
    if (!result.ok) {
      notify(result.notice);
      return;
    }
    openEditorSlide(result.slideId);
  }

  async function duplicateSlide(slideId?: string): Promise<void> {
    const targetSlideId = slideId ?? activeSlide.id;
    const result = await commandDuplicateSlide(env, targetSlideId);
    if (!result.ok) {
      notify(result.notice);
      return;
    }
    openEditorSlide(result.slideId);
  }

  async function deleteSlide(slideId?: string): Promise<void> {
    const targetSlideId = slideId ?? activeSlide.id;
    if (snapshot.presentation.slideOrder.length <= 1) {
      notify('The final slide cannot be deleted.');
      return;
    }
    const result = await commandDeleteSlide(env, targetSlideId);
    if (!result.ok) {
      notify(result.notice);
    }
  }

  // --- Selection commands ---------------------------------------------------------

  const selection = useMemo(() => deriveSelectionFlags(activeSlide, selectedIds), [activeSlide, selectedIds]);

  async function duplicateSelection(): Promise<void> {
    const result = await duplicateElements(env, selectedIds);
    if (!result.ok) {
      notify(result.notice);
      return;
    }
    store.selectElements(result.newIds);
  }

  async function deleteSelection(): Promise<void> {
    const result = await deleteElements(env, selectedIds);
    if (!result.ok) {
      notify(result.notice);
    }
  }

  async function alignSelection(alignment: Alignment): Promise<void> {
    const result = await alignElements(env, selectedIds, alignment);
    if (!result.ok) {
      notify(result.notice);
    }
  }

  async function reorderSelection(direction: ElementOrderDirection): Promise<void> {
    const result = await reorderElements(env, selectedIds, direction);
    if (!result.ok) {
      notify(result.notice);
    }
  }

  /** The single-selection style commit, read fresh against the current selection. */
  async function applyTextStyle(style: TextStyle): Promise<void> {
    const element = selection.singleUnlockedText;
    if (!element) {
      return;
    }
    const result = await updateTextStyle(env, element, style);
    if (!result.ok) {
      notify(result.notice);
    }
  }

  /** Registry menu creation: a canonical shape at the menu point, selected after creation. */
  async function addShapeElementAt(point?: { x: number; y: number }): Promise<void> {
    const result = await addShapeElement(env, point, pendingShapeGeometry);
    if (!result.ok) {
      notify(result.notice);
      return;
    }
    store.selectElement(result.elementId);
    setToolMode('select');
  }

  // --- Comments ---------------------------------------------------------------

  function openComment(comment: Comment): void {
    openEditorSlide(comment.slideId, comment.elementId);
    setDrawer(null);
  }

  async function resolveComment(comment: Comment): Promise<void> {
    const result = await store.dispatch({
      actorKind: 'human',
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

  async function addComment(body: string): Promise<boolean> {
    const comment: Comment = {
      id: crypto.randomUUID(),
      actor: { id: 'client', kind: 'human', name: DEMO_DISPLAY_NAME },
      body,
      createdAt: new Date().toISOString(),
      resolved: false,
      slideId: activeSlide.id,
    };
    const result = await store.dispatch({
      actorKind: 'human',
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

  async function revertAgentChange(changeSet: ChangeSet): Promise<void> {
    const reverted = await store.revertAgentChange(changeSet.id);
    notify(
      reverted
        ? 'The agent change set was reverted.'
        : 'The artifact changed after this proposal. Review it before reverting.',
    );
  }

  async function undoHumanChange(): Promise<void> {
    const undone = await store.undoLatestHumanChange();
    notify(undone ? 'Your latest change was undone.' : 'There is no safe human change to undo.');
  }

  async function redoHumanChange(): Promise<void> {
    const redone = await store.redoLatestHumanChange();
    notify(redone ? 'Your latest undone change was redone.' : 'There is no safe change to redo.');
  }

  async function renamePresentation(title: string, expectedTitle: string): Promise<void> {
    const result = await updatePresentationTitle(env, title, expectedTitle);
    if (!result.ok) {
      notify(result.notice);
    }
  }

  // --- Export ----------------------------------------------------------------------

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

  function dismissTransientMenus(): void {
    setPaletteOpen(false);
    setMenuOpen(false);
    setMenuEpoch((epoch) => epoch + 1);
  }

  function captureInspectorOpener(): HTMLElement | null {
    const active = document.activeElement;
    const kind = overlayOpenerFromMenuState({
      expandedMore: document.querySelector('[aria-label="More commands"][aria-expanded="true"]') !== null,
      expandedReview: document.querySelector('[aria-label="Review panels"][aria-expanded="true"]') !== null,
      fromMenu: document.querySelector('[role="menu"]') !== null,
    });
    if (kind === 'more') {
      return document.querySelector('[aria-label="More commands"]');
    }
    if (kind === 'review') {
      return document.querySelector('[aria-label="Review panels"]');
    }
    return active instanceof HTMLElement && active !== document.body ? active : null;
  }

  function closeInspector(): void {
    setInspectorIntent('closed');
  }

  function toggleInspector(): void {
    const next = toggleInspectorTransition({ drawer, inspectorOpen, wideViewport });
    if (next.intent === 'open') {
      inspectorRestoreRef.current = captureInspectorOpener();
    }
    setInspectorIntent(next.intent);
    if (next.drawer !== drawer) {
      setDrawer(next.drawer);
    }
    if (next.dismissTransientMenus) {
      dismissTransientMenus();
    }
  }

  function toggleDrawer(kind: DrawerKind): void {
    const next = toggleDrawerTransition({ drawer, kind, wideViewport });
    setDrawer(next.drawer);
    if (next.inspectorIntent !== undefined) {
      setInspectorIntent(next.inspectorIntent);
    }
    if (next.dismissTransientMenus) {
      dismissTransientMenus();
    }
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
   *
   * Canonical actions are async: they resolve after server acceptance and
   * never reject (failures surface through `notify`), and every mutation is
   * serialized at the store boundary, so the fire-and-forget invocation from
   * menu/keyboard surfaces is ordered and safe.
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
        toggleInspector,
        toggleDrawer,
        exportPptx: exportPresentation,
      },
    }),
    [
      activeSlide,
      env,
      inspectorOpen,
      inspectorIntent,
      notify,
      pendingShapeGeometry,
      primaryElement,
      selectedIds,
      selection,
      snapshot,
      store,
      toolMode,
      wideViewport,
      drawer,
      zoomPercent,
    ],
  );

  // --- Keyboard controller: one owner order. An editable target owns
  // ordinary editing keys (including Mod+K). Escape still closes a live
  // modal (Present, palette, drawer, inspector overlay). Every other
  // shortcut is the registry 'keys' surface, and only fires outside
  // editable targets. ---------------

  const keyboardRef = useRef({
    drawer: null as DrawerKind | null,
    inspectorOverlay: false,
    menuOpen: false,
    paletteOpen: false,
    presenting: false,
  });
  keyboardRef.current = { drawer, inspectorOverlay, menuOpen, paletteOpen, presenting };
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
      const kb = keyboardRef.current;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (event.key === 'Escape') {
        // Modal Escape is the one exception to editable ownership: Present,
        // the palette, and a right overlay still close — unless a dirty
        // inspector field already consumed the event (preventDefault).
        if (kb.presenting) {
          event.preventDefault();
          store.controlPresentation({ action: 'exit' });
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
        if (kb.inspectorOverlay) {
          event.preventDefault();
          setInspectorIntent('closed');
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

      // The palette is a shell surface, not a command. Non-editable
      // targets toggle it except underneath Present or a context menu.
      if (mod && key === 'k') {
        event.preventDefault();
        if (!kb.presenting && !kb.menuOpen) {
          setPaletteOpen((current) => !current);
        }
        return;
      }

      // Modals and transient owners suppress the registry shortcuts: open
      // menus, the palette, drawers, the inspector overlay, and Present mode
      // own their keys.
      if (kb.presenting || kb.paletteOpen || kb.drawer || kb.inspectorOverlay || kb.menuOpen) {
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
    <TooltipProvider>
      <main className="editor-app">
      <EditorHeader
        activeDrawer={drawer}
        canExport
        menuEpoch={menuEpoch}
        onExport={exportPresentation}
        onOpenDrawer={ctx.actions.toggleDrawer}
        onPresent={() => store.controlPresentation({ action: 'start' })}
        onRenamePresentation={renamePresentation}
        openCommentCount={openCommentCount}
        pendingAgentChanges={pendingAgentChanges}
        snapshot={snapshot}
        webMcpAvailable={webMcpAvailable}
        workspaceId={workspaceId}
      />
      <CommandBar
        ctx={ctx}
        menuEpoch={menuEpoch}
        onPendingShapeGeometryChange={setPendingShapeGeometry}
        pendingShapeGeometry={pendingShapeGeometry}
      />

      <div className="editor-shell">
        <div className="editor-main">
        <SlideRail ctx={ctx} onOpenSlide={openEditorSlide} />
        <section aria-label="Canvas" className="canvas-column">
          <CanvasStage
            ctx={ctx}
            keyboardEnabled={!paletteOpen && !drawer && !inspectorOverlay && !presenting && !menuOpen}
            menuOpen={menuOpen}
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
        </div>
        {inspectorOpen && (inspectorInline || !presenting) ? (
          <InspectorFrame
            onClose={closeInspector}
            overlay={inspectorOverlay}
            restoreFocusRef={inspectorRestoreRef}
          >
            <InspectorPanel
              notify={notify}
              onClose={inspectorOverlay ? closeInspector : undefined}
              primaryId={primaryId}
              selectedIds={selectedIds}
              slideId={activeSlide.id}
              snapshot={snapshot}
              store={store}
            />
          </InspectorFrame>
        ) : null}
      </div>

      <EditorStatusBar
        revision={snapshot.presentation.revision}
        selectedCount={selectedIds.length}
        slideCount={snapshot.presentation.slideOrder.length}
        slideName={slideDisplayName(activeSlide)}
        slideNumber={snapshot.presentation.slideOrder.indexOf(activeSlide.id) + 1}
      />

      {!presenting && drawer === 'agent' ? (
        <PanelDrawer onClose={() => setDrawer(null)} title="Agent">
          <AgentPanel
            onRevertAgentChange={revertAgentChange}
            snapshot={snapshot}
            webMcpAvailable={webMcpAvailable}
          />
        </PanelDrawer>
      ) : null}
      {!presenting && drawer === 'comments' ? (
        <PanelDrawer onClose={() => setDrawer(null)} title="Comments">
          <CommentsPanel
            onAddComment={addComment}
            onOpenComment={openComment}
            onResolveComment={resolveComment}
            snapshot={snapshot}
          />
        </PanelDrawer>
      ) : null}
      {!presenting && drawer === 'activity' ? (
        <PanelDrawer onClose={() => setDrawer(null)} title="Activity">
          <ActivityPanel onRevertAgentChange={revertAgentChange} snapshot={snapshot} />
        </PanelDrawer>
      ) : null}

      <CommandPalette ctx={ctx} onClose={() => setPaletteOpen(false)} open={!presenting && paletteOpen} />

      {presenting ? <PresentMode snapshot={snapshot} store={store} /> : null}

      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
      </main>
    </TooltipProvider>
  );
}