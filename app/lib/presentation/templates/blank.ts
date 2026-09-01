import type { PresentationTemplate } from '../template';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../canvas';

const initialSlideId = 'slide-1';

/**
 * Immutable blank presentation: one empty white slide, no elements, no
 * comments, no changesets. The workspace "New presentation" action clones it.
 */
export const blankTemplate: PresentationTemplate = {
  id: 'comake-blank',
  title: 'Untitled presentation',
  initialSlideId,
  size: { width: SLIDE_WIDTH, height: SLIDE_HEIGHT },
  slideOrder: [initialSlideId],
  slides: {
    [initialSlideId]: {
      id: initialSlideId,
      name: 'Slide 1',
      background: '#ffffff',
      elementOrder: [],
      elements: {},
    },
  },
};
