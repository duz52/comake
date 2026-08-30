import {
  createLaunchDeck,
  type Actor,
  type ChangeSet,
  type Comment,
  type Frame,
  type Presentation,
  type PresentationElement,
  type PresentationOperation,
} from './model';

export const actors = {
  agent: { id: 'gpt', kind: 'agent', name: 'GPT' },
  human: { id: 'jerry', kind: 'human', name: 'Jerry' },
  system: { id: 'system', kind: 'system', name: 'Comake' },
} as const satisfies Record<string, Actor>;

interface DocumentSession {
  activeSlideId: string;
  selectedElementId?: string;
}

export interface PresentationSnapshot {
  changeSetOrder: string[];
  changeSets: Record<string, ChangeSet>;
  comments: Record<string, Comment>;
  presentation: Presentation;
  session: DocumentSession;
  userUndoStack: string[];
}

export interface DispatchRequest {
  actor: Actor;
  label: string;
  operations: PresentationOperation[];
}

export type DispatchResult =
  | { changeSet: ChangeSet; ok: true }
  | { ok: false };

const MAX_CHANGESETS = 36;

function cloneFrame(frame: Frame): Frame {
  return { ...frame };
}

function frameMatches(left: Frame, right: Frame): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function elementMatches(left: PresentationElement, right: PresentationElement): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function commentMatches(left: Comment, right: Comment): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function updateSlide(
  presentation: Presentation,
  slideId: string,
  update: (slide: Presentation['slides'][string]) => Presentation['slides'][string],
): Presentation | undefined {
  const currentSlide = presentation.slides[slideId];
  if (!currentSlide) {
    return undefined;
  }

  const nextSlide = update(currentSlide);
  return {
    ...presentation,
    slides: {
      ...presentation.slides,
      [slideId]: nextSlide,
    },
  };
}

function applyOperation(
  snapshot: PresentationSnapshot,
  operation: PresentationOperation,
): { inverse: PresentationOperation; snapshot: PresentationSnapshot } | undefined {
  switch (operation.type) {
    case 'update_text': {
      const currentSlide = snapshot.presentation.slides[operation.slideId];
      const currentElement = currentSlide?.elements[operation.elementId];
      if (
        !currentSlide ||
        !currentElement ||
        currentElement.kind !== 'text' ||
        (operation.expectedText !== undefined && currentElement.text !== operation.expectedText)
      ) {
        return undefined;
      }

      const nextPresentation = updateSlide(snapshot.presentation, operation.slideId, (slide) => ({
        ...slide,
        elements: {
          ...slide.elements,
          [operation.elementId]: {
            ...currentElement,
            text: operation.text,
          },
        },
      }));

      if (!nextPresentation) {
        return undefined;
      }

      return {
        inverse: {
          type: 'update_text',
          slideId: operation.slideId,
          elementId: operation.elementId,
          text: currentElement.text,
          expectedText: operation.text,
        },
        snapshot: {
          ...snapshot,
          presentation: nextPresentation,
        },
      };
    }

    case 'update_frame': {
      const currentSlide = snapshot.presentation.slides[operation.slideId];
      const currentElement = currentSlide?.elements[operation.elementId];
      if (
        !currentSlide ||
        !currentElement ||
        currentElement.locked ||
        (operation.expectedFrame !== undefined && !frameMatches(currentElement.frame, operation.expectedFrame))
      ) {
        return undefined;
      }

      const nextPresentation = updateSlide(snapshot.presentation, operation.slideId, (slide) => ({
        ...slide,
        elements: {
          ...slide.elements,
          [operation.elementId]: {
            ...currentElement,
            frame: cloneFrame(operation.frame),
          },
        },
      }));

      if (!nextPresentation) {
        return undefined;
      }

      return {
        inverse: {
          type: 'update_frame',
          slideId: operation.slideId,
          elementId: operation.elementId,
          frame: cloneFrame(currentElement.frame),
          expectedFrame: cloneFrame(operation.frame),
        },
        snapshot: {
          ...snapshot,
          presentation: nextPresentation,
        },
      };
    }

    case 'create_element': {
      const currentSlide = snapshot.presentation.slides[operation.slideId];
      if (!currentSlide || currentSlide.elements[operation.element.id]) {
        return undefined;
      }

      const nextPresentation = updateSlide(snapshot.presentation, operation.slideId, (slide) => ({
        ...slide,
        elementOrder: [...slide.elementOrder, operation.element.id],
        elements: {
          ...slide.elements,
          [operation.element.id]: operation.element,
        },
      }));

      if (!nextPresentation) {
        return undefined;
      }

      return {
        inverse: {
          type: 'delete_element',
          slideId: operation.slideId,
          elementId: operation.element.id,
          expectedElement: operation.element,
        },
        snapshot: {
          ...snapshot,
          presentation: nextPresentation,
        },
      };
    }

    case 'delete_element': {
      const currentSlide = snapshot.presentation.slides[operation.slideId];
      const currentElement = currentSlide?.elements[operation.elementId];
      if (
        !currentSlide ||
        !currentElement ||
        currentElement.locked ||
        (operation.expectedElement !== undefined && !elementMatches(currentElement, operation.expectedElement))
      ) {
        return undefined;
      }

      const nextPresentation = updateSlide(snapshot.presentation, operation.slideId, (slide) => {
        const { [operation.elementId]: removedElement, ...remainingElements } = slide.elements;
        void removedElement;
        return {
          ...slide,
          elementOrder: slide.elementOrder.filter((id) => id !== operation.elementId),
          elements: remainingElements,
        };
      });

      if (!nextPresentation) {
        return undefined;
      }

      return {
        inverse: {
          type: 'create_element',
          slideId: operation.slideId,
          element: currentElement,
        },
        snapshot: {
          ...snapshot,
          presentation: nextPresentation,
        },
      };
    }

    case 'add_comment': {
      if (snapshot.comments[operation.comment.id]) {
        return undefined;
      }

      return {
        inverse: {
          type: 'remove_comment',
          commentId: operation.comment.id,
          expectedComment: operation.comment,
        },
        snapshot: {
          ...snapshot,
          comments: {
            ...snapshot.comments,
            [operation.comment.id]: operation.comment,
          },
        },
      };
    }

    case 'remove_comment': {
      const currentComment = snapshot.comments[operation.commentId];
      if (
        !currentComment ||
        (operation.expectedComment !== undefined && !commentMatches(currentComment, operation.expectedComment))
      ) {
        return undefined;
      }

      const { [operation.commentId]: removedComment, ...remainingComments } = snapshot.comments;
      void removedComment;
      return {
        inverse: {
          type: 'add_comment',
          comment: currentComment,
        },
        snapshot: {
          ...snapshot,
          comments: remainingComments,
        },
      };
    }
  }
}

function applyOperations(
  snapshot: PresentationSnapshot,
  operations: PresentationOperation[],
): { inverseOperations: PresentationOperation[]; snapshot: PresentationSnapshot } | undefined {
  let workingSnapshot = snapshot;
  const inverseOperations: PresentationOperation[] = [];

  for (const operation of operations) {
    const result = applyOperation(workingSnapshot, operation);
    if (!result) {
      return undefined;
    }
    workingSnapshot = result.snapshot;
    inverseOperations.unshift(result.inverse);
  }

  return { snapshot: workingSnapshot, inverseOperations };
}

function createInitialSnapshot(): PresentationSnapshot {
  const presentation = createLaunchDeck();
  return {
    presentation,
    comments: {},
    changeSets: {},
    changeSetOrder: [],
    session: {
      activeSlideId: presentation.slideOrder[2],
    },
    userUndoStack: [],
  };
}

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
    if (request.operations.length === 0) {
      return { ok: false };
    }

    const result = applyOperations(this.snapshot, request.operations);
    if (!result) {
      return { ok: false };
    }

    const revision = this.snapshot.presentation.revision + 1;
    const changeSet: ChangeSet = {
      id: crypto.randomUUID(),
      actor: request.actor,
      label: request.label,
      operations: request.operations,
      inverseOperations: result.inverseOperations,
      revision,
      createdAt: new Date().toISOString(),
    };
    const changeSetOrder = [...result.snapshot.changeSetOrder, changeSet.id];
    const changeSets = {
      ...result.snapshot.changeSets,
      [changeSet.id]: changeSet,
    };
    const userUndoStack = recordInUserUndo
      ? [...result.snapshot.userUndoStack, changeSet.id]
      : result.snapshot.userUndoStack;

    this.snapshot = this.trimChangeSets({
      ...result.snapshot,
      presentation: {
        ...result.snapshot.presentation,
        revision,
      },
      changeSetOrder,
      changeSets,
      userUndoStack,
    });
    this.emit();
    return { ok: true, changeSet };
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
        actor: actors.system,
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

  private trimChangeSets(snapshot: PresentationSnapshot): PresentationSnapshot {
    if (snapshot.changeSetOrder.length <= MAX_CHANGESETS) {
      return snapshot;
    }

    const retainedOrder = snapshot.changeSetOrder.slice(-MAX_CHANGESETS);
    const retainedIds = new Set(retainedOrder);
    const retainedChangeSets = Object.fromEntries(
      retainedOrder.map((id) => [id, snapshot.changeSets[id]]),
    );
    return {
      ...snapshot,
      changeSetOrder: retainedOrder,
      changeSets: retainedChangeSets,
      userUndoStack: snapshot.userUndoStack.filter((id) => retainedIds.has(id)),
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
