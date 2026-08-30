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

export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextStyle {
  align?: 'left' | 'center' | 'right';
  color: string;
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

export interface ShapeElement extends ElementBase {
  fill: string;
  kind: 'shape';
  radius?: number;
}

export type PresentationElement = TextElement | ShapeElement;

export interface Slide {
  background: string;
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
      expectedFrame?: Frame;
      frame: Frame;
      slideId: string;
      type: 'update_frame';
    }
  | {
      element: PresentationElement;
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
