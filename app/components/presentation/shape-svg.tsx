import { effectiveCornerRadius } from '../../lib/presentation/document';
import type { Frame, ShapeElement } from '../../types/presentation';

/**
 * The one canvas projection of a canonical shape style: geometry, fill, and
 * stroke paint as a single SVG shape. It consumes the style and the kernel's
 * `effectiveCornerRadius` helper and derives nothing else, so every canonical
 * field — including the stroke dash pattern and opacity — reaches the canvas,
 * and the rendered geometry matches the PPTX preset projection exactly.
 *
 * The frame comes from the caller (the live gesture preview frame during a
 * resize, the canonical frame otherwise) so the shape re-derives its effective
 * radius while resizing without any style write.
 */
export function ShapeSvg({ element, frame }: { element: ShapeElement; frame: Frame }) {
  const { fill, geometry, stroke } = element.style;
  const solidFill = fill.kind === 'solid' ? fill : undefined;
  const solidStroke = stroke.kind === 'solid' ? stroke : undefined;
  const fillProps = solidFill
    ? { fill: solidFill.color, fillOpacity: solidFill.opacity }
    : { fill: 'none' };
  const strokeProps = solidStroke
    ? {
        stroke: solidStroke.color,
        strokeDasharray:
          solidStroke.dash === 'dash'
            ? `${solidStroke.width * 4} ${solidStroke.width * 3}`
            : solidStroke.dash === 'dot'
              ? `0.01 ${solidStroke.width * 2}`
              : undefined,
        strokeOpacity: solidStroke.opacity,
        strokeWidth: solidStroke.width,
        strokeLinecap: solidStroke.dash === 'dot' ? ('round' as const) : undefined,
      }
    : {};

  return (
    <svg height="100%" overflow="visible" viewBox={`0 0 ${frame.width} ${frame.height}`} width="100%">
      {geometry.kind === 'rectangle' ? (
        <rect
          height={frame.height}
          rx={effectiveCornerRadius(frame, geometry)}
          width={frame.width}
          {...fillProps}
          {...strokeProps}
        />
      ) : geometry.kind === 'ellipse' ? (
        <ellipse cx={frame.width / 2} cy={frame.height / 2} rx={frame.width / 2} ry={frame.height / 2} {...fillProps} {...strokeProps} />
      ) : geometry.kind === 'triangle' ? (
        <polygon
          points={`${frame.width / 2},0 ${frame.width},${frame.height} 0,${frame.height}`}
          {...fillProps}
          {...strokeProps}
        />
      ) : (
        <polygon
          points={`${frame.width / 2},0 ${frame.width},${frame.height / 2} ${frame.width / 2},${frame.height} 0,${frame.height / 2}`}
          {...fillProps}
          {...strokeProps}
        />
      )}
    </svg>
  );
}
