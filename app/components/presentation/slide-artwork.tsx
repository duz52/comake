import type { CSSProperties, PointerEvent } from 'react';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../lib/presentation/deck';
import type { PresentationSnapshot } from '../../lib/presentation/store';
import type {
  Frame,
  PresentationElement,
  ShapeElement,
  TextElement,
} from '../../types/presentation';

export interface DragState {
  elementId: string;
  frame: Frame;
  pointer: { x: number; y: number };
}

function frameStyle(frame: Frame): CSSProperties {
  return {
    left: `${(frame.x / SLIDE_WIDTH) * 100}%`,
    top: `${(frame.y / SLIDE_HEIGHT) * 100}%`,
    width: `${(frame.width / SLIDE_WIDTH) * 100}%`,
    height: `${(frame.height / SLIDE_HEIGHT) * 100}%`,
  };
}

function visibleFrame(element: PresentationElement, drag: DragState | null): Frame {
  return drag?.elementId === element.id ? drag.frame : element.frame;
}

function TextArtwork({
  element,
  selected,
  frame,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  element: TextElement;
  frame: Frame;
  onPointerDown?: (event: PointerEvent<HTMLDivElement>, element: PresentationElement) => void;
  onPointerMove?: (event: PointerEvent<HTMLDivElement>, element: PresentationElement) => void;
  onPointerUp?: (event: PointerEvent<HTMLDivElement>, element: PresentationElement) => void;
  selected?: boolean;
}) {
  const { style } = element;
  return (
    <div
      aria-label={element.name}
      className={`slide-element text-element${selected ? ' is-selected' : ''}`}
      data-element-id={element.id}
      onPointerDown={onPointerDown ? (event) => onPointerDown(event, element) : undefined}
      onPointerMove={onPointerMove ? (event) => onPointerMove(event, element) : undefined}
      onPointerUp={onPointerUp ? (event) => onPointerUp(event, element) : undefined}
      style={{
        ...frameStyle(frame),
        color: style.color,
        fontFamily: style.fontFamily,
        fontSize: `${style.fontSize / 10}cqw`,
        fontWeight: style.fontWeight,
        letterSpacing: style.letterSpacing ? `${style.letterSpacing / 10}cqw` : undefined,
        lineHeight: style.lineHeight,
        textAlign: style.align,
        textTransform: style.textTransform,
      }}
    >
      {element.text}
    </div>
  );
}

function ShapeArtwork({
  element,
  selected,
  frame,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  element: ShapeElement;
  frame: Frame;
  onPointerDown?: (event: PointerEvent<HTMLDivElement>, element: PresentationElement) => void;
  onPointerMove?: (event: PointerEvent<HTMLDivElement>, element: PresentationElement) => void;
  onPointerUp?: (event: PointerEvent<HTMLDivElement>, element: PresentationElement) => void;
  selected?: boolean;
}) {
  return (
    <div
      aria-label={element.name}
      className={`slide-element shape-element${selected ? ' is-selected' : ''}`}
      data-element-id={element.id}
      onPointerDown={onPointerDown ? (event) => onPointerDown(event, element) : undefined}
      onPointerMove={onPointerMove ? (event) => onPointerMove(event, element) : undefined}
      onPointerUp={onPointerUp ? (event) => onPointerUp(event, element) : undefined}
      style={{
        ...frameStyle(frame),
        background: element.fill,
        borderRadius: `${element.radius ?? 0}px`,
      }}
    />
  );
}

export function SlideArtwork({
  snapshot,
  slideId,
  drag,
  interactive = false,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  drag?: DragState | null;
  interactive?: boolean;
  onPointerDown?: (event: PointerEvent<HTMLDivElement>, element: PresentationElement) => void;
  onPointerMove?: (event: PointerEvent<HTMLDivElement>, element: PresentationElement) => void;
  onPointerUp?: (event: PointerEvent<HTMLDivElement>, element: PresentationElement) => void;
  slideId: string;
  snapshot: PresentationSnapshot;
}) {
  const slide = snapshot.presentation.slides[slideId];
  const selectedElementId = interactive ? snapshot.session.selectedElementId : undefined;
  return (
    <div className="slide-artwork" style={{ background: slide.background }}>
      {slide.elementOrder.map((elementId) => {
        const element = slide.elements[elementId];
        const frame = visibleFrame(element, drag ?? null);
        const handlers = interactive
          ? { onPointerDown, onPointerMove, onPointerUp }
          : { onPointerDown: undefined, onPointerMove: undefined, onPointerUp: undefined };
        return element.kind === 'text' ? (
          <TextArtwork
            element={element}
            frame={frame}
            key={element.id}
            selected={selectedElementId === element.id}
            {...handlers}
          />
        ) : (
          <ShapeArtwork
            element={element}
            frame={frame}
            key={element.id}
            selected={selectedElementId === element.id}
            {...handlers}
          />
        );
      })}
    </div>
  );
}
