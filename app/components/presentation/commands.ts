import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../lib/presentation/canvas';
import { shapeStyleMatches } from '../../lib/presentation/document';
import type { PresentationStore, PresentationSnapshot } from '../../lib/presentation/store';
import type {
  Frame,
  PresentationElement,
  PresentationOperation,
  ShapeElement,
  ShapeGeometry,
  ShapeStyle,
  Slide,
  TextElement,
  TextStyle,
} from '../../types/presentation';
import { centeredFrame, clamp, framesEqual } from './gesture';
import { slideDisplayName } from './slide-label';

/**
 * Unified human command surface for the editor shell.
 *
 * Every canonical write from the UI funnels through this module so the
 * editor speaks one command vocabulary: attributed, atomically batched
 * operations against the canonical model, each carrying the optimistic
 * expected values the caller read. Failures return one neutral notice.
 */

export interface CommandEnv {
  slideId: string;
  snapshot: PresentationSnapshot;
  store: PresentationStore;
}

export type CommandResult = { ok: true } | { ok: false; notice: string };

/** Neutral dispatch wrapper for attributed human writes. */
export async function dispatchHuman(
  env: CommandEnv,
  label: string,
  operations: PresentationOperation[],
): Promise<CommandResult> {
  const result = await env.store.dispatch({ actorKind: 'human', label, operations });
  if (!result.ok) {
    return { ok: false, notice: 'The change could not be applied. Please review and try again.' };
  }
  return { ok: true };
}

function newBlankSlide(name: string): Slide {
  return {
    id: crypto.randomUUID(),
    name,
    background: '#171713',
    elementOrder: [],
    elements: {},
  };
}

const NEW_TEXT_WIDTH = 240;
const NEW_TEXT_HEIGHT = 56;
const NEW_SHAPE_WIDTH = 160;
const NEW_SHAPE_HEIGHT = 120;
const DEFAULT_RECTANGLE_RADIUS = 8;

/** Session default for the Shape tool; never written until a place click. */
export const DEFAULT_SHAPE_GEOMETRY: ShapeGeometry = {
  kind: 'rectangle',
  cornerRadius: DEFAULT_RECTANGLE_RADIUS,
};

/** Canonical geometry for a Shape-tool kind choice. */
export function shapeGeometryForKind(kind: ShapeGeometry['kind']): ShapeGeometry {
  return kind === 'rectangle' ? { kind: 'rectangle', cornerRadius: DEFAULT_RECTANGLE_RADIUS } : { kind };
}

/**
 * A canonical new text element centered on a slide point. The empty seed is
 * deliberate: every creation flow (Text tool, canvas-menu Add text) opens the
 * inline editor immediately, and an untouched commit deletes the element, so
 * no placeholder text can ever reach the deck.
 */
export function newTextElement(point: { x: number; y: number }): TextElement {
  return {
    id: crypto.randomUUID(),
    kind: 'text',
    name: 'Text',
    frame: centeredFrame(point, NEW_TEXT_WIDTH, NEW_TEXT_HEIGHT),
    text: '',
    style: {
      color: '#ec6f42',
      fontFamily: 'Manrope, sans-serif',
      fontSize: 19,
      lineHeight: 1.42,
    },
  };
}

/**
 * A canonical new shape centered on a slide point: an explicit solid fill,
 * the given geometry (rectangle with the authored default radius when
 * omitted), and no stroke. No projection infers or clamps these defaults.
 */
export function newShapeElement(point: { x: number; y: number }, geometry: ShapeGeometry = DEFAULT_SHAPE_GEOMETRY): ShapeElement {
  return {
    id: crypto.randomUUID(),
    kind: 'shape',
    name: 'Shape',
    frame: centeredFrame(point, NEW_SHAPE_WIDTH, NEW_SHAPE_HEIGHT),
    style: {
      fill: { kind: 'solid', color: '#ec6f42', opacity: 1 },
      geometry,
      stroke: { kind: 'none' },
    },
  };
}

/**
 * Create a canonical text element on a slide point (the canvas center when
 * no point is given) and select it. The kernel owns the element shape; this
 * command only names the attributed write.
 */
export async function addTextElement(
  env: CommandEnv,
  point?: { x: number; y: number },
): Promise<{ ok: true; elementId: string } | { ok: false; notice: string }> {
  const element = newTextElement(point ?? { x: SLIDE_WIDTH / 2, y: SLIDE_HEIGHT / 2 });
  const result = await dispatchHuman(env, `Added ${element.name}`, [
    { type: 'create_element', slideId: env.slideId, element },
  ]);
  if (!result.ok) {
    return result;
  }
  return { ok: true, elementId: element.id };
}

/** Create a canonical shape element on a slide point (center when omitted) and select it. */
export async function addShapeElement(
  env: CommandEnv,
  point?: { x: number; y: number },
  geometry: ShapeGeometry = DEFAULT_SHAPE_GEOMETRY,
): Promise<{ ok: true; elementId: string } | { ok: false; notice: string }> {
  const element = newShapeElement(point ?? { x: SLIDE_WIDTH / 2, y: SLIDE_HEIGHT / 2 }, geometry);
  const result = await dispatchHuman(env, `Added ${element.name}`, [
    { type: 'create_element', slideId: env.slideId, element },
  ]);
  if (!result.ok) {
    return result;
  }
  return { ok: true, elementId: element.id };
}

/**
 * Replace the presentation title through the canonical
 * `update_presentation` write. `expectedTitle` is the title the caller
 * read; a mismatch is a conflict, never retried here.
 */
export async function updatePresentationTitle(
  env: CommandEnv,
  title: string,
  expectedTitle: string,
): Promise<CommandResult> {
  return dispatchHuman(env, 'Renamed the presentation', [
    { type: 'update_presentation', title, expectedTitle },
  ]);
}

/** Append a fresh blank slide and focus it. */
export async function addSlide(env: CommandEnv): Promise<{ ok: true; slideId: string } | { ok: false; notice: string }> {
  const slide = newBlankSlide(`Slide ${env.snapshot.presentation.slideOrder.length + 1}`);
  const result = await dispatchHuman(env, 'Added a slide', [{ type: 'create_slide', slide }]);
  if (!result.ok) {
    return result;
  }
  return { ok: true, slideId: slide.id };
}

/** Insert a fresh blank slide directly after the given slide and focus it. */
export async function addSlideAfter(
  env: CommandEnv,
  afterSlideId: string,
): Promise<{ ok: true; slideId: string } | { ok: false; notice: string }> {
  const slide = newBlankSlide(`Slide ${env.snapshot.presentation.slideOrder.length + 1}`);
  const insertAt = env.snapshot.presentation.slideOrder.indexOf(afterSlideId) + 1;
  const result = await dispatchHuman(env, 'Added a slide', [
    { type: 'create_slide', slide, insertAt },
  ]);
  if (!result.ok) {
    return result;
  }
  return { ok: true, slideId: slide.id };
}

/** Copy a slide with fresh ids, inserted directly after it. */
export async function duplicateSlide(
  env: CommandEnv,
  slideId: string,
): Promise<{ ok: true; slideId: string } | { ok: false; notice: string }> {
  const slide = env.snapshot.presentation.slides[slideId];
  const insertAt = env.snapshot.presentation.slideOrder.indexOf(slide.id) + 1;

  const idMap = new Map<string, string>();
  const elements: Slide['elements'] = {};
  for (const elementId of slide.elementOrder) {
    const element = slide.elements[elementId];
    const newId = crypto.randomUUID();
    idMap.set(elementId, newId);
    elements[newId] = { ...element, id: newId };
  }
  const copy: Slide = {
    ...slide,
    id: crypto.randomUUID(),
    name: `${slide.name} copy`,
    elementOrder: slide.elementOrder.map((id) => idMap.get(id)!),
    elements,
  };

  const result = await dispatchHuman(env, `Duplicated ${slide.name}`, [
    { type: 'create_slide', slide: copy, insertAt },
  ]);
  if (!result.ok) {
    return result;
  }
  return { ok: true, slideId: copy.id };
}

/**
 * Delete a slide plus its comments in one atomic batch. The kernel rejects
 * the final slide; focus re-derivation stays with the store.
 */
export async function deleteSlide(env: CommandEnv, slideId: string): Promise<CommandResult> {
  const slide = env.snapshot.presentation.slides[slideId];
  const operations: PresentationOperation[] = Object.values(env.snapshot.comments)
    .filter((comment) => comment.slideId === slide.id)
    .map((comment) => ({ type: 'remove_comment' as const, commentId: comment.id, expectedComment: comment }));
  operations.push({ type: 'delete_slide', slideId: slide.id, expectedSlide: slide });
  return dispatchHuman(env, `Deleted ${slideDisplayName(slide)}`, operations);
}

/** Delete several elements plus their attached comments in one atomic batch. */
export async function deleteElements(env: CommandEnv, elementIds: readonly string[]): Promise<CommandResult> {
  const slide = env.snapshot.presentation.slides[env.slideId];
  const operations: PresentationOperation[] = [];
  for (const elementId of elementIds) {
    const element = slide.elements[elementId];
    if (!element || element.locked) {
      continue;
    }
    for (const comment of Object.values(env.snapshot.comments)) {
      if (comment.slideId === slide.id && comment.elementId === elementId) {
        operations.push({ type: 'remove_comment', commentId: comment.id, expectedComment: comment });
      }
    }
    operations.push({ type: 'delete_element', slideId: slide.id, elementId, expectedElement: element });
  }
  if (operations.length === 0) {
    return { ok: false, notice: 'Nothing to delete.' };
  }
  return dispatchHuman(
    env,
    elementIds.length === 1
      ? `Deleted ${slide.elements[elementIds[0]]?.name ?? 'an element'}`
      : `Deleted ${elementIds.length} elements`,
    operations,
  );
}

const DUPLICATE_OFFSET = 24;

function duplicateFrame(frame: Frame): Frame {
  return {
    x: clamp(frame.x + DUPLICATE_OFFSET, 0, Math.max(0, SLIDE_WIDTH - frame.width)),
    y: clamp(frame.y + DUPLICATE_OFFSET, 0, Math.max(0, SLIDE_HEIGHT - frame.height)),
    width: frame.width,
    height: frame.height,
  };
}

/**
 * Duplicate the selected elements as fresh unlocked copies offset on the
 * canvas; returns the new element ids in selection order. Each copy is
 * inserted directly above its own original, so the copies keep the
 * originals' relative z-order. Insertion indexes are derived from a working
 * copy of the element order because every create_element shifts the order
 * before the next one is applied; computing every index from the original
 * order would place later copies before their originals.
 */
export async function duplicateElements(
  env: CommandEnv,
  elementIds: readonly string[],
): Promise<{ ok: true; newIds: string[] } | { ok: false; notice: string }> {
  const slide = env.snapshot.presentation.slides[env.slideId];
  const originals = elementIds
    .map((elementId) => slide.elements[elementId])
    .filter((element): element is PresentationElement => element !== undefined)
    .sort(
      (left, right) =>
        slide.elementOrder.indexOf(left.id) - slide.elementOrder.indexOf(right.id),
    );
  if (originals.length === 0) {
    return { ok: false, notice: 'Nothing to duplicate.' };
  }

  const operations: PresentationOperation[] = [];
  const workingOrder = [...slide.elementOrder];
  const copiesById = new Map<string, string>();
  for (const element of originals) {
    const copy: PresentationElement = {
      ...element,
      id: crypto.randomUUID(),
      name: `${element.name} copy`,
      frame: duplicateFrame(element.frame),
      locked: false,
    };
    const insertAt = workingOrder.indexOf(element.id) + 1;
    workingOrder.splice(insertAt, 0, copy.id);
    operations.push({
      type: 'create_element',
      slideId: env.slideId,
      element: copy,
      insertAt,
    });
    copiesById.set(element.id, copy.id);
  }

  const result = await dispatchHuman(
    env,
    originals.length === 1
      ? `Duplicated ${originals[0].name}`
      : `Duplicated ${originals.length} elements`,
    operations,
  );
  if (!result.ok) {
    return result;
  }
  return { ok: true, newIds: elementIds.map((id) => copiesById.get(id)).filter((id): id is string => id !== undefined) };
}

export type Alignment = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';

const ALIGNMENT_LABELS: Record<Alignment, string> = {
  left: 'Align left',
  centerX: 'Align horizontally',
  right: 'Align right',
  top: 'Align top',
  centerY: 'Align vertically',
  bottom: 'Align bottom',
};

/** Slide bounds in presentation coordinates; the single-element reference. */
const SLIDE_BOUNDS: SelectionBox = { left: 0, right: SLIDE_WIDTH, top: 0, bottom: SLIDE_HEIGHT, centerX: SLIDE_WIDTH / 2, centerY: SLIDE_HEIGHT / 2 };

interface SelectionBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

/** The bounding box of the given frames, preserving every element's size. */
function selectionBox(frames: readonly Frame[]): SelectionBox {
  let left = frames[0].x;
  let right = frames[0].x + frames[0].width;
  let top = frames[0].y;
  let bottom = frames[0].y + frames[0].height;
  for (let index = 1; index < frames.length; index++) {
    const frame = frames[index];
    left = Math.min(left, frame.x);
    right = Math.max(right, frame.x + frame.width);
    top = Math.min(top, frame.y);
    bottom = Math.max(bottom, frame.y + frame.height);
  }
  return { left, right, top, bottom, centerX: (left + right) / 2, centerY: (top + bottom) / 2 };
}

function alignedFrame(frame: Frame, box: SelectionBox, alignment: Alignment): Frame {
  const next: Frame = { ...frame };
  switch (alignment) {
    case 'left':
      next.x = box.left;
      break;
    case 'centerX':
      next.x = Math.round(box.centerX - frame.width / 2);
      break;
    case 'right':
      next.x = box.right - frame.width;
      break;
    case 'top':
      next.y = box.top;
      break;
    case 'centerY':
      next.y = Math.round(box.centerY - frame.height / 2);
      break;
    case 'bottom':
      next.y = box.bottom - frame.height;
      break;
  }
  return next;
}

/**
 * Align the selected elements' edges and centers in one atomic guarded
 * batch. Locked elements never move; the alignment reference is the slide
 * bounds when exactly one unlocked element is selected, and otherwise the
 * bounding box of every selected element (locked ones included), which
 * preserves each element's size and always lies inside the slide bounds — so
 * aligning to it never pushes an element off-slide. No revision change
 * results when nothing would move.
 */
export async function alignElements(env: CommandEnv, elementIds: readonly string[], alignment: Alignment): Promise<CommandResult> {
  const slide = env.snapshot.presentation.slides[env.slideId];
  const selected = elementIds
    .map((elementId) => slide.elements[elementId])
    .filter((element): element is PresentationElement => element !== undefined);
  if (selected.length === 0) {
    return { ok: false, notice: 'Nothing to align.' };
  }
  const unlocked = selected.filter((element) => !element.locked);
  if (unlocked.length === 0) {
    return { ok: false, notice: 'Nothing to align.' };
  }

  const box = unlocked.length === 1 ? SLIDE_BOUNDS : selectionBox(selected.map((element) => element.frame));
  const operations: PresentationOperation[] = [];
  for (const element of unlocked) {
    const frame = alignedFrame(element.frame, box, alignment);
    if (framesEqual(frame, element.frame)) {
      continue;
    }
    operations.push({
      type: 'update_frame',
      slideId: env.slideId,
      elementId: element.id,
      frame,
      expectedFrame: element.frame,
    });
  }
  if (operations.length === 0) {
    return { ok: false, notice: 'Nothing to align.' };
  }
  return dispatchHuman(env, ALIGNMENT_LABELS[alignment], operations);
}

/**
 * Commit one or more element frame updates atomically. Each target carries
 * the optimistic guard it was read from, so the whole batch is rejected when
 * any target moved elsewhere.
 */
export async function updateFrameElements(
  env: CommandEnv,
  label: string,
  targets: ReadonlyArray<{ elementId: string; expected: Frame; next: Frame }>,
): Promise<CommandResult> {
  const operations: PresentationOperation[] = [];
  for (const target of targets) {
    if (framesEqual(target.next, target.expected)) {
      continue;
    }
    operations.push({
      type: 'update_frame',
      slideId: env.slideId,
      elementId: target.elementId,
      frame: target.next,
      expectedFrame: target.expected,
    });
  }
  if (operations.length === 0) {
    return { ok: true };
  }
  return dispatchHuman(env, label, operations);
}

/** Replace one text element's full content with an optimistic guard. */
export async function updateText(env: CommandEnv, element: TextElement, text: string): Promise<CommandResult> {
  if (text === element.text) {
    return { ok: true };
  }
  const result = await dispatchHuman(env, `Edited ${element.name}`, [
    {
      type: 'update_text',
      slideId: env.slideId,
      elementId: element.id,
      text,
      expectedText: element.text,
    },
  ]);
  if (!result.ok) {
    return { ok: false, notice: 'That text changed before your edit was applied. Please review and try again.' };
  }
  return { ok: true };
}

/** Field-exact style comparison; mirrors the canonical kernel's own check. */
function sameTextStyle(left: TextStyle, right: TextStyle): boolean {
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

/**
 * Replace one text element's complete style atomically, guarded by the
 * style read at call time. The style is the exact canonical replacement:
 * every field the kernel stores is overwritten by the new value.
 */
export async function updateTextStyle(env: CommandEnv, element: TextElement, style: TextStyle): Promise<CommandResult> {
  if (sameTextStyle(element.style, style)) {
    return { ok: true };
  }
  const result = await dispatchHuman(env, `Restyled ${element.name}`, [
    {
      type: 'update_text_style',
      slideId: env.slideId,
      elementId: element.id,
      style,
      expectedStyle: element.style,
    },
  ]);
  if (!result.ok) {
    return { ok: false, notice: 'That style change could not be applied. Please review and try again.' };
  }
  return { ok: true };
}

/**
 * Replace one shape's complete canonical style atomically, guarded by the
 * style read at call time. The style is the exact canonical replacement:
 * geometry, fill, and stroke are overwritten as one value. Equality is the
 * kernel's own; no second comparison is implemented here.
 */
export async function updateShapeStyle(env: CommandEnv, element: ShapeElement, style: ShapeStyle): Promise<CommandResult> {
  if (shapeStyleMatches(element.style, style)) {
    return { ok: true };
  }
  const result = await dispatchHuman(env, `Restyled ${element.name}`, [
    {
      type: 'update_shape_style',
      slideId: env.slideId,
      elementId: element.id,
      style,
      expectedStyle: element.style,
    },
  ]);
  if (!result.ok) {
    return { ok: false, notice: 'That style change could not be applied. Please review and try again.' };
  }
  return { ok: true };
}

// --- Element z-order ----------------------------------------------------------------------

export type ElementOrderDirection = 'front' | 'forward' | 'backward' | 'back';

const ORDER_LABELS: Record<ElementOrderDirection, string> = {
  front: 'Brought to front',
  forward: 'Brought forward',
  backward: 'Sent backward',
  back: 'Sent to back',
};

/**
 * Reorder selected elements to the front/back or one step toward it. Only
 * unlocked elements move; a step never crosses a locked element, and a
 * multi-element move keeps the elements' relative z-order. The dispatched
 * order is an exact permutation of the slide's order, guarded by the order
 * read at call time.
 */
export async function reorderElements(
  env: CommandEnv,
  elementIds: readonly string[],
  direction: ElementOrderDirection,
): Promise<CommandResult> {
  const slide = env.snapshot.presentation.slides[env.slideId];
  const order = slide.elementOrder;
  const isLocked = (elementId: string): boolean => slide.elements[elementId]?.locked === true;
  const targets = elementIds.filter((elementId) => slide.elements[elementId] && !isLocked(elementId));
  if (targets.length === 0) {
    return { ok: false, notice: 'Nothing to reorder.' };
  }

  const next = computeNextOrder(order, targets, direction, isLocked);
  if (next.every((elementId, index) => elementId === order[index])) {
    return { ok: false, notice: 'The selected elements are already in that position.' };
  }
  return dispatchHuman(env, ORDER_LABELS[direction], [
    {
      type: 'update_element_order',
      slideId: env.slideId,
      elementOrder: next,
      expectedElementOrder: order,
    },
  ]);
}

/**
 * Compute the next back-to-front order (index 0 is behind, the final index
 * is front). Moves are scoped to contiguous unlocked runs bounded by locked
 * elements, so locked elements keep their exact indices and act as barriers
 * that selected elements never cross. One-step commands treat the selected
 * elements as one block: the whole selection rotates one position toward
 * the end (forward) or toward index 0 (backward), so every selected element
 * moves exactly one index and keeps its relative order; the move is skipped
 * when the block has no room at its edge.
 */
function computeNextOrder(
  order: readonly string[],
  targets: readonly string[],
  direction: ElementOrderDirection,
  isLocked: (elementId: string) => boolean,
): string[] {
  const targetSet = new Set(targets);
  const next = [...order];
  let segmentStart = 0;
  while (segmentStart < next.length) {
    if (isLocked(next[segmentStart])) {
      segmentStart++;
      continue;
    }
    let segmentEnd = segmentStart;
    while (segmentEnd < next.length && !isLocked(next[segmentEnd])) {
      segmentEnd++;
    }
    reorderSegment(next, segmentStart, segmentEnd, targetSet, direction);
    segmentStart = segmentEnd;
  }
  return next;
}

/** First selected position within an unlocked run, or -1 when none. */
function firstTargetIndex(segment: readonly string[], targetSet: ReadonlySet<string>): number {
  return segment.findIndex((elementId) => targetSet.has(elementId));
}

/** Last selected position within an unlocked run, or -1 when none. */
function lastTargetIndex(segment: readonly string[], targetSet: ReadonlySet<string>): number {
  for (let index = segment.length - 1; index >= 0; index--) {
    if (targetSet.has(segment[index])) {
      return index;
    }
  }
  return -1;
}

/** Reorder one unlocked run in place; locked barriers are never touched. */
function reorderSegment(
  next: string[],
  segmentStart: number,
  segmentEnd: number,
  targetSet: ReadonlySet<string>,
  direction: ElementOrderDirection,
): void {
  const segment = next.slice(segmentStart, segmentEnd);
  const first = firstTargetIndex(segment, targetSet);
  if (first === -1) {
    return;
  }
  const last = lastTargetIndex(segment, targetSet);

  if (direction === 'forward') {
    // The block swaps with the element directly in front of it: rotate the
    // run from the first selected element through that neighbor right by one.
    if (last + 1 >= segment.length) {
      return;
    }
    const neighbor = segment[last + 1];
    for (let index = last; index >= first; index--) {
      segment[index + 1] = segment[index];
    }
    segment[first] = neighbor;
  } else if (direction === 'backward') {
    // The block swaps with the element directly behind it: rotate the run
    // from that neighbor through the last selected element left by one.
    if (first - 1 < 0) {
      return;
    }
    const neighbor = segment[first - 1];
    for (let index = first; index <= last; index++) {
      segment[index - 1] = segment[index];
    }
    segment[last] = neighbor;
  } else if (direction === 'front') {
    // The selected elements move to the front of the run, in relative order.
    const selected = segment.filter((elementId) => targetSet.has(elementId));
    const rest = segment.filter((elementId) => !targetSet.has(elementId));
    segment.splice(0, segment.length, ...rest, ...selected);
  } else {
    // The selected elements move to the back of the run, in relative order.
    const selected = segment.filter((elementId) => targetSet.has(elementId));
    const rest = segment.filter((elementId) => !targetSet.has(elementId));
    segment.splice(0, segment.length, ...selected, ...rest);
  }
  next.splice(segmentStart, segment.length, ...segment);
}

// --- Slide properties -------------------------------------------------------------------------

export interface SlidePropertiesPatch {
  name?: string;
  background?: string;
  /** Explicit notes replacement; `null` clears the notes, omission keeps them unchanged. */
  notes?: string | null;
}

/**
 * Update a slide's name, background, or notes as one complete guarded
 * replacement. The operation always carries the full name/background, the
 * notes value (explicitly preserved when untouched), and expected guards for
 * every field, so the kernel rejects a stale write instead of clobbering.
 */
export async function updateSlideProperties(env: CommandEnv, slide: Slide, patch: SlidePropertiesPatch): Promise<CommandResult> {
  const name = patch.name ?? slide.name;
  const background = patch.background ?? slide.background;
  const notes = patch.notes !== undefined ? (patch.notes ?? undefined) : slide.notes;

  if (name === slide.name && background === slide.background && notes === slide.notes) {
    return { ok: true };
  }
  const result = await dispatchHuman(env, `Updated ${slideDisplayName(slide)}`, [
    {
      type: 'update_slide',
      slideId: slide.id,
      name,
      background,
      notes,
      expectedName: slide.name,
      expectedBackground: slide.background,
      expectedNotes: slide.notes,
    },
  ]);
  if (!result.ok) {
    return { ok: false, notice: 'That slide change could not be applied. Please review and try again.' };
  }
  return { ok: true };
}