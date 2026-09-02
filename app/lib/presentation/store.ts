import type { ChangeSet, Presentation } from '../../types/presentation';
import type { ClientDispatchRequest } from './attribution';
import type { DispatchFailure, DispatchResult, PresentationDocument } from './document';
import type { ProjectTransport } from './transport';

/** Session zoom bounds in scale factor (1 = 100%); view state, never canonical. */
export const MIN_SESSION_ZOOM = 0.1;
export const MAX_SESSION_ZOOM = 4;

/** Client-local view state. Never enters ChangeSets or the canonical model. */
export interface DocumentSession {
  activeSlideId: string;
  /** Monotonic version of the human focus: increments only when the active slide or the element selection actually changes. */
  focusRevision: number;
  /** Ids of the elements selected on the active slide; a set (no duplicates, all present on the active slide). */
  selectedElementIds: string[];
  /** View scale of the canvas; bounded and finite. */
  zoom: number;
}

export interface PresentationSnapshot extends PresentationDocument {
  session: DocumentSession;
  userUndoStack: string[];
  /** Human changes that were undone and stay safely replayable as forward intents. */
  userRedoStack: string[];
}

export type TransportFailure = { code: 'TRANSPORT_ERROR'; detail: string };

/**
 * The store dispatch result: the kernel result plus one honest transport
 * failure (the server was not reached or answered abnormally). A result is
 * `ok` only after the canonical server accepted it.
 */
export type StoreDispatchResult =
  | { changeSet: ChangeSet; document: PresentationDocument; ok: true }
  | { failure: DispatchFailure | TransportFailure; ok: false };

/** Same membership, order-insensitive: the selection compares as a set. */
function sameIdSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
}

/**
 * Outcome of a revert attempt. `permanent` distinguishes a semantically
 * permanent inverse rejection — the candidate can never succeed — from a
 * transient one (a stale revision or a transport failure), where a later
 * retry may succeed.
 */
type RevertOutcome = { ok: true } | { ok: false; permanent: boolean };

/**
 * Browser store: an ephemeral mirror + session owner around the canonical
 * project server. It owns UI-only state (session, human undo stack,
 * listeners) and projects snapshots; the canonical document lives in the
 * session WorkspaceRoom, reached exclusively through the injected {@link ProjectTransport}.
 *
 * Every canonical mutation is serialized at this boundary: concurrent
 * `dispatch`/undo/redo/revert calls run strictly in call order, each reading
 * the mirror that reflects every previously accepted mutation, so no call can
 * silently reorder against a stale snapshot. An accepted response replaces
 * the mirror with the authoritative document and re-derives the session
 * exactly once; a stale failure triggers exactly one canonical read to
 * refresh the mirror and never retries the intent.
 */
export class PresentationStore {
  private listeners = new Set<() => void>();
  private snapshot: PresentationSnapshot;
  private readonly projectId: string;
  private readonly transport: ProjectTransport;
  /** Serialization tail: every canonical mutation runs after the previous one settled. */
  private tail: Promise<void> = Promise.resolve();

  constructor(
    document: PresentationDocument,
    initialSlideId: string,
    transport: ProjectTransport,
    projectId: string,
  ) {
    this.transport = transport;
    this.projectId = projectId;
    this.snapshot = {
      ...document,
      session: {
        activeSlideId: initialSlideId,
        focusRevision: 0,
        selectedElementIds: [],
        zoom: 1,
      },
      userUndoStack: [],
      userRedoStack: [],
    };
  }

  public getSnapshot = (): PresentationSnapshot => this.snapshot;

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  // --- Session-only operations (synchronous browser state, never canonical) ---

  public selectSlide(slideId: string): void {
    const session = this.snapshot.session;
    if (!this.snapshot.presentation.slides[slideId]) {
      return;
    }
    if (slideId === session.activeSlideId && session.selectedElementIds.length === 0) {
      return;
    }
    // A slide change always clears the selection and advances the focus revision.
    this.applySession({
      activeSlideId: slideId,
      focusRevision: session.focusRevision + 1,
      selectedElementIds: [],
      zoom: session.zoom,
    });
  }

  /** Single selection: exactly one element, or none when the id is omitted. */
  public selectElement(elementId?: string): void {
    if (elementId === undefined) {
      this.replaceSelection([]);
      return;
    }
    if (!this.activeSlideElements()[elementId]) {
      return;
    }
    this.replaceSelection([elementId]);
  }

  /** Add an element to, or remove it from, the selection. */
  public toggleElementSelection(elementId: string): void {
    if (!this.activeSlideElements()[elementId]) {
      return;
    }
    const session = this.snapshot.session;
    const next = session.selectedElementIds.includes(elementId)
      ? session.selectedElementIds.filter((id) => id !== elementId)
      : [...session.selectedElementIds, elementId];
    this.replaceSelection(next);
  }

  /** Replace the selection with many elements; unknown and duplicate ids are dropped. */
  public selectElements(elementIds: string[]): void {
    const elements = this.activeSlideElements();
    const selected = [...new Set(elementIds)].filter((id) => id in elements);
    this.replaceSelection(selected);
  }

  public clearSelection(): void {
    this.replaceSelection([]);
  }

  /** Set the session zoom; non-finite values are ignored, values outside the bounds are clamped. */
  public setZoom(zoom: number): void {
    if (!Number.isFinite(zoom)) {
      return;
    }
    const bounded = Math.min(MAX_SESSION_ZOOM, Math.max(MIN_SESSION_ZOOM, zoom));
    if (bounded === this.snapshot.session.zoom) {
      return;
    }
    this.applySession({ ...this.snapshot.session, zoom: bounded });
  }

  /** Select every unlocked element of the active slide. */
  public selectAll(): void {
    const elements = this.activeSlideElements();
    this.replaceSelection(
      Object.keys(elements).filter((elementId) => elements[elementId].locked !== true),
    );
  }

  // --- Canonical mutations (async, serialized, server-accepted only) ----------

  /**
   * One attributed canonical mutation. `baseRevision` is taken from the
   * request when the contract supplies one (agent writes); human writes
   * always carry the store's current authoritative revision. Returns only
   * after the server accepted or rejected; a rejected intent is never
   * retried here.
   */
  public dispatch(request: ClientDispatchRequest, recordInUserUndo = request.actorKind === 'human'): Promise<StoreDispatchResult> {
    return this.enqueue(() => this.performDispatch(request, recordInUserUndo));
  }

  /**
   * Undo the latest human change by reverting its inverse operations through
   * the server. The undo and redo stacks change only after acceptance.
   */
  public undoLatestHumanChange(): Promise<boolean> {
    return this.enqueue(async () => {
      const changeSetId = this.snapshot.userUndoStack.at(-1);
      if (!changeSetId) {
        return false;
      }

      const changeSet = this.snapshot.changeSets[changeSetId];
      if (!changeSet || changeSet.revertedAt) {
        // A stale or already-reverted top entry can never be undone; drop
        // exactly this entry so the next invocation reaches the next candidate.
        this.popUserUndoEntry();
        return false;
      }

      const revert = await this.revertChangeSet(changeSetId, `Undid ${changeSet.label}`);
      if (!revert.ok) {
        if (revert.permanent) {
          // The inverse is permanently rejected, so the candidate is dead: drop
          // it (without marking it reverted) instead of blocking the safe
          // entries below. A transient failure keeps the candidate for a retry.
          this.popUserUndoEntry();
        }
        return false;
      }

      // The revert dispatch prunes trimmed changesets from the stack, so the
      // target is still the top entry only when it survived the trim.
      if (this.snapshot.userUndoStack.at(-1) === changeSetId) {
        this.popUserUndoEntry();
      }
      // Mirror the undo into the redo stack: the reverted change set now holds
      // the safely replayable forward intent. Trimming may have removed it,
      // which the membership filter below makes a no-op.
      this.snapshot = {
        ...this.snapshot,
        userRedoStack: [...this.snapshot.userRedoStack, changeSetId].filter(
          (id) => id in this.snapshot.changeSets,
        ),
      };
      this.emit();
      return true;
    });
  }

  /**
   * Redo the latest undone human change by replaying its original forward
   * operations. The operations carry the optimistic guards they were read
   * with; after the paired undo the state matches those guards exactly, so
   * the replay applies cleanly — and any interleaved mutation makes the
   * guards fail, so a stale intent is rejected, never silently replayed.
   */
  public redoLatestHumanChange(): Promise<boolean> {
    return this.enqueue(async () => {
      const changeSetId = this.snapshot.userRedoStack.at(-1);
      if (!changeSetId) {
        return false;
      }
      const changeSet = this.snapshot.changeSets[changeSetId];
      if (!changeSet) {
        // A trimmed candidate can never be replayed; drop it so the next
        // invocation reaches the next candidate.
        this.popUserRedoEntry();
        return false;
      }

      // The dispatch below clears the redo stack (any human mutation does);
      // capture the deeper candidates first so they survive this replay.
      const remaining = this.snapshot.userRedoStack.slice(0, -1);
      const result = await this.performDispatch(
        {
          actorKind: 'human',
          label: `Redid ${changeSet.label}`,
          operations: changeSet.operations,
        },
        true,
      );
      if (!result.ok) {
        // The current state does not hold the guards of the recorded forward
        // intent; the candidate is dead against it and must not block the
        // candidates below.
        this.popUserRedoEntry();
        return false;
      }
      this.snapshot = {
        ...this.snapshot,
        userRedoStack: remaining.filter((id) => id in this.snapshot.changeSets),
      };
      this.emit();
      return true;
    });
  }

  /** Revert one agent change set through the server; stacks change only after acceptance. */
  public revertAgentChange(changeSetId: string): Promise<boolean> {
    return this.enqueue(async () => {
      const changeSet = this.snapshot.changeSets[changeSetId];
      if (!changeSet || changeSet.actor.kind !== 'agent' || changeSet.revertedAt) {
        return false;
      }

      return (await this.revertChangeSet(changeSetId, `Reverted ${changeSet.label}`)).ok;
    });
  }

  private activeSlideElements(): Presentation['slides'][string]['elements'] {
    return this.snapshot.presentation.slides[this.snapshot.session.activeSlideId].elements;
  }

  /** Run one canonical mutation strictly after every previously enqueued one. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.tail.then(operation, operation);
    // A mutation's own promise rejection must never poison the chain; every
    // public mutation already resolves with a typed result, and this keeps the
    // invariant even if a future operation misbehaves.
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async performDispatch(
    request: ClientDispatchRequest,
    recordInUserUndo: boolean,
  ): Promise<StoreDispatchResult> {
    const envelope: ClientDispatchRequest =
      request.baseRevision === undefined
        ? { ...request, baseRevision: this.snapshot.presentation.revision }
        : request;

    let result: DispatchResult;
    try {
      result = await this.transport.dispatch(this.projectId, envelope);
    } catch (error) {
      return {
        ok: false,
        failure: { code: 'TRANSPORT_ERROR', detail: transportFailureDetail(error) },
      };
    }

    if (!result.ok) {
      if (result.failure.code === 'STALE_REVISION') {
        // Exactly one canonical read refreshes the mirror; the intent is never
        // retried and the original structured stale failure is returned as-is.
        try {
          const document = await this.transport.readDocument(this.projectId);
          if (document) {
            this.replaceDocument(document);
          }
        } catch (error) {
          // The refresh itself failed; the mirror stays authoritative-read and
          // the next mutation retries against it. Logged, never surfaced raw.
          console.error('[presentation-store] stale-dispatch refresh failed:', error);
        }
      }
      return result;
    }

    this.applyAccepted(result, recordInUserUndo);
    return result;
  }

  /** An accepted server result replaces the mirror and re-derives the session exactly once. */
  private applyAccepted(result: Extract<DispatchResult, { ok: true }>, recordInUserUndo: boolean): void {
    const userUndoStack = recordInUserUndo
      ? [...this.snapshot.userUndoStack, result.changeSet.id]
      : this.snapshot.userUndoStack;
    this.snapshot = {
      ...result.document,
      // Re-derive the focus against the new canonical document, using the
      // pre-dispatch presentation only to locate a deleted active slide, so
      // the session never keeps a dangling slide or selection.
      session: sessionAfterDispatch(result.document, this.snapshot.presentation, this.snapshot.session),
      // A new human mutation invalidates every recorded redo path; the redo
      // command itself restores the deeper candidates it superseded.
      userRedoStack: recordInUserUndo ? [] : this.snapshot.userRedoStack,
      // Keep the undo stack consistent with the kernel's bounded changeset window.
      userUndoStack: userUndoStack.filter((changeSetId) => changeSetId in result.document.changeSets),
    };
    this.emit();
  }

  /** A canonical read replaces the mirror; session and stacks stay valid against it. */
  private replaceDocument(document: PresentationDocument): void {
    this.snapshot = {
      ...document,
      session: sessionAfterDispatch(document, this.snapshot.presentation, this.snapshot.session),
      userUndoStack: this.snapshot.userUndoStack.filter((changeSetId) => changeSetId in document.changeSets),
      userRedoStack: this.snapshot.userRedoStack.filter((changeSetId) => changeSetId in document.changeSets),
    };
    this.emit();
  }

  /** Apply the inverse operations of one change set as a canonical revert. */
  private async revertChangeSet(changeSetId: string, label: string): Promise<RevertOutcome> {
    const target = this.snapshot.changeSets[changeSetId];
    if (!target) {
      return { ok: false, permanent: true };
    }

    const result = await this.performDispatch(
      {
        actorKind: 'human',
        label,
        operations: target.inverseOperations,
        revertsChangeSetId: changeSetId,
      },
      false,
    );
    if (!result.ok) {
      // A stale revision or a transport failure is transient — a retry may
      // succeed. Every other rejection is semantically permanent for this
      // candidate.
      return {
        ok: false,
        permanent: result.failure.code !== 'STALE_REVISION' && result.failure.code !== 'TRANSPORT_ERROR',
      };
    }
    return { ok: true };
  }

  /**
   * Apply a new selection on the active slide. The focus revision advances
   * exactly once, and only when the selection membership actually changes.
   */
  private replaceSelection(selectedElementIds: string[]): void {
    const session = this.snapshot.session;
    if (sameIdSet(session.selectedElementIds, selectedElementIds)) {
      return;
    }
    this.applySession({
      ...session,
      selectedElementIds,
      focusRevision: session.focusRevision + 1,
    });
  }

  /** Pop the top user-undo entry and notify listeners. */
  private popUserUndoEntry(): void {
    this.snapshot = {
      ...this.snapshot,
      userUndoStack: this.snapshot.userUndoStack.slice(0, -1),
    };
    this.emit();
  }

  /** Pop the top user-redo entry and notify listeners. */
  private popUserRedoEntry(): void {
    this.snapshot = {
      ...this.snapshot,
      userRedoStack: this.snapshot.userRedoStack.slice(0, -1),
    };
    this.emit();
  }

  private applySession(session: DocumentSession): void {
    this.snapshot = { ...this.snapshot, session };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function transportFailureDetail(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'The presentation server could not be reached. Please try again.';
}

/**
 * Re-derive the session against a new canonical document. The pre-replacement
 * presentation is used only for deriving UI focus (the former neighbors of a
 * deleted active slide); it never enters the canonical model.
 *
 * When the active slide remains, the selection is pruned to the elements that
 * still exist on it. When the active slide was deleted, focus moves to the
 * first slide after it in the former order that survived, to the nearest
 * surviving predecessor if none did, or — when a batch replaced every
 * formerly existing slide — to the first canonical post-replacement slide;
 * the selection is cleared either way. A dropped selection or moved focus
 * advances the focus revision exactly once so the session can never expose a
 * dangling slide or selection.
 */
function sessionAfterDispatch(
  document: PresentationDocument,
  previousPresentation: Presentation,
  session: DocumentSession,
): DocumentSession {
  const { activeSlideId, selectedElementIds } = session;
  const activeSlide = document.presentation.slides[activeSlideId];
  if (activeSlide) {
    const survivingSelection = selectedElementIds.filter((elementId) => elementId in activeSlide.elements);
    if (survivingSelection.length === selectedElementIds.length) {
      return session;
    }
    return {
      activeSlideId,
      selectedElementIds: survivingSelection,
      focusRevision: session.focusRevision + 1,
      zoom: session.zoom,
    };
  }

  const formerIndex = previousPresentation.slideOrder.indexOf(activeSlideId);
  const formerSlideOrder = previousPresentation.slideOrder;
  const survivingSlides = document.presentation.slides;
  // Identity-based successor: the nearest slide after the former active slide
  // that survived, else the nearest surviving predecessor, else the first
  // canonical slide when the whole former deck was replaced. The kernel
  // guarantees a non-empty slide order, so `successorId` is always defined.
  const successorId =
    formerSlideOrder.slice(formerIndex + 1).find((slideId) => slideId in survivingSlides) ??
    formerSlideOrder.slice(0, formerIndex).reverse().find((slideId) => slideId in survivingSlides) ??
    document.presentation.slideOrder[0];
  return {
    activeSlideId: successorId,
    selectedElementIds: [],
    focusRevision: session.focusRevision + 1,
    zoom: session.zoom,
  };
}