import type { Actor } from '../../types/presentation';

export const humanActor: Actor = { id: 'jerry', kind: 'human', name: 'Jerry' };
export const agentActor: Actor = { id: 'gpt', kind: 'agent', name: 'GPT' };
export const systemActor: Actor = { id: 'system', kind: 'system', name: 'Comake' };

export const knownActors: readonly Actor[] = [humanActor, agentActor, systemActor];

export function actorMatches(left: Actor, right: Actor): boolean {
  return left.id === right.id && left.kind === right.kind && left.name === right.name;
}
