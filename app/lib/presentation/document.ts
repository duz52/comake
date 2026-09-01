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
  ShapeFill,
  ShapeGeometry,
  ShapeStroke,
  ShapeStyle,
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

// --- Canonical invariants (shared with the WebMCP operation parser) ----------

/** The only color form the canonical model accepts: strict `#RRGGBB` hex. */
export function isCanonicalColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

/**
 * An element frame is canonical only when it is finite, has positive width and
 * height, and lies fully inside the presentation bounds. Width/height stay
 * positive and x/y plus dimensions must fit the presentation.
 */
export function frameFitsPresentation(frame: Frame, size: Presentation['size']): boolean {
  return (
    Number.isFinite(frame.x) &&
    Number.isFinite(frame.y) &&
    Number.isFinite(frame.width) &&
    Number.isFinite(frame.height) &&
    frame.x >= 0 &&
    frame.y >= 0 &&
    frame.width > 0 &&
    frame.height > 0 &&
    frame.x + frame.width <= size.width &&
    frame.y + frame.height <= size.height
  );
}

function isCanonicalRadius(radius: number): boolean {
  return Number.isFinite(radius) && radius >= 0;
}

/** Solid-paint opacity is a finite fraction in (0, 1]; full transparency is `none`. */
export function isCanonicalOpacity(opacity: number): boolean {
  return Number.isFinite(opacity) && opacity > 0 && opacity <= 1;
}

/**
 * The single derivation of the rendered corner radius: the authored radius
 * clamped to the half of the shorter frame side; non-rectangles have none.
 * Canvas and exporter must call this, never re-derive it.
 */
export function effectiveCornerRadius(frame: Frame, geometry: ShapeGeometry): number {
  if (geometry.kind !== 'rectangle') {
    return 0;
  }
  return Math.min(geometry.cornerRadius, Math.min(frame.width, frame.height) / 2);
}

/** The canonical dash enum; owned by the kernel (I6), mirrored by the parser. */
export const strokeDashes = ['solid', 'dash', 'dot'] as const;

/**
 * The one validator of canonical shape-style invariants: every geometry/fill/
 * stroke discriminant, the solid-paint colors and opacities, the solid stroke
 * width and dash pattern, and the rectangle's corner radius. Returns the
 * rejection detail, or undefined when the style is canonical.
 */
export function shapeStyleFailure(style: ShapeStyle): string | undefined {
  if (
    style.geometry.kind !== 'rectangle' &&
    style.geometry.kind !== 'ellipse' &&
    style.geometry.kind !== 'triangle' &&
    style.geometry.kind !== 'diamond'
  ) {
    return 'Geometry kind must be one of "rectangle", "ellipse", "triangle", "diamond".';
  }
  if (style.fill.kind !== 'none' && style.fill.kind !== 'solid') {
    return 'Fill kind must be "none" or "solid".';
  }
  if (style.stroke.kind !== 'none' && style.stroke.kind !== 'solid') {
    return 'Stroke kind must be "none" or "solid".';
  }
  if (style.fill.kind === 'solid') {
    if (!isCanonicalColor(style.fill.color)) {
      return 'Fill color must be a strict #RRGGBB hex color like "#ec6f42".';
    }
    if (!isCanonicalOpacity(style.fill.opacity)) {
      return 'Fill opacity must be a finite fraction greater than 0 and at most 1.';
    }
  }
  if (style.stroke.kind === 'solid') {
    if (!isCanonicalColor(style.stroke.color)) {
      return 'Stroke color must be a strict #RRGGBB hex color like "#ec6f42".';
    }
    if (!isCanonicalOpacity(style.stroke.opacity)) {
      return 'Stroke opacity must be a finite fraction greater than 0 and at most 1.';
    }
    if (!(Number.isFinite(style.stroke.width) && style.stroke.width > 0)) {
      return 'Stroke width must be a finite positive number.';
    }
    if (!strokeDashes.includes(style.stroke.dash)) {
      return 'Stroke dash must be one of "solid", "dash", "dot".';
    }
  }
  if (style.geometry.kind === 'rectangle' && !isCanonicalRadius(style.geometry.cornerRadius)) {
    return 'Corner radius must be a finite non-negative number.';
  }
  return undefined;
}

/** Same membership, order-insensitive: id collections compare as sets. */
function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightIds = new Set(right);
  return left.every((entry) => rightIds.has(entry));
}

/** Exact sequence equality, order-sensitive. */
function sameSequence(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

/**
 * True when `order` is an exact permutation of `reference`: the same id set
 * (no duplicates, nothing added or dropped) in any sequence.
 */
function isPermutationOf(reference: readonly string[], order: readonly string[]): boolean {
  return sameStrings(reference, order);
}

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

/** Field-exact shape-style equality; the single owner of style comparison. */
export function shapeStyleMatches(left: ShapeStyle, right: ShapeStyle): boolean {
  if (!geometryMatches(left.geometry, right.geometry)) {
    return false;
  }
  if (!paintMatches(left.fill, right.fill)) {
    return false;
  }
  if (!strokeMatches(left.stroke, right.stroke)) {
    return false;
  }
  return true;
}

function geometryMatches(left: ShapeGeometry, right: ShapeGeometry): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === 'rectangle' && right.kind === 'rectangle') {
    return left.cornerRadius === right.cornerRadius;
  }
  return true;
}

function paintMatches(left: ShapeFill, right: ShapeFill): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === 'solid' && right.kind === 'solid') {
    return left.color === right.color && left.opacity === right.opacity;
  }
  return true;
}

function strokeMatches(left: ShapeStroke, right: ShapeStroke): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === 'solid' && right.kind === 'solid') {
    return (
      left.color === right.color &&
      left.dash === right.dash &&
      left.opacity === right.opacity &&
      left.width === right.width
    );
  }
  return true;
}

function shapeElementMatches(left: ShapeElement, right: ShapeElement): boolean {
  return (
    left.id === right.id &&
    left.name === right.name &&
    frameMatches(left.frame, right.frame) &&
    left.locked === right.locked &&
    left.rotation === right.rotation &&
    shapeStyleMatches(left.style, right.style)
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

function slideMatches(left: Slide, right: Slide): boolean {
  if (
    left.id !== right.id ||
    left.name !== right.name ||
    left.background !== right.background ||
    left.notes !== right.notes ||
    left.elementOrder.length !== right.elementOrder.length ||
    Object.keys(left.elements).length !== Object.keys(right.elements).length
  ) {
    return false;
  }
  return left.elementOrder.every((elementId, index) => {
    const leftElement = left.elements[elementId];
    const rightElement = right.elements[elementId];
    return (
      right.elementOrder[index] === elementId &&
      leftElement !== undefined &&
      rightElement !== undefined &&
      elementMatches(leftElement, rightElement)
    );
  });
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

function cloneTextStyle(style: TextStyle): TextStyle {
  return { ...style };
}

/** Deep clone of a shape style: every nested paint and geometry record is copied. */
function cloneShapeStyle(style: ShapeStyle): ShapeStyle {
  return {
    fill: style.fill.kind === 'solid' ? { ...style.fill } : style.fill,
    geometry:
      style.geometry.kind === 'rectangle' ? { ...style.geometry } : style.geometry,
    stroke: style.stroke.kind === 'solid' ? { ...style.stroke } : style.stroke,
  };
}

function cloneElement(element: PresentationElement): PresentationElement {
  if (element.kind === 'text') {
    return { ...element, frame: cloneFrame(element.frame), style: cloneTextStyle(element.style) };
  }
  return { ...element, frame: cloneFrame(element.frame), style: cloneShapeStyle(element.style) };
}

function cloneSlide(slide: Slide): Slide {
  return {
    ...slide,
    elementOrder: [...slide.elementOrder],
    elements: Object.fromEntries(
      Object.entries(slide.elements).map(([elementId, element]) => [elementId, cloneElement(element)]),
    ),
  };
}

function cloneComment(comment: Comment): Comment {
  return { ...comment, actor: { ...comment.actor } };
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

function invalidInput(detail: string): OperationFailure {
  return { code: 'INVALID_INPUT', detail };
}

/**
 * Canonical slide shape: `elementOrder` is a bijection of the element record —
 * every element id appears in the order exactly once and every element record
 * appears in the order. Returns the rejection, or undefined when valid.
 */
function slideElementOrderFailure(slide: Slide): OperationFailure | undefined {
  const orderIds = new Set<string>();
  let duplicateElementId: string | undefined;
  for (const elementId of slide.elementOrder) {
    if (!orderIds.has(elementId)) {
      orderIds.add(elementId);
    } else if (duplicateElementId === undefined) {
      duplicateElementId = elementId;
    }
  }
  if (duplicateElementId !== undefined) {
    return invalidInput(
      `Element order of slide "${slide.id}" lists element "${duplicateElementId}" more than once.`,
    );
  }
  const missingElementId = slide.elementOrder.find(
    (elementId) => !Object.hasOwn(slide.elements, elementId),
  );
  if (missingElementId !== undefined) {
    return invalidInput(
      `Element order of slide "${slide.id}" references missing element "${missingElementId}".`,
    );
  }
  const extraElementId = Object.keys(slide.elements).find((elementId) => !orderIds.has(elementId));
  if (extraElementId !== undefined) {
    return invalidInput(
      `Element "${extraElementId}" of slide "${slide.id}" is missing from its element order.`,
    );
  }
  return undefined;
}

/**
 * Canonical element invariants every caller must satisfy: the frame fits the
 * presentation, text colors are strict #RRGGBB, and a shape carries a fully
 * canonical style. Returns the rejection, or undefined when the element is valid.
 */
function elementInvariantFailure(
  element: PresentationElement,
  size: Presentation['size'],
): OperationFailure | undefined {
  if (!frameFitsPresentation(element.frame, size)) {
    return invalidInput(
      `Frame of element "${element.id}" must have positive width and height and fit inside the ${size.width}x${size.height} presentation.`,
    );
  }
  if (element.kind === 'text') {
    if (!isCanonicalColor(element.style.color)) {
      return invalidInput(`Color of element "${element.id}" must be a strict #RRGGBB hex color like "#ec6f42".`);
    }
    return undefined;
  }
  const styleFailure = shapeStyleFailure(element.style);
  if (styleFailure !== undefined) {
    return invalidInput(`Style of element "${element.id}" is invalid: ${styleFailure}`);
  }
  return undefined;
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

    case 'update_text_style': {
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
        return lockedElement(operation.elementId, 'restyled');
      }
      if (!isCanonicalColor(operation.style.color)) {
        return invalidInput(`Color of element "${operation.elementId}" must be a strict #RRGGBB hex color like "#ec6f42".`);
      }
      if (operation.expectedStyle !== undefined && !textStyleMatches(currentElement.style, operation.expectedStyle)) {
        return conflict(`Style of element "${operation.elementId}" changed since it was read. Re-read the slide and retry.`);
      }

      const nextPresentation = updateSlide(document.presentation, operation.slideId, (slide) => ({
        ...slide,
        elements: {
          ...slide.elements,
          [operation.elementId]: {
            ...currentElement,
            style: operation.style,
          },
        },
      }));

      if (!nextPresentation) {
        return notFound(`No slide "${operation.slideId}" in this presentation.`);
      }

      return {
        inverse: {
          type: 'update_text_style',
          slideId: operation.slideId,
          elementId: operation.elementId,
          style: currentElement.style,
          expectedStyle: operation.style,
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
      if (!frameFitsPresentation(operation.frame, document.presentation.size)) {
        return invalidInput(
          `Frame of element "${operation.elementId}" must have positive width and height and fit inside the ${document.presentation.size.width}x${document.presentation.size.height} presentation.`,
        );
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
            frame: operation.frame,
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
          frame: currentElement.frame,
          expectedFrame: operation.frame,
        },
        document: {
          ...document,
          presentation: nextPresentation,
        },
      };
    }

    case 'update_shape_style': {
      const currentSlide = document.presentation.slides[operation.slideId];
      if (!currentSlide) {
        return notFound(`No slide "${operation.slideId}" in this presentation.`);
      }
      const currentElement = currentSlide.elements[operation.elementId];
      if (!currentElement) {
        return notFound(`No element "${operation.elementId}" on slide "${operation.slideId}".`);
      }
      if (currentElement.kind !== 'shape') {
        return conflict(`Element "${operation.elementId}" is not a shape element.`);
      }
      if (currentElement.locked) {
        return lockedElement(operation.elementId, 'restyled');
      }
      const styleFailure = shapeStyleFailure(operation.style);
      if (styleFailure !== undefined) {
        return invalidInput(`Style of element "${operation.elementId}" is invalid: ${styleFailure}`);
      }
      if (operation.expectedStyle !== undefined && !shapeStyleMatches(currentElement.style, operation.expectedStyle)) {
        return conflict(`Style of element "${operation.elementId}" changed since it was read. Re-read the slide and retry.`);
      }

      const nextPresentation = updateSlide(document.presentation, operation.slideId, (slide) => ({
        ...slide,
        elements: {
          ...slide.elements,
          [operation.elementId]: {
            ...currentElement,
            style: operation.style,
          },
        },
      }));

      if (!nextPresentation) {
        return notFound(`No slide "${operation.slideId}" in this presentation.`);
      }

      return {
        inverse: {
          type: 'update_shape_style',
          slideId: operation.slideId,
          elementId: operation.elementId,
          style: currentElement.style,
          expectedStyle: operation.style,
        },
        document: {
          ...document,
          presentation: nextPresentation,
        },
      };
    }

    case 'update_element_order': {
      const currentSlide = document.presentation.slides[operation.slideId];
      if (!currentSlide) {
        return notFound(`No slide "${operation.slideId}" in this presentation.`);
      }
      if (
        operation.expectedElementOrder !== undefined &&
        !sameSequence(currentSlide.elementOrder, operation.expectedElementOrder)
      ) {
        return conflict(`Element order of slide "${operation.slideId}" changed since it was read. Re-read the slide and retry.`);
      }
      if (!isPermutationOf(currentSlide.elementOrder, operation.elementOrder)) {
        return invalidInput(
          `Element order of slide "${operation.slideId}" must be a permutation of the slide's existing element ids, each exactly once.`,
        );
      }

      const nextPresentation = updateSlide(document.presentation, operation.slideId, (slide) => ({
        ...slide,
        elementOrder: operation.elementOrder,
      }));

      if (!nextPresentation) {
        return notFound(`No slide "${operation.slideId}" in this presentation.`);
      }

      return {
        inverse: {
          type: 'update_element_order',
          slideId: operation.slideId,
          elementOrder: currentSlide.elementOrder,
          expectedElementOrder: operation.elementOrder,
        },
        document: {
          ...document,
          presentation: nextPresentation,
        },
      };
    }

    case 'update_slide': {
      const currentSlide = document.presentation.slides[operation.slideId];
      if (!currentSlide) {
        return notFound(`No slide "${operation.slideId}" in this presentation.`);
      }
      if (!isCanonicalColor(operation.background)) {
        return invalidInput(`Background of slide "${operation.slideId}" must be a strict #RRGGBB hex color like "#ec6f42".`);
      }
      if (operation.expectedName !== undefined && currentSlide.name !== operation.expectedName) {
        return conflict(`Name of slide "${operation.slideId}" changed since it was read. Re-read the deck and retry.`);
      }
      if (operation.expectedBackground !== undefined && currentSlide.background !== operation.expectedBackground) {
        return conflict(`Background of slide "${operation.slideId}" changed since it was read. Re-read the deck and retry.`);
      }
      if (operation.expectedNotes !== undefined && currentSlide.notes !== operation.expectedNotes) {
        return conflict(`Notes of slide "${operation.slideId}" changed since it was read. Re-read the deck and retry.`);
      }

      const nextSlide: Slide = { ...currentSlide, name: operation.name, background: operation.background };
      if (operation.notes === undefined) {
        delete nextSlide.notes;
      } else {
        nextSlide.notes = operation.notes;
      }

      return {
        inverse: {
          type: 'update_slide',
          slideId: operation.slideId,
          name: currentSlide.name,
          background: currentSlide.background,
          notes: currentSlide.notes,
          expectedName: operation.name,
          expectedBackground: operation.background,
          expectedNotes: operation.notes,
        },
        document: {
          ...document,
          presentation: {
            ...document.presentation,
            slides: {
              ...document.presentation.slides,
              [operation.slideId]: nextSlide,
            },
          },
        },
      };
    }

    case 'create_slide': {
      if (document.presentation.slides[operation.slide.id]) {
        return conflict(`Slide "${operation.slide.id}" already exists in this presentation.`);
      }
      if (!isCanonicalColor(operation.slide.background)) {
        return invalidInput(`Background of slide "${operation.slide.id}" must be a strict #RRGGBB hex color like "#ec6f42".`);
      }
      const orderFailure = slideElementOrderFailure(operation.slide);
      if (orderFailure) {
        return orderFailure;
      }
      for (const elementId of operation.slide.elementOrder) {
        const elementFailure = elementInvariantFailure(operation.slide.elements[elementId], document.presentation.size);
        if (elementFailure) {
          return elementFailure;
        }
      }
      const slideCount = document.presentation.slideOrder.length;
      if (
        operation.insertAt !== undefined &&
        (!Number.isSafeInteger(operation.insertAt) || operation.insertAt < 0 || operation.insertAt > slideCount)
      ) {
        return invalidInput(
          `Insertion index ${operation.insertAt} is not a valid slide position for a deck with ${slideCount} slides.`,
        );
      }

      const slideOrder = [...document.presentation.slideOrder];
      if (operation.insertAt === undefined) {
        slideOrder.push(operation.slide.id);
      } else {
        slideOrder.splice(operation.insertAt, 0, operation.slide.id);
      }

      return {
        inverse: {
          type: 'delete_slide',
          slideId: operation.slide.id,
          expectedSlide: operation.slide,
        },
        document: {
          ...document,
          presentation: {
            ...document.presentation,
            slideOrder,
            slides: {
              ...document.presentation.slides,
              [operation.slide.id]: operation.slide,
            },
          },
        },
      };
    }

    case 'delete_slide': {
      const currentSlide = document.presentation.slides[operation.slideId];
      if (!currentSlide) {
        return notFound(`No slide "${operation.slideId}" in this presentation.`);
      }
      if (operation.expectedSlide !== undefined && !slideMatches(currentSlide, operation.expectedSlide)) {
        return conflict(`Slide "${operation.slideId}" changed since it was read. Re-read the deck and retry.`);
      }
      if (document.presentation.slideOrder.length <= 1) {
        return conflict(`Slide "${operation.slideId}" is the final slide and cannot be deleted.`);
      }
      if (Object.values(document.comments).some((comment) => comment.slideId === operation.slideId)) {
        return conflict(
          `Slide "${operation.slideId}" still has comments. Remove its comments in the same atomic batch before deleting it.`,
        );
      }

      const insertAt = document.presentation.slideOrder.indexOf(operation.slideId);
      const slideOrder = document.presentation.slideOrder.filter((id) => id !== operation.slideId);
      const { [operation.slideId]: removedSlide, ...remainingSlides } = document.presentation.slides;
      void removedSlide;

      return {
        inverse: {
          type: 'create_slide',
          slide: currentSlide,
          insertAt,
        },
        document: {
          ...document,
          presentation: {
            ...document.presentation,
            slideOrder,
            slides: remainingSlides,
          },
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
      const elementFailure = elementInvariantFailure(operation.element, document.presentation.size);
      if (elementFailure) {
        return elementFailure;
      }
      const insertAt = operation.insertAt ?? currentSlide.elementOrder.length;
      if (!Number.isSafeInteger(insertAt) || insertAt < 0 || insertAt > currentSlide.elementOrder.length) {
        return invalidInput(
          `Insertion index ${operation.insertAt} is not a valid element position for slide "${operation.slideId}" with ${currentSlide.elementOrder.length} elements.`,
        );
      }

      const nextPresentation = updateSlide(document.presentation, operation.slideId, (slide) => {
        const elementOrder = [...slide.elementOrder];
        elementOrder.splice(insertAt, 0, operation.element.id);
        return {
          ...slide,
          elementOrder,
          elements: {
            ...slide.elements,
            [operation.element.id]: operation.element,
          },
        };
      });

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
      if (
        Object.values(document.comments).some(
          (comment) => comment.slideId === operation.slideId && comment.elementId === operation.elementId,
        )
      ) {
        return conflict(
          `Element "${operation.elementId}" on slide "${operation.slideId}" still has comments. Remove its comments in the same atomic batch before deleting it.`,
        );
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
          insertAt: currentSlide.elementOrder.indexOf(operation.elementId),
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
          // The revert must not overwrite a concurrently changed resolution
          // state: it only applies while the comment still holds the state
          // this operation produced.
          expectedResolved: operation.resolved,
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
  const appliedInverses: PresentationOperation[] = [];

  for (const operation of operations) {
    const result = applyOperation(workingDocument, operation);
    if ('code' in result) {
      return result;
    }
    workingDocument = result.document;
    appliedInverses.push(result.inverse);
  }

  // Reverse once at the end: the exact inverse order of the forward sequence,
  // built in linear time instead of unshifting per operation.
  return { inverseOperations: appliedInverses.reverse(), document: workingDocument };
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
 * Field-aware deep clone of an operation's canonical nested values (frames,
 * styles, order arrays, slides, elements, comments); primitives are copied by
 * the spread. This realizes the kernel's ownership boundary: after cloning,
 * the document, the inverses, and the stored changeset reference kernel-owned
 * data only, so a caller-retained operation object can never mutate
 * canonical state.
 */
function cloneOperation(operation: PresentationOperation): PresentationOperation {
  switch (operation.type) {
    case 'update_text':
    case 'update_slide':
    case 'resolve_comment':
      return { ...operation };
    case 'update_shape_style':
      return {
        ...operation,
        style: cloneShapeStyle(operation.style),
        expectedStyle: operation.expectedStyle && cloneShapeStyle(operation.expectedStyle),
      };
    case 'update_text_style':
      return {
        ...operation,
        style: cloneTextStyle(operation.style),
        expectedStyle: operation.expectedStyle && cloneTextStyle(operation.expectedStyle),
      };
    case 'update_frame':
      return {
        ...operation,
        frame: cloneFrame(operation.frame),
        expectedFrame: operation.expectedFrame && cloneFrame(operation.expectedFrame),
      };
    case 'update_element_order':
      return {
        ...operation,
        elementOrder: [...operation.elementOrder],
        expectedElementOrder: operation.expectedElementOrder && [...operation.expectedElementOrder],
      };
    case 'create_slide':
      return { ...operation, slide: cloneSlide(operation.slide) };
    case 'delete_slide':
      return {
        ...operation,
        expectedSlide: operation.expectedSlide && cloneSlide(operation.expectedSlide),
      };
    case 'create_element':
      return { ...operation, element: cloneElement(operation.element) };
    case 'delete_element':
      return {
        ...operation,
        expectedElement: operation.expectedElement && cloneElement(operation.expectedElement),
      };
    case 'add_comment':
      return { ...operation, comment: cloneComment(operation.comment) };
    case 'remove_comment':
      return {
        ...operation,
        expectedComment: operation.expectedComment && cloneComment(operation.expectedComment),
      };
  }
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

  // Ownership boundary: take the caller's operations once; everything the
  // dispatch stores or derives references these kernel-owned clones.
  const operations = request.operations.map(cloneOperation);

  const result = applyOperations(document, operations);
  if ('code' in result) {
    return { ok: false, failure: result };
  }

  const changeSet: ChangeSet = {
    id: crypto.randomUUID(),
    actor: request.actor,
    label: request.label,
    operations,
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