import { systemActor } from './actors';
import { LAUNCH_DECK_INITIAL_SLIDE_ID } from './deck';
import {
  createInitialPresentationDocument,
  dispatchPresentationDocument,
  type DispatchRequest,
  type DispatchResult,
  type PresentationDocument,
} from './document';

/** Client-local view state. Never enters ChangeSets or the canonical model. */
export interface DocumentSession {
  activeSlideId: string;
  /** Monotonic version of the human focus: increments only when the active slide or the selected element changes. */
  focusRevision: number;
  selectedElementId?: string;
}

export interface PresentationSnapshot extends PresentationDocument {
  session: DocumentSession;
  userUndoStack: string[];
}

/**
 * Browser store: a session/view controller around the pure command kernel in
 * `./document`. It owns UI-only state (session, human undo stack, listeners)
 * and projects snapshots; every canonical mutation is delegated to the kernel,
 * which is the single owner of the document algorithm.
 */
export class PresentationStore {
  private listeners = new Set<() => void>();
  private snapshot = createInitialSnapshot();

  public getSnapshot = (): PresentationSnapshot => this.snapshot;

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public selectSlide(slideId: string): void {
    if (!this.snapshot.presentation.slides[slideId]) {
      return;
    }
    const session = this.snapshot.session;
    if (slideId === session.activeSlideId && session.selectedElementId === undefined) {
      return;
    }
    // A slide change always clears the selection and advances the focus revision.
    this.applySession({
      activeSlideId: slideId,
      focusRevision: session.focusRevision + 1,
    });
  }

  public selectElement(elementId?: string): void {
    const session = this.snapshot.session;
    if (session.selectedElementId === elementId) {
      return;
    }
    // The selection must name an element that exists on the active slide; a
    // stale or foreign id is a no-op that keeps the current selection intact.
    if (elementId !== undefined && !this.snapshot.presentation.slides[session.activeSlideId].elements[elementId]) {
      return;
    }
    this.applySession({
      ...session,
      selectedElementId: elementId,
      focusRevision: session.focusRevision + 1,
    });
  }

  public dispatch(request: DispatchRequest, recordInUserUndo = request.actor.kind === 'human'): DispatchResult {
    const result = dispatchPresentationDocument(this.snapshot, request);
    if (!result.ok) {
      return result;
    }

    const userUndoStack = recordInUserUndo
      ? [...this.snapshot.userUndoStack, result.changeSet.id]
      : this.snapshot.userUndoStack;
    this.snapshot = {
      ...result.document,
      // Re-derive the focus against the new canonical document so the session never keeps a dangling selection.
      session: sessionAfterDispatch(result.document, this.snapshot.session),
      // Keep the undo stack consistent with the kernel's bounded changeset window.
      userUndoStack: userUndoStack.filter((changeSetId) => changeSetId in result.document.changeSets),
    };
    this.emit();
    return result;
  }

  public undoLatestHumanChange(): boolean {
    const changeSetId = this.snapshot.userUndoStack.at(-1);
    if (!changeSetId) {
      return false;
    }

    const changeSet = this.snapshot.changeSets[changeSetId];
    if (!changeSet || changeSet.revertedAt) {
      return false;
    }

    const result = this.revertChangeSet(changeSetId, `Undid ${changeSet.label}`);
    if (!result) {
      return false;
    }

    this.snapshot = {
      ...this.snapshot,
      userUndoStack: this.snapshot.userUndoStack.slice(0, -1),
    };
    this.emit();
    return true;
  }

  public revertAgentChange(changeSetId: string): boolean {
    const changeSet = this.snapshot.changeSets[changeSetId];
    if (!changeSet || changeSet.actor.kind !== 'agent' || changeSet.revertedAt) {
      return false;
    }

    return this.revertChangeSet(changeSetId, `Reverted ${changeSet.label}`);
  }

  private revertChangeSet(changeSetId: string, label: string): boolean {
    const target = this.snapshot.changeSets[changeSetId];
    if (!target) {
      return false;
    }

    const result = this.dispatch(
      {
        actor: systemActor,
        label,
        operations: target.inverseOperations,
      },
      false,
    );
    if (!result.ok) {
      return false;
    }

    const currentTarget = this.snapshot.changeSets[changeSetId];
    if (!currentTarget) {
      return false;
    }

    this.snapshot = {
      ...this.snapshot,
      changeSets: {
        ...this.snapshot.changeSets,
        [changeSetId]: {
          ...currentTarget,
          revertedAt: new Date().toISOString(),
        },
      },
    };
    this.emit();
    return true;
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

/**
 * Re-derive the session against the post-dispatch canonical document: when the
 * selected element no longer exists on the active slide, drop the selection
 * and advance the focus revision so the session can never expose a dangling
 * selection.
 */
function sessionAfterDispatch(document: PresentationDocument, session: DocumentSession): DocumentSession {
  const { activeSlideId, selectedElementId } = session;
  if (selectedElementId === undefined) {
    return session;
  }
  const activeSlide = document.presentation.slides[activeSlideId];
  if (activeSlide.elements[selectedElementId]) {
    return session;
  }
  return { activeSlideId, focusRevision: session.focusRevision + 1 };
}

function createInitialSnapshot(): PresentationSnapshot {
  const document = createInitialPresentationDocument();
  return {
    ...document,
    session: {
      activeSlideId: LAUNCH_DECK_INITIAL_SLIDE_ID,
      focusRevision: 0,
    },
    userUndoStack: [],
  };
}