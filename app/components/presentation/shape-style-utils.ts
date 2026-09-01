import type { ShapeGeometry, ShapeStyle, StrokeDash } from '../../types/presentation';

/**
 * Pure helpers of the complete shape inspector: the geometry/dash option
 * tables, the opacity percent conversions, and the geometry switch that
 * preserves the whole style while making invalid states unrepresentable.
 * No kernel invariant is re-derived here; the inspector commits whole
 * canonical styles and the kernel owns validation.
 */

export const SHAPE_GEOMETRY_OPTIONS: ReadonlyArray<{ kind: ShapeGeometry['kind']; label: string }> = [
  { kind: 'rectangle', label: 'Rectangle' },
  { kind: 'ellipse', label: 'Ellipse' },
  { kind: 'triangle', label: 'Triangle' },
  { kind: 'diamond', label: 'Diamond' },
];

export const STROKE_DASH_OPTIONS: ReadonlyArray<{ dash: StrokeDash; label: string }> = [
  { dash: 'solid', label: 'Solid' },
  { dash: 'dash', label: 'Dash' },
  { dash: 'dot', label: 'Dot' },
];

/** Canonical fraction in (0,1] as an integer percentage for the field display. */
export function opacityToPercent(opacity: number): number {
  return Math.round(opacity * 100);
}

/** Percentage input as the canonical fraction; 0 is impossible (none owns invisibility). */
export function percentToOpacity(percent: number): number {
  return Math.max(0.01, Math.min(1, percent / 100));
}

/**
 * Switch the geometry of a complete style, preserving every paint field.
 * Returning to the rectangle uses the caller's session radius (the authored
 * value remembered while away); the other variants carry no radius field at
 * all, so no shape can ever hold a meaningless corner radius.
 */
export function switchGeometryTo(
  style: ShapeStyle,
  kind: ShapeGeometry['kind'],
  rectangleRadius: number,
): ShapeStyle {
  return kind === 'rectangle'
    ? { ...style, geometry: { kind: 'rectangle', cornerRadius: rectangleRadius } }
    : { ...style, geometry: { kind } };
}