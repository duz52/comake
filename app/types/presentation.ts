/**
 * Canonical presentation model and command vocabulary.
 *
 * This module owns type declarations only: no React, browser, storage, or
 * side-effect code. Behavior lives in `app/lib/presentation/`.
 */

export type Actor =
  | { id: 'jerry'; kind: 'human'; name: 'Jerry' }
  | { id: 'gpt'; kind: 'agent'; name: 'GPT' }
  | { id: 'system'; kind: 'system'; name: 'Comake' };

/** Strict `#RRGGBB` hex color; the only color form the canonical model accepts. */
export type HexColor = string;

export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextStyle {
  align?: 'left' | 'center' | 'right';
  color: HexColor;
  fontFamily: string;
  fontSize: number;
  fontWeight?: 400 | 500 | 600 | 700 | 800;
  letterSpacing?: number;
  lineHeight?: number;
  textTransform?: 'none' | 'uppercase';
}

interface ElementBase {
  id: string;
  frame: Frame;
  locked?: boolean;
  name: string;
  rotation?: number;
}

export interface TextElement extends ElementBase {
  kind: 'text';
  style: TextStyle;
  text: string;
}

/**
 * Intrinsic geometry parameters of a shape. The variant owns its parameters:
 * only `rectangle` has a corner radius, so no shape can carry a meaningless one.
 * `cornerRadius` is the authored radius in slide points (finite, ≥ 0); the
 * effective rendered radius is `effectiveCornerRadius` (one kernel helper).
 */
export type ShapeGeometry =
  | { kind: 'rectangle'; cornerRadius: number }
  | { kind: 'diamond' }
  | { kind: 'ellipse' }
  | { kind: 'triangle' };

/**
 * Canonical fill paint. `none` is the explicit no-fill; a solid paint is a
 * strict hex color at a fractional opacity in (0, 1] — a fully transparent
 * fill is `none`, never `opacity: 0`.
 */
export type ShapeFill =
  | { kind: 'none' }
  | { kind: 'solid'; color: HexColor; opacity: number };

/** Canonical dash pattern of a solid stroke. */
export type StrokeDash = 'solid' | 'dash' | 'dot';

/**
 * Canonical stroke paint. `none` is the explicit no-outline; a solid stroke
 * has a strict hex color, opacity in (0, 1], width in slide points (> 0), and
 * a dash pattern. A zero-width stroke is `none`, never `width: 0`.
 */
export type ShapeStroke =
  | { kind: 'none' }
  | {
      kind: 'solid';
      color: HexColor;
      dash: StrokeDash;
      opacity: number;
      width: number;
    };

/** The complete canonical appearance of a shape; replaced only as a whole. */
export interface ShapeStyle {
  fill: ShapeFill;
  geometry: ShapeGeometry;
  stroke: ShapeStroke;
}

export interface ShapeElement extends ElementBase {
  kind: 'shape';
  style: ShapeStyle;
}

export type PresentationElement = TextElement | ShapeElement;

export interface Slide {
  background: HexColor;
  elementOrder: string[];
  elements: Record<string, PresentationElement>;
  id: string;
  name: string;
  notes?: string;
}

export interface Presentation {
  id: string;
  revision: number;
  size: {
    height: number;
    width: number;
  };
  slideOrder: string[];
  slides: Record<string, Slide>;
  title: string;
}

export interface Comment {
  actor: Actor;
  body: string;
  createdAt: string;
  elementId?: string;
  id: string;
  resolved: boolean;
  slideId: string;
}

/**
 * The only mutation vocabulary for the UI and the WebMCP contract.
 */
export type PresentationOperation =
  | {
      elementId: string;
      expectedText?: string;
      slideId: string;
      text: string;
      type: 'update_text';
    }
  | {
      elementId: string;
      expectedStyle?: TextStyle;
      slideId: string;
      style: TextStyle;
      type: 'update_text_style';
    }
  | {
      elementId: string;
      expectedFrame?: Frame;
      frame: Frame;
      slideId: string;
      type: 'update_frame';
    }
  | {
      elementId: string;
      /** Optimistic guard: the complete shape style read before editing. */
      expectedStyle?: ShapeStyle;
      slideId: string;
      /** The complete replacement shape style; every field is replaced atomically. */
      style: ShapeStyle;
      type: 'update_shape_style';
    }
  | {
      elementOrder: string[];
      expectedElementOrder?: string[];
      slideId: string;
      type: 'update_element_order';
    }
  | {
      background: string;
      expectedBackground?: string;
      expectedName?: string;
      expectedNotes?: string;
      name: string;
      notes?: string;
      slideId: string;
      type: 'update_slide';
    }
  | {
      insertAt?: number;
      slide: Slide;
      type: 'create_slide';
    }
  | {
      expectedSlide?: Slide;
      slideId: string;
      type: 'delete_slide';
    }
  | {
      element: PresentationElement;
      /** Optional zero-based z-position in the slide's element order; omission appends at the top. */
      insertAt?: number;
      slideId: string;
      type: 'create_element';
    }
  | {
      elementId: string;
      expectedElement?: PresentationElement;
      slideId: string;
      type: 'delete_element';
    }
  | {
      comment: Comment;
      type: 'add_comment';
    }
  | {
      commentId: string;
      expectedComment?: Comment;
      type: 'remove_comment';
    }
  | {
      commentId: string;
      expectedResolved?: boolean;
      resolved: boolean;
      type: 'resolve_comment';
    };

export interface ChangeSet {
  actor: Actor;
  createdAt: string;
  id: string;
  inverseOperations: PresentationOperation[];
  label: string;
  operations: PresentationOperation[];
  revision: number;
  revertedAt?: string;
}
