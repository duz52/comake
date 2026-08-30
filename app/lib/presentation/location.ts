import { LAUNCH_DECK_ID, LAUNCH_DECK_INITIAL_SLIDE_ID, LAUNCH_WORKSPACE_ID } from './deck';

export function presentationSlidePath(presentationId: string, slideId: string): string {
  return `/workspace/${LAUNCH_WORKSPACE_ID}/presentation/${presentationId}/slide/${slideId}`;
}

export const initialPresentationPath = presentationSlidePath(
  LAUNCH_DECK_ID,
  LAUNCH_DECK_INITIAL_SLIDE_ID,
);
