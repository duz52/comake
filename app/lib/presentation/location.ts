/**
 * The public workspace display slug. It is a URL label only and is never an
 * authorization identity; the workspace Durable Object is addressed from
 * the verified demo principal's workspace key.
 */
export const CANONICAL_WORKSPACE_ID = 'comake';

export function workspacePath(workspaceId: string): string {
  return `/workspace/${workspaceId}`;
}

export function presentationPath(workspaceId: string, presentationId: string): string {
  return `${workspacePath(workspaceId)}/presentation/${presentationId}`;
}

export function presentationSlidePath(workspaceId: string, presentationId: string, slideId: string): string {
  return `${presentationPath(workspaceId, presentationId)}/slide/${slideId}`;
}

/**
 * Session-to-URL projection policy. Callers pass the current session id and
 * route param; this function never stores a slide identity of its own.
 *
 * Idle when they already match. Browser Back/Forward is an inbound POP that
 * selects the live route id. Every other mismatch projects the session onto
 * the URL: a one-shot editor history intent becomes PUSH, otherwise REPLACE.
 */
export type SessionRouteDecision =
  | { kind: 'idle' }
  | { kind: 'inbound-pop'; slideId: string }
  | { kind: 'project'; replace: boolean };

export function decideSessionRoute(input: {
  activeSlideId: string;
  routeSlideId: string | undefined;
  navigationType: string;
  routeMoved: boolean;
  routeSlideExists: boolean;
  pushEditorHistory: boolean;
}): SessionRouteDecision {
  if (input.routeSlideId === input.activeSlideId) {
    return { kind: 'idle' };
  }
  if (
    input.routeMoved &&
    input.navigationType === 'POP' &&
    input.routeSlideId !== undefined &&
    input.routeSlideExists
  ) {
    return { kind: 'inbound-pop', slideId: input.routeSlideId };
  }
  return { kind: 'project', replace: !input.pushEditorHistory };
}
