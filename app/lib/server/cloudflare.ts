import { createContext, type RouterContextProvider } from 'react-router';
import type { DemoPrincipal } from './demo-session';

/**
 * Server-only per-request Cloudflare runtime. `workers/app.ts` populates the
 * context from the Worker's `fetch(request, env, ctx)`; React Router loaders,
 * actions, and resource routes read it through `runtimeFrom`. Never import
 * this module from client code.
 */

export type { DemoPrincipal };

export interface CloudflareRuntime {
  ctx: ExecutionContext;
  env: Env;
}

export const cloudflareRuntime = createContext<CloudflareRuntime>();

/** Verified anonymous demo principal for this request. Never module-global. */
export const demoPrincipal = createContext<DemoPrincipal>();

/** The request's Cloudflare runtime, from a loader/action context. */
export function runtimeFrom(context: Readonly<RouterContextProvider>): CloudflareRuntime {
  return context.get(cloudflareRuntime);
}

/** The request's verified demo principal, from a loader/action context. */
export function principalFrom(context: Readonly<RouterContextProvider>): DemoPrincipal {
  return context.get(demoPrincipal);
}
