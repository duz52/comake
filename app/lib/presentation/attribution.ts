import type { Actor, Comment, PresentationOperation } from '../../types/presentation';
import { actorForPrincipal, isClientActorKind, type ClientActorKind } from './actors';
import type { DispatchRequest } from './document';

/**
 * The one mapping from a verified principal plus a client interaction kind
 * onto the kernel dispatch the ProjectRoom runs. Client input cannot choose
 * actor id, display name, or `system`; embedded comment actors are stamped
 * from the same principal.
 */

/** The identity the server uses to stamp persisted attribution. */
export interface AttributionPrincipal {
  actorId: string;
  displayName: string;
}

/**
 * Browser / WebMCP write envelope: interaction kind only. The kernel's
 * {@link DispatchRequest} carries the full server-derived actor.
 */
export interface ClientDispatchRequest {
  actorKind: ClientActorKind;
  baseRevision?: number;
  label: string;
  operations: PresentationOperation[];
  revertsChangeSetId?: string;
}

export type CanonicalDispatchResult =
  | { ok: true; value: DispatchRequest }
  | { ok: false; detail: string };

function stampCommentActor(comment: Comment, actor: Actor): Comment {
  return { ...comment, actor: { ...actor } };
}

function stampOperationActor(operation: PresentationOperation, actor: Actor): PresentationOperation {
  if (operation.type !== 'add_comment') {
    return operation;
  }
  return { type: 'add_comment', comment: stampCommentActor(operation.comment, actor) };
}

/**
 * Construct the kernel dispatch for one verified principal. Forged id/name/
 * system values on the envelope or on embedded comments are overwritten (or
 * rejected, for `system`) at this single boundary.
 */
export function canonicalDispatchRequest(
  principal: AttributionPrincipal,
  request: ClientDispatchRequest,
): CanonicalDispatchResult {
  if (!isClientActorKind(request.actorKind)) {
    return { ok: false, detail: 'The actor kind must be "human" or "agent".' };
  }
  const actor = actorForPrincipal(principal.actorId, request.actorKind, principal.displayName);
  return {
    ok: true,
    value: {
      actor,
      baseRevision: request.baseRevision,
      label: request.label,
      operations: request.operations.map((operation) => stampOperationActor(operation, actor)),
      revertsChangeSetId: request.revertsChangeSetId,
    },
  };
}
