import { actorMatches } from './actors';
import { createLaunchDeck } from './deck';
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
 * Pure presentation command kernel: the single owner of the canonical
 * mutation algorithm. It is runtime-neutral (no React, DOM, browser storage,
 * listeners, URL state, UI selection, or undo stack) so the same module runs
 * in the browser and inside a Cloudflare Worker / Durable Object unchanged.
 *
 * State is the JSON-serializable {@link PresentationDocument}; a dispatch is
 * a pure function `document -> document + changeSet | structured failure`.
 * The browser store composes on top of this kernel for session and undo.
 */

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

/** Canonical persisted document state. JSON-serializable; no session/UI data. */
export interface PresentationDocument {
  changeSetOrder: string[];
  changeSets: Record<string, ChangeSet>;
  comments: Record<string, Comment>;
  presentation: Presentation;
}

export type DispatchResult =
  | { changeSet: ChangeSet; document: PresentationDocument; ok: true }
  | { failure: DispatchFailure; ok: false };

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
  | { inverse: PresentationOperation; document: PresentationDocument }
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
  document: PresentationDocument,
  operation: PresentationOperation,
): OperationApplication {
  switch (operation.type) {
    case 'update_text': {
      const currentSlide = document.presentation.slides[operation.slideId];
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

      const nextPresentation = updateSlide(document.presentation, operation.slideId, (slide) => ({
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
        document: {
          ...document,
          presentation: nextPresentation,
        },
      };
    }

    case 'update_frame': {
      const currentSlide = document.presentation.slides[operation.slideId];
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

      const nextPresentation = updateSlide(document.presentation, operation.slideId, (slide) => ({
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
        document: {
          ...document,
          presentation: nextPresentation,
        },
      };
    }

    case 'create_element': {
      const currentSlide = document.presentation.slides[operation.slideId];
      if (!currentSlide) {
        return notFound(`No slide "${operation.slideId}" in this presentation.`);
      }
      if (currentSlide.elements[operation.element.id]) {
        return conflict(`Element "${operation.element.id}" already exists on slide "${operation.slideId}".`);
      }

      const nextPresentation = updateSlide(document.presentation, operation.slideId, (slide) => ({
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
        document: {
          ...document,
          presentation: nextPresentation,
        },
      };
    }

    case 'delete_element': {
      const currentSlide = document.presentation.slides[operation.slideId];
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

      const nextPresentation = updateSlide(document.presentation, operation.slideId, (slide) => {
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
        document: {
          ...document,
          presentation: nextPresentation,
        },
      };
    }

    case 'add_comment': {
      const commentSlide = document.presentation.slides[operation.comment.slideId];
      if (!commentSlide) {
        return notFound(`No slide "${operation.comment.slideId}" in this presentation.`);
      }
      if (operation.comment.elementId && !commentSlide.elements[operation.comment.elementId]) {
        return notFound(
          `No element "${operation.comment.elementId}" on slide "${operation.comment.slideId}".`,
        );
      }
      if (document.comments[operation.comment.id]) {
        return conflict(`Comment "${operation.comment.id}" already exists.`);
      }

      return {
        inverse: {
          type: 'remove_comment',
          commentId: operation.comment.id,
          expectedComment: operation.comment,
        },
        document: {
          ...document,
          comments: {
            ...document.comments,
            [operation.comment.id]: operation.comment,
          },
        },
      };
    }

    case 'remove_comment': {
      const currentComment = document.comments[operation.commentId];
      if (!currentComment) {
        return notFound(`No comment "${operation.commentId}" in this presentation.`);
      }
      if (operation.expectedComment !== undefined && !commentMatches(currentComment, operation.expectedComment)) {
        return conflict(`Comment "${operation.commentId}" changed since it was read. Re-read and retry.`);
      }

      const { [operation.commentId]: removedComment, ...remainingComments } = document.comments;
      void removedComment;
      return {
        inverse: {
          type: 'add_comment',
          comment: currentComment,
        },
        document: {
          ...document,
          comments: remainingComments,
        },
      };
    }

    case 'resolve_comment': {
      const currentComment = document.comments[operation.commentId];
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
        document: {
          ...document,
          comments: {
            ...document.comments,
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
  document: PresentationDocument,
  operations: PresentationOperation[],
): { inverseOperations: PresentationOperation[]; document: PresentationDocument } | OperationFailure {
  let workingDocument = document;
  const inverseOperations: PresentationOperation[] = [];

  for (const operation of operations) {
    const result = applyOperation(workingDocument, operation);
    if ('code' in result) {
      return result;
    }
    workingDocument = result.document;
    inverseOperations.unshift(result.inverse);
  }

  return { inverseOperations, document: workingDocument };
}

// --- Document lifecycle ------------------------------------------------------

export function createInitialPresentationDocument(): PresentationDocument {
  return {
    presentation: createLaunchDeck(),
    comments: {},
    changeSets: {},
    changeSetOrder: [],
  };
}

function appendChangeSet(
  document: PresentationDocument,
  changeSet: ChangeSet,
): PresentationDocument {
  return {
    ...document,
    changeSetOrder: [...document.changeSetOrder, changeSet.id],
    changeSets: {
      ...document.changeSets,
      [changeSet.id]: changeSet,
    },
  };
}

/** Bounded changeset retention: keep only the most recent window. */
function trimChangeSets(document: PresentationDocument): PresentationDocument {
  if (document.changeSetOrder.length <= MAX_CHANGESETS) {
    return document;
  }
  const retainedOrder = document.changeSetOrder.slice(-MAX_CHANGESETS);
  const retainedChangeSets = Object.fromEntries(
    retainedOrder.map((id) => [id, document.changeSets[id]]),
  );
  return {
    ...document,
    changeSetOrder: retainedOrder,
    changeSets: retainedChangeSets,
  };
}

/**
 * Pure atomic dispatch: applies one attributed batch of operations to the
 * document, or rejects the whole batch with no partial mutation.
 */
export function dispatchPresentationDocument(
  document: PresentationDocument,
  request: DispatchRequest,
): DispatchResult {
  const currentRevision = document.presentation.revision;
  if (request.baseRevision !== undefined && request.baseRevision !== currentRevision) {
    return { ok: false, failure: { code: 'STALE_REVISION', currentRevision } };
  }
  if (request.operations.length === 0) {
    return { ok: false, failure: { code: 'INVALID_INPUT', detail: 'At least one operation is required.' } };
  }

  const result = applyOperations(document, request.operations);
  if ('code' in result) {
    return { ok: false, failure: result };
  }

  const changeSet: ChangeSet = {
    id: crypto.randomUUID(),
    actor: request.actor,
    label: request.label,
    operations: request.operations,
    inverseOperations: result.inverseOperations,
    revision: currentRevision + 1,
    createdAt: new Date().toISOString(),
  };
  const nextDocument = trimChangeSets(
    appendChangeSet(
      {
        ...result.document,
        presentation: {
          ...result.document.presentation,
          revision: currentRevision + 1,
        },
      },
      changeSet,
    ),
  );

  return { ok: true, changeSet, document: nextDocument };
}

// --- Model queries -----------------------------------------------------------

/** The text of the element named "Title", the deck's slide-title convention. */
export function slideTitleText(slide: Slide): string | undefined {
  const title = slide.elementOrder
    .map((elementId) => slide.elements[elementId])
    .find((element) => element.name === 'Title');
  return title?.kind === 'text' ? title.text : undefined;
}