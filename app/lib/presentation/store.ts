import { actorMatches, systemActor } from './actors';
import { createLaunchDeck, LAUNCH_DECK_INITIAL_SLIDE_ID } from './deck';
import type {
  Actor,
  ChangeSet,
  Comment,
  Frame,
  Presentation,
  PresentationElement,
  PresentationOperation,
  ShapeElement,
  Slide,
  TextElement,
  TextStyle,
} from '../../types/presentation';

/**
 * Public failure codes for rejected dispatches. Details are repair-safe:
 * they name the subject that failed so a caller can re-read and retry,
 * and never carry internals.
 */
export type DispatchFailure =
  | { code: 'CONFLICT'; detail: string }
  | { code: 'INVALID_INPUT'; detail: string }
  | { code: 'LOCKED_ELEMENT'; detail: string }
  | { code: 'NOT_FOUND'; detail: string }
  | { code: 'STALE_REVISION'; currentRevision: number };

export type OperationFailure = Exclude<DispatchFailure, { code: 'STALE_REVISION' }>;

export type DispatchResult =
  | { changeSet: ChangeSet; ok: true }
  | { failure: DispatchFailure; ok: false };

export interface DispatchRequest {
  actor: Actor;
  /**
   * Optimistic concurrency guard: the whole dispatch is rejected atomically
   * when it does not match the current authoritative revision.
   */
  baseRevision?: number;
  label: string;
  operations: PresentationOperation[];
}

/** Client-local view state. Never enters ChangeSets or the canonical model. */
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

const MAX_CHANGESETS = 36;

// --- Field-aware optimistic comparisons (no serialization tricks) -----------

function frameMatches(left: Frame, right: Frame): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function textStyleMatches(left: TextStyle, right: TextStyle): boolean {
  return (
    left.align === right.align &&
    left.color === right.color &&
    left.fontFamily === right.fontFamily &&
    left.fontSize === right.fontSize &&
    left.fontWeight === right.fontWeight &&
    left.letterSpacing === right.letterSpacing &&
    left.lineHeight === right.lineHeight &&
    left.textTransform === right.textTransform
  );
}

function textElementMatches(left: TextElement, right: TextElement): boolean {
  return (
    left.id === right.id &&
    left.name === right.name &&
    frameMatches(left.frame, right.frame) &&
    left.locked === right.locked &&
    left.rotation === right.rotation &&
    left.text === right.text &&
    textStyleMatches(left.style, right.style)
  );
}

function shapeElementMatches(left: ShapeElement, right: ShapeElement): boolean {
  return (
    left.id === right.id &&
    left.name === right.name &&
    frameMatches(left.frame, right.frame) &&
    left.locked === right.locked &&
    left.rotation === right.rotation &&
    left.fill === right.fill &&
    left.radius === right.radius
  );
}

function elementMatches(left: PresentationElement, right: PresentationElement): boolean {
  if (left.kind === 'text' && right.kind === 'text') {
    return textElementMatches(left, right);
  }
  if (left.kind === 'shape' && right.kind === 'shape') {
    return shapeElementMatches(left, right);
  }
  return false;
}

function commentMatches(left: Comment, right: Comment): boolean {
  return (
    left.id === right.id &&
    actorMatches(left.actor, right.actor) &&
    left.body === right.body &&
    left.createdAt === right.createdAt &&
    left.elementId === right.elementId &&
    left.resolved === right.resolved &&
    left.slideId === right.slideId
  );
}

// --- Command application -----------------------------------------------------

function cloneFrame(frame: Frame): Frame {
  return { ...frame };
}

function updateSlide(
  presentation: Presentation,
  slideId: string,
  update: (slide: Slide) => Slide,
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

type OperationApplication =
  | { inverse: PresentationOperation; snapshot: PresentationSnapshot }
  | OperationFailure;

function notFound(detail: string): OperationFailure {
  return { code: 'NOT_FOUND', detail };
}

function conflict(detail: string): OperationFailure {
  return { code: 'CONFLICT', detail };
}

function lockedElement(elementId: string, action: string): OperationFailure {
  return { code: 'LOCKED_ELEMENT', detail: `Element "${elementId}" is locked and cannot be ${action}.` };
}

function applyOperation(
  snapshot: PresentationSnapshot,
  operation: PresentationOperation,
): OperationApplication {
  switch (operation.type) {
    case 'update_text': {
      const currentSlide = snapshot.presentation.slides[operation.slideId];
      if (!currentSlide) {
        return notFound(`No slide "${operation.slideId}" in this presentation.`);
      }
      const currentElement = currentSlide.elements[operation.elementId];
      if (!currentElement) {
        return notFound(`No element "${operation.elementId}" on slide "${operation.slideId}".`);
      }
      if (currentElement.kind !== 'text') {
        return conflict(`Element "${operation.elementId}" is not a text element.`);
      }
      if (currentElement.locked) {
        return lockedElement(operation.elementId, 'edited');
      }
      if (operation.expectedText !== undefined && currentElement.text !== operation.expectedText) {
        return conflict(`Text of element "${operation.elementId}" changed since it was read. Re-read the slide and retry.`);
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
        return notFound(`No slide "${operation.slideId}" in this presentation.`);
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
      if (!currentSlide) {
        return notFound(`No slide "${operation.slideId}" in this presentation.`);
      }
      const currentElement = currentSlide.elements[operation.elementId];
      if (!currentElement) {
        return notFound(`No element "${operation.elementId}" on slide "${operation.slideId}".`);
      }
      if (currentElement.locked) {
        return lockedElement(operation.elementId, 'moved');
      }
      if (operation.expectedFrame !== undefined && !frameMatches(currentElement.frame, operation.expectedFrame)) {
        return conflict(`Frame of element "${operation.elementId}" changed since it was read. Re-read the slide and retry.`);
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
        return notFound(`No slide "${operation.slideId}" in this presentation.`);
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
      if (!currentSlide) {
        return notFound(`No slide "${operation.slideId}" in this presentation.`);
      }
      if (currentSlide.elements[operation.element.id]) {
        return conflict(`Element "${operation.element.id}" already exists on slide "${operation.slideId}".`);
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
        return notFound(`No slide "${operation.slideId}" in this presentation.`);
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
      if (!currentSlide) {
        return notFound(`No slide "${operation.slideId}" in this presentation.`);
      }
      const currentElement = currentSlide.elements[operation.elementId];
      if (!currentElement) {
        return notFound(`No element "${operation.elementId}" on slide "${operation.slideId}".`);
      }
      if (currentElement.locked) {
        return lockedElement(operation.elementId, 'deleted');
      }
      if (operation.expectedElement !== undefined && !elementMatches(currentElement, operation.expectedElement)) {
        return conflict(`Element "${operation.elementId}" changed since it was read. Re-read the slide and retry.`);
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
        return notFound(`No slide "${operation.slideId}" in this presentation.`);
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
      const commentSlide = snapshot.presentation.slides[operation.comment.slideId];
      if (!commentSlide) {
        return notFound(`No slide "${operation.comment.slideId}" in this presentation.`);
      }
      if (operation.comment.elementId && !commentSlide.elements[operation.comment.elementId]) {
        return notFound(
          `No element "${operation.comment.elementId}" on slide "${operation.comment.slideId}".`,
        );
      }
      if (snapshot.comments[operation.comment.id]) {
        return conflict(`Comment "${operation.comment.id}" already exists.`);
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
      if (!currentComment) {
        return notFound(`No comment "${operation.commentId}" in this presentation.`);
      }
      if (operation.expectedComment !== undefined && !commentMatches(currentComment, operation.expectedComment)) {
        return conflict(`Comment "${operation.commentId}" changed since it was read. Re-read and retry.`);
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

    case 'resolve_comment': {
      const currentComment = snapshot.comments[operation.commentId];
      if (!currentComment) {
        return notFound(`No comment "${operation.commentId}" in this presentation.`);
      }
      if (operation.expectedResolved !== undefined && currentComment.resolved !== operation.expectedResolved) {
        return conflict(
          currentComment.resolved
            ? `Comment "${operation.commentId}" is already resolved.`
            : `Comment "${operation.commentId}" is not resolved.`,
        );
      }

      return {
        inverse: {
          type: 'resolve_comment',
          commentId: operation.commentId,
          resolved: currentComment.resolved,
        },
        snapshot: {
          ...snapshot,
          comments: {
            ...snapshot.comments,
            [operation.commentId]: {
              ...currentComment,
              resolved: operation.resolved,
            },
          },
        },
      };
    }
  }
}

function applyOperations(
  snapshot: PresentationSnapshot,
  operations: PresentationOperation[],
): { inverseOperations: PresentationOperation[]; snapshot: PresentationSnapshot } | OperationFailure {
  let workingSnapshot = snapshot;
  const inverseOperations: PresentationOperation[] = [];

  for (const operation of operations) {
    const result = applyOperation(workingSnapshot, operation);
    if ('code' in result) {
      return result;
    }
    workingSnapshot = result.snapshot;
    inverseOperations.unshift(result.inverse);
  }

  return { inverseOperations, snapshot: workingSnapshot };
}

// --- Store -------------------------------------------------------------------

function createInitialSnapshot(): PresentationSnapshot {
  const presentation = createLaunchDeck();
  return {
    presentation,
    comments: {},
    changeSets: {},
    changeSetOrder: [],
    session: {
      activeSlideId: LAUNCH_DECK_INITIAL_SLIDE_ID,
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
    const currentRevision = this.snapshot.presentation.revision;
    if (request.baseRevision !== undefined && request.baseRevision !== currentRevision) {
      return { failure: { code: 'STALE_REVISION', currentRevision }, ok: false };
    }
    if (request.operations.length === 0) {
      return { failure: { code: 'INVALID_INPUT', detail: 'At least one operation is required.' }, ok: false };
    }

    const result = applyOperations(this.snapshot, request.operations);
    if ('code' in result) {
      return { failure: result, ok: false };
    }

    const revision = currentRevision + 1;
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

// --- Model queries -----------------------------------------------------------

/** The text of the element named "Title", the deck's slide-title convention. */
export function slideTitleText(slide: Slide): string | undefined {
  const title = slide.elementOrder
    .map((elementId) => slide.elements[elementId])
    .find((element) => element.name === 'Title');
  return title?.kind === 'text' ? title.text : undefined;
}
