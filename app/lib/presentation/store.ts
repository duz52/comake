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
interface DocumentSession {
  activeSlideId: string;
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
    this.snapshot = {
      ...this.snapshot,
      session: {
        activeSlideId: slideId,
        selectedElementId: undefined,
      },
    };
    this.emit();
  }

  public selectElement(elementId?: string): void {
    this.snapshot = {
      ...this.snapshot,
      session: {
        ...this.snapshot.session,
        selectedElementId: elementId,
      },
    };
    this.emit();
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
      session: this.snapshot.session,
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

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function createInitialSnapshot(): PresentationSnapshot {
  const document = createInitialPresentationDocument();
  return {
    ...document,
    session: {
      activeSlideId: LAUNCH_DECK_INITIAL_SLIDE_ID,
    },
    userUndoStack: [],
  };
}