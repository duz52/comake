import { slideTitleText } from '../../lib/presentation/document';
import type { Slide } from '../../types/presentation';

/** The human-facing name of a slide: its title text, else the slide name. */
export function slideDisplayName(slide: Slide): string {
  return (slideTitleText(slide) ?? slide.name).replaceAll('\n', ' ');
}
