import type { CSSProperties, FocusEvent, KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from 'react';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../lib/presentation/canvas';
import type { PresentationSnapshot } from '../../lib/presentation/store';
import type { Frame, PresentationElement } from '../../types/presentation';
import { elementPreviewFrame, type GestureState, type ResizeDirection } from './gesture';
import { ShapeSvg } from './shape-svg';

function frameStyle(frame: Frame): CSSProperties {
  return {
    left: `${(frame.x / SLIDE_WIDTH) * 100}%`,
    top: `${(frame.y / SLIDE_HEIGHT) * 100}%`,
    width: `${(frame.width / SLIDE_WIDTH) * 100}%`,
    height: `${(frame.height / SLIDE_HEIGHT) * 100}%`,
  };
}

function elementStyle(element: PresentationElement, frame: Frame): CSSProperties {
  let base: CSSProperties;
  if (element.kind === 'text') {
    const { style } = element;
    base = {
      ...frameStyle(frame),
      color: style.color,
      fontFamily: style.fontFamily,
      // Font metrics are canonical slide-points against the 960pt width:
      // `(n / 960) * 100cqw` is the exact proportional value.
      fontSize: `${(style.fontSize / SLIDE_WIDTH) * 100}cqw`,
      fontWeight: style.fontWeight,
      letterSpacing: style.letterSpacing ? `${(style.letterSpacing / SLIDE_WIDTH) * 100}cqw` : undefined,
      lineHeight: style.lineHeight,
      textAlign: style.align,
      textTransform: style.textTransform,
    };
  } else {
    base = frameStyle(frame);
  }
  // Canonical rotation renders about the frame center in clockwise degrees,
  // the same semantics the PPTX exporter writes as `rot`.
  if (element.rotation) {
    return { ...base, transform: `rotate(${element.rotation}deg)` };
  }
  return base;
}

const RESIZE_HANDLES: ReadonlyArray<{ direction: ResizeDirection; label: string }> = [
  { direction: 'nw', label: 'north-west' },
  { direction: 'n', label: 'north' },
  { direction: 'ne', label: 'north-east' },
  { direction: 'e', label: 'east' },
  { direction: 'se', label: 'south-east' },
  { direction: 's', label: 'south' },
  { direction: 'sw', label: 'south-west' },
  { direction: 'w', label: 'west' },
];

function ResizeHandle({
  direction,
  element,
  label,
  onKeyDown,
  onPointerDown,
}: {
  direction: ResizeDirection;
  element: PresentationElement;
  label: string;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>, element: PresentationElement, direction: ResizeDirection) => void;
  onPointerDown?: (event: PointerEvent<HTMLButtonElement>, element: PresentationElement, direction: ResizeDirection) => void;
}) {
  return (
    <button
      aria-label={`Resize ${element.name} from ${label}`}
      className={`resize-handle resize-handle-${direction}`}
      onKeyDown={onKeyDown ? (event) => onKeyDown(event, element, direction) : undefined}
      onPointerDown={
        onPointerDown
          ? (event) => {
              // The handle owns the gesture; the element below must not start a move.
              event.stopPropagation();
              onPointerDown(event, element, direction);
            }
          : undefined
      }
      type="button"
    />
  );
}

interface ElementArtworkProps {
  element: PresentationElement;
  frame: Frame;
  selected: boolean;
  primary: boolean;
  /** The active inline text edit surface for this element, if any. */
  inlineEditor?: ReactNode;
  showResizeHandles: boolean;
  onElementFocus?: (elementId: string) => void;
  onElementPointerDown?: (event: PointerEvent<HTMLDivElement>, element: PresentationElement) => void;
  onGesturePointerCancel?: (event: PointerEvent<HTMLElement>) => void;
  onGesturePointerMove?: (event: PointerEvent<HTMLElement>) => void;
  onGesturePointerUp?: (event: PointerEvent<HTMLElement>) => void;
  onResizeKeyDown?: (event: KeyboardEvent<HTMLButtonElement>, element: PresentationElement, direction: ResizeDirection) => void;
  onResizePointerDown?: (event: PointerEvent<HTMLButtonElement>, element: PresentationElement, direction: ResizeDirection) => void;
  /** Open the inline editor; the caret point comes from a double-click, null from the keyboard. */
  onStartEditing?: (elementId: string, caretPoint: { clientX: number; clientY: number } | null) => void;
}

function ElementArtwork({
  element,
  frame,
  selected,
  primary,
  inlineEditor,
  showResizeHandles,
  onElementFocus,
  onElementPointerDown,
  onGesturePointerCancel,
  onGesturePointerMove,
  onGesturePointerUp,
  onResizeKeyDown,
  onResizePointerDown,
  onStartEditing,
}: ElementArtworkProps) {
  // Double-click and Enter/F2 open the inline editor on unlocked text.
  const editableText = !inlineEditor && element.kind === 'text' && !element.locked;
  return (
    <div
      aria-label={`${element.name}, ${element.kind} element`}
      className={`slide-element ${element.kind}-element${selected ? ' is-selected' : ''}${primary ? ' is-primary' : ''}${element.locked ? ' is-locked' : ''}${inlineEditor ? ' is-editing' : ''}`}
      data-element-id={element.id}
      onDoubleClick={
        editableText
          ? (event: MouseEvent) => {
              // The resize handles are controls, not text surface: a
              // double-click on a handle must not open the editor.
              if (event.target instanceof HTMLElement && event.target.closest('.resize-handle')) {
                return;
              }
              onStartEditing?.(element.id, { clientX: event.clientX, clientY: event.clientY });
            }
          : undefined
      }
      onFocus={onElementFocus ? (event: FocusEvent<HTMLDivElement>) => onElementFocus(element.id) : undefined}
      onKeyDown={
        editableText && onStartEditing
          ? (event: KeyboardEvent<HTMLDivElement>) => {
              if (event.key === 'Enter' || event.key === 'F2') {
                event.preventDefault();
                event.stopPropagation();
                onStartEditing(element.id, null);
              }
            }
          : undefined
      }
      onPointerDown={
        onElementPointerDown
          ? // No preventDefault: CanvasStage blurs the focused inspector field
            // before mutating the selection, so its draft commits against the
            // element it was editing, and the browser's mousedown focus shift
            // still lands on the clicked element. Pointer focus never matches
            // :focus-visible, so mouse selection shows no ring.
            (event) => onElementPointerDown(event, element)
          : undefined
      }
      onPointerMove={onGesturePointerMove}
      onPointerUp={onGesturePointerUp}
      style={elementStyle(element, frame)}
      tabIndex={onElementPointerDown ? 0 : undefined}
    >
      {inlineEditor ??
        (element.kind === 'shape' ? (
          <ShapeSvg element={element} frame={frame} />
        ) : (
          element.text
        ))}
      {showResizeHandles ? (
        RESIZE_HANDLES.map(({ direction, label }) => (
          <ResizeHandle
            direction={direction}
            element={element}
            key={direction}
            label={label}
            onKeyDown={onResizeKeyDown}
            onPointerDown={onResizePointerDown}
          />
        ))
      ) : null}
    </div>
  );
}

export interface SlideArtworkProps {
  /** Live gesture preview; only rendered on the interactive canvas. */
  gesture?: GestureState | null;
  interactive?: boolean;
  /** The element currently being inline-edited; its surface renders in place. */
  editingElementId?: string | null;
  /** The editing surface node for {@link editingElementId}. */
  inlineEditor?: ReactNode | null;
  onElementFocus?: (elementId: string) => void;
  onElementPointerDown?: (event: PointerEvent<HTMLDivElement>, element: PresentationElement) => void;
  onGesturePointerCancel?: (event: PointerEvent<HTMLElement>) => void;
  onGesturePointerMove?: (event: PointerEvent<HTMLElement>) => void;
  onGesturePointerUp?: (event: PointerEvent<HTMLElement>) => void;
  onResizeKeyDown?: (event: KeyboardEvent<HTMLButtonElement>, element: PresentationElement, direction: ResizeDirection) => void;
  onResizePointerDown?: (event: PointerEvent<HTMLButtonElement>, element: PresentationElement, direction: ResizeDirection) => void;
  /** Open the inline editor; the caret point comes from a double-click, null from the keyboard. */
  onStartEditing?: (elementId: string, caretPoint: { clientX: number; clientY: number } | null) => void;
  selectedElementIds?: readonly string[];
  slideId: string;
  snapshot: PresentationSnapshot;
}

/**
 * Renders one slide's canonical elements. On the interactive canvas it also
 * renders the selection outline, the eight resize handles of the primary
 * element, per-element keyboard focus, the inline text editor, and the
 * gesture preview; in thumbnails and Present mode it is a plain,
 * non-interactive rendering.
 */
export function SlideArtwork({
  gesture = null,
  interactive = false,
  editingElementId = null,
  inlineEditor = null,
  onElementFocus,
  onElementPointerDown,
  onGesturePointerCancel,
  onGesturePointerMove,
  onGesturePointerUp,
  onResizeKeyDown,
  onResizePointerDown,
  onStartEditing,
  selectedElementIds = [],
  slideId,
  snapshot,
}: SlideArtworkProps) {
  const slide = snapshot.presentation.slides[slideId];
  return (
    <div aria-hidden={!interactive} className="slide-artwork" style={{ background: slide.background }}>
      {slide.elementOrder.map((elementId) => {
        const element = slide.elements[elementId];
        const selected = interactive && selectedElementIds.includes(element.id);
        const primary = selected && selectedElementIds[0] === element.id;
        const editing = interactive && editingElementId === element.id;
        return (
          <ElementArtwork
            element={element}
            frame={elementPreviewFrame(element, gesture)}
            inlineEditor={editing ? inlineEditor : undefined}
            key={element.id}
            primary={primary}
            selected={selected}
            showResizeHandles={primary && !element.locked && !editing}
            onElementFocus={interactive ? onElementFocus : undefined}
            onElementPointerDown={interactive ? onElementPointerDown : undefined}
            onGesturePointerCancel={interactive ? onGesturePointerCancel : undefined}
            onGesturePointerMove={interactive ? onGesturePointerMove : undefined}
            onGesturePointerUp={interactive ? onGesturePointerUp : undefined}
            onResizeKeyDown={interactive ? onResizeKeyDown : undefined}
            onResizePointerDown={interactive ? onResizePointerDown : undefined}
            onStartEditing={interactive ? onStartEditing : undefined}
          />
        );
      })}
    </div>
  );
}