import type { Actor, ActorKind } from '../../types/presentation';

/**
 * Canonical actor helpers. The persisted actor is always a verified principal
 * identity plus an interaction kind; clients never choose id, display name,
 * or `system`.
 */

/** Interaction kinds a browser or WebMCP client may declare. */
export type ClientActorKind = 'human' | 'agent';

export const CLIENT_ACTOR_KINDS: readonly ClientActorKind[] = ['human', 'agent'];

export const ACTOR_KINDS: readonly ActorKind[] = ['human', 'agent', 'system'];

/** Neutral display name for anonymous demo actors; contains no session material. */
export const DEMO_DISPLAY_NAME = 'Demo';

/** Reserved for server-owned actions; never accepted from client input. */
export const systemActor: Actor = { id: 'system', kind: 'system', name: 'Comake' };

export function isClientActorKind(value: unknown): value is ClientActorKind {
  return value === 'human' || value === 'agent';
}

export function isActorKind(value: unknown): value is ActorKind {
  return value === 'human' || value === 'agent' || value === 'system';
}

export function actorMatches(left: Actor, right: Actor): boolean {
  return left.id === right.id && left.kind === right.kind && left.name === right.name;
}

/** Build a canonical actor for one principal and interaction kind. */
export function actorForPrincipal(
  actorId: string,
  kind: ClientActorKind,
  displayName: string = DEMO_DISPLAY_NAME,
): Actor {
  return { id: actorId, kind, name: displayName };
}

/**
 * In-process kernel/test actor. Not a client-trusted identity and not an
 * authorization allowlist.
 */
export function demoActor(kind: ClientActorKind, actorId = 'demo'): Actor {
  return actorForPrincipal(actorId, kind);
}
