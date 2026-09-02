import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../lib/presentation/canvas';
import type { Frame } from '../../types/presentation';

/**
 * Browser-only gesture geometry and transaction lifecycle. Preview state
 * never enters the canonical model; the store stays server-authoritative.
 * A changed pointer-up keeps the same preview through `committing` until
 * the atomic frame batch settles. All math runs in canonical slide points
 * (960 x 540, origin top-left).
 */

/** Useful minimum element size in slide points; existing smaller elements keep their size as the floor. */
export const MIN_ELEMENT_WIDTH = 24;
export const MIN_ELEMENT_HEIGHT = 24;

export type GestureKind = 'move' | 'resize';

/** Pointer-owned live preview, or a dropped preview waiting on dispatch. */
export type GesturePhase = 'tracking' | 'committing';

/** The eight compass resize directions; each is anchored on the opposite edge. */
export type ResizeDirection = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export interface SlidePoint {
  x: number;
  y: number;
}

export interface GestureState {
  phase: GesturePhase;
  kind: GestureKind;
  elementId: string;
  elementName: string;
  /** The pointer that owns the gesture; events from other pointers are ignored. */
  pointerId: number;
  /** Pointer position, in slide points, where the gesture began. */
  originPointer: SlidePoint;
  /**
   * Canonical frame the gesture acts on. Captured on the first move — after
   * any pending blur commit in the inspector — so the optimistic guard always
   * matches the frame the pointer is actually working from.
   */
  origin: Frame | null;
  /** Live preview frame; null until the first move. */
  frame: Frame | null;
  /** Latest pointer position; artwork previews every move target from it. */
  pointer: SlidePoint;
  /** Resize direction of a resize gesture; omitted for moves. */
  direction?: ResizeDirection;
  /** Every element a move gesture carries, with captured origin frames. */
  moveTargets?: GestureMoveTarget[];
}

export interface GestureMoveTarget {
  id: string;
  name: string;
  origin: Frame;
}

export function slidePointFromClient(rect: DOMRect, clientX: number, clientY: number): SlidePoint {
  return {
    x: ((clientX - rect.left) / rect.width) * SLIDE_WIDTH,
    y: ((clientY - rect.top) / rect.height) * SLIDE_HEIGHT,
  };
}

export function framesEqual(left: Frame, right: Frame): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

/** Fields captured while tracking; the owner assigns `phase`. */
export type GestureTrackingFields = Omit<GestureState, 'phase'>;

/**
 * The one gesture transaction owner. `null` is idle. `tracking` follows the
 * pointer. `committing` keeps the dropped preview until dispatch settles.
 * A second begin, a move, or a cancel cannot replace a committing gesture.
 */
export function beginGesture(
  current: GestureState | null,
  tracking: GestureTrackingFields,
): GestureState | null {
  if (current !== null) {
    return current;
  }
  return { ...tracking, phase: 'tracking' };
}

export function trackGesture(current: GestureState | null, next: GestureTrackingFields): GestureState | null {
  if (current === null || current.phase !== 'tracking' || next.pointerId !== current.pointerId) {
    return current;
  }
  return { ...next, phase: 'tracking' };
}

export function releaseGesture(
  current: GestureState | null,
  pointerId: number,
): { commit: true; gesture: GestureState } | { commit: false; gesture: GestureState | null } {
  if (current === null || current.phase !== 'tracking' || current.pointerId !== pointerId) {
    return { commit: false, gesture: current };
  }
  const changed =
    current.origin !== null && current.frame !== null && !framesEqual(current.frame, current.origin);
  if (!changed) {
    return { commit: false, gesture: null };
  }
  return { commit: true, gesture: { ...current, phase: 'committing' } };
}

export function cancelGesture(current: GestureState | null, pointerId: number): GestureState | null {
  if (current === null || current.phase !== 'tracking' || current.pointerId !== pointerId) {
    return current;
  }
  return null;
}

export function settleGesture(current: GestureState | null): GestureState | null {
  if (current === null || current.phase !== 'committing') {
    return current;
  }
  return null;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundFrame(frame: Frame): Frame {
  return {
    x: Math.round(frame.x),
    y: Math.round(frame.y),
    width: Math.round(frame.width),
    height: Math.round(frame.height),
  };
}

function containsEast(direction: ResizeDirection): boolean {
  return direction === 'e' || direction === 'ne' || direction === 'se';
}

function containsWest(direction: ResizeDirection): boolean {
  return direction === 'w' || direction === 'nw' || direction === 'sw';
}

function containsSouth(direction: ResizeDirection): boolean {
  return direction === 's' || direction === 'se' || direction === 'sw';
}

function containsNorth(direction: ResizeDirection): boolean {
  return direction === 'n' || direction === 'ne' || direction === 'nw';
}

/**
 * Live resize preview from one of the eight handles. The edge opposite the
 * handle stays fixed (the anchor), widths and heights stay within
 * [min, slide bounds measured from the anchor], and the result is rounded to
 * whole slide points so the committed frame keeps integer coordinates.
 */
export function resizeGestureFrame(
  origin: Frame,
  pointer: SlidePoint,
  direction: ResizeDirection,
): Frame {
  const minWidth = Math.min(MIN_ELEMENT_WIDTH, origin.width);
  const minHeight = Math.min(MIN_ELEMENT_HEIGHT, origin.height);
  const right = origin.x + origin.width;
  const bottom = origin.y + origin.height;

  let x = origin.x;
  let y = origin.y;
  let width = origin.width;
  let height = origin.height;
  if (containsEast(direction)) {
    width = clamp(pointer.x - x, minWidth, SLIDE_WIDTH - x);
  }
  if (containsWest(direction)) {
    width = clamp(right - pointer.x, minWidth, right);
    x = right - width;
  }
  if (containsSouth(direction)) {
    height = clamp(pointer.y - y, minHeight, SLIDE_HEIGHT - y);
  }
  if (containsNorth(direction)) {
    height = clamp(bottom - pointer.y, minHeight, bottom);
    y = bottom - height;
  }
  return roundFrame({ x, y, width, height });
}

/** Live move preview: translate the origin frame by the pointer delta, clamped to the canvas. */
export function moveGestureFrame(origin: Frame, originPointer: SlidePoint, pointer: SlidePoint): Frame {
  const frame = roundFrame({
    x: origin.x + (pointer.x - originPointer.x),
    y: origin.y + (pointer.y - originPointer.y),
    width: origin.width,
    height: origin.height,
  });
  return {
    ...frame,
    x: clamp(frame.x, 0, Math.max(0, SLIDE_WIDTH - frame.width)),
    y: clamp(frame.y, 0, Math.max(0, SLIDE_HEIGHT - frame.height)),
  };
}

export function gesturePreviewFrame(
  kind: GestureKind,
  origin: Frame,
  originPointer: SlidePoint,
  pointer: SlidePoint,
  direction?: ResizeDirection,
): Frame {
  return kind === 'move'
    ? moveGestureFrame(origin, originPointer, pointer)
    : resizeGestureFrame(origin, pointer, direction ?? 'se');
}

/**
 * The frame to render for one element: live or committing move targets are
 * recomputed from captured origins; a resize preview uses the stored frame.
 * Without a gesture the canonical frame is shown.
 */
export function elementPreviewFrame(
  element: { id: string; frame: Frame },
  gesture: GestureState | null,
): Frame {
  if (gesture?.kind === 'move' && gesture.moveTargets) {
    const target = gesture.moveTargets.find((entry) => entry.id === element.id);
    if (target) {
      return moveGestureFrame(target.origin, gesture.originPointer, gesture.pointer);
    }
  }
  if (gesture && gesture.elementId === element.id && gesture.frame) {
    return gesture.frame;
  }
  return element.frame;
}

/** Canonical frame writes implied by a captured gesture; empty when there is no preview yet. */
export function gestureCommitTargets(
  gesture: GestureState,
): ReadonlyArray<{ elementId: string; expected: Frame; next: Frame }> {
  if (!gesture.origin || !gesture.frame) {
    return [];
  }
  if (gesture.kind === 'move' && gesture.moveTargets) {
    return gesture.moveTargets.map((target) => ({
      elementId: target.id,
      expected: target.origin,
      next: gesturePreviewFrame('move', target.origin, gesture.originPointer, gesture.pointer),
    }));
  }
  return [{ elementId: gesture.elementId, expected: gesture.origin, next: gesture.frame }];
}

/**
 * Keyboard resize step for a handle: the directional arrow keys move that
 * handle's edges, so the opposite anchor edge never moves. The returned
 * delta is in width/height growth (positive = larger).
 */
export function keyboardResizeDelta(
  direction: ResizeDirection,
  key: string,
  distance: number,
): [number, number] {
  let deltaWidth = 0;
  let deltaHeight = 0;
  if (key === 'ArrowRight') {
    deltaWidth = containsEast(direction) ? distance : containsWest(direction) ? -distance : 0;
  } else if (key === 'ArrowLeft') {
    deltaWidth = containsWest(direction) ? distance : containsEast(direction) ? -distance : 0;
  } else if (key === 'ArrowDown') {
    deltaHeight = containsSouth(direction) ? distance : containsNorth(direction) ? -distance : 0;
  } else if (key === 'ArrowUp') {
    deltaHeight = containsNorth(direction) ? distance : containsSouth(direction) ? -distance : 0;
  }
  return [deltaWidth, deltaHeight];
}

/** Keyboard resize step from one of the eight handles; the opposite edge stays fixed. */
export function keyboardResizeFrame(
  frame: Frame,
  deltaWidth: number,
  deltaHeight: number,
  direction: ResizeDirection,
): Frame {
  const minWidth = Math.min(MIN_ELEMENT_WIDTH, frame.width);
  const minHeight = Math.min(MIN_ELEMENT_HEIGHT, frame.height);
  const right = frame.x + frame.width;
  const bottom = frame.y + frame.height;

  let x = frame.x;
  let y = frame.y;
  let width = frame.width;
  let height = frame.height;
  if (containsEast(direction)) {
    width = clamp(frame.width + deltaWidth, minWidth, SLIDE_WIDTH - frame.x);
  }
  if (containsWest(direction)) {
    width = clamp(frame.width + deltaWidth, minWidth, right);
    x = right - width;
  }
  if (containsSouth(direction)) {
    height = clamp(frame.height + deltaHeight, minHeight, SLIDE_HEIGHT - frame.y);
  }
  if (containsNorth(direction)) {
    height = clamp(frame.height + deltaHeight, minHeight, bottom);
    y = bottom - height;
  }
  return { x, y, width, height };
}

/** Keyboard nudge; negative deltas move up/left. Clamped to the canvas. */
export function keyboardMoveFrame(frame: Frame, deltaX: number, deltaY: number): Frame {
  return {
    ...frame,
    x: clamp(frame.x + deltaX, 0, Math.max(0, SLIDE_WIDTH - frame.width)),
    y: clamp(frame.y + deltaY, 0, Math.max(0, SLIDE_HEIGHT - frame.height)),
  };
}

/** Center a new element on a canvas point, clamped fully inside the canvas. */
export function centeredFrame(point: SlidePoint, width: number, height: number): Frame {
  return {
    x: Math.round(clamp(point.x - width / 2, 0, SLIDE_WIDTH - width)),
    y: Math.round(clamp(point.y - height / 2, 0, SLIDE_HEIGHT - height)),
    width,
    height,
  };
}

/** Inclusive bounds for the inspector frame fields, derived from the current frame. */
export function frameFieldBounds(frame: Frame): Record<keyof Frame, [number, number]> {
  const minWidth = Math.min(MIN_ELEMENT_WIDTH, frame.width);
  const minHeight = Math.min(MIN_ELEMENT_HEIGHT, frame.height);
  return {
    x: [0, Math.max(0, SLIDE_WIDTH - frame.width)],
    y: [0, Math.max(0, SLIDE_HEIGHT - frame.height)],
    width: [minWidth, Math.max(minWidth, SLIDE_WIDTH - frame.x)],
    height: [minHeight, Math.max(minHeight, SLIDE_HEIGHT - frame.y)],
  };
}