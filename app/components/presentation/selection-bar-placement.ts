import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../lib/presentation/canvas';
import type { Frame } from '../../types/presentation';
import { clamp } from './gesture';

/** Handles sit 16px outside the element box (20px hit target, ring ~6px out). */
export const HANDLE_OUTSET_PX = 16;
export const SELECTION_BAR_GAP_PX = 8;
export const SELECTION_BAR_HEIGHT_PX = 32;
export const SELECTION_BAR_MARGIN_PX = 8;
export const SELECTION_BAR_ESTIMATED_WIDTH_PX = 200;

export interface SelectionBarBox {
  left: number;
  top: number;
}

/**
 * Place the selection bar in slide-frame CSS pixels. The bar lives inside
 * the slide, so stage scrolling moves the slide and bar together and never
 * owns this box. Prefer below the union (clear of the 20px handles), flip
 * above when that would overflow the slide, then clamp the final box into
 * the slide margin. Top is never negative; the bar never overflows the slide.
 */
export function placeSelectionActionBar(args: {
  union: Frame;
  slideWidthPx: number;
  slideHeightPx: number;
  barWidth: number;
  barHeight: number;
}): SelectionBarBox {
  const { union, slideWidthPx, slideHeightPx, barWidth, barHeight } = args;
  const scaleX = slideWidthPx / SLIDE_WIDTH;
  const scaleY = slideHeightPx / SLIDE_HEIGHT;
  const box = {
    left: union.x * scaleX,
    top: union.y * scaleY,
    width: union.width * scaleX,
    height: union.height * scaleY,
  };

  const width = Math.min(barWidth, Math.max(0, slideWidthPx - 2 * SELECTION_BAR_MARGIN_PX));
  const height = Math.min(barHeight, Math.max(0, slideHeightPx - SELECTION_BAR_MARGIN_PX));

  const preferredTop = box.top + box.height + HANDLE_OUTSET_PX + SELECTION_BAR_GAP_PX;
  const flippedTop = box.top - HANDLE_OUTSET_PX - SELECTION_BAR_GAP_PX - height;
  const fitsBelow = preferredTop + height <= slideHeightPx - SELECTION_BAR_MARGIN_PX;
  const unclampedTop = fitsBelow ? preferredTop : flippedTop;
  const minTop = 0;
  const maxTop = Math.max(minTop, slideHeightPx - height - SELECTION_BAR_MARGIN_PX);
  const top = clamp(unclampedTop, minTop, maxTop);

  const center = box.left + box.width / 2;
  const unclampedLeft = center - width / 2;
  const minLeft = SELECTION_BAR_MARGIN_PX;
  const maxLeft = slideWidthPx - width - SELECTION_BAR_MARGIN_PX;
  return { left: clamp(unclampedLeft, minLeft, Math.max(minLeft, maxLeft)), top };
}
