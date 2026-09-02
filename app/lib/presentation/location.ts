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
