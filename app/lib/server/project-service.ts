import type { DispatchResult, PresentationDocument } from '../presentation/document';
import type { ClientDispatchRequest } from '../presentation/attribution';
import { canonicalDispatchRequest } from '../presentation/attribution';
import { findTemplate } from '../presentation/templates';
import type { DemoPrincipal } from './demo-session';
import {
  jsonInternalErrorResponse,
  jsonNotFound,
} from './project-protocol';
import type { ProjectRecord } from '../../../workers/do/project-registry';

/**
 * Server-only service boundary between React Router loaders/actions/resource
 * routes and the project Durable Objects. Routes resolve bindings through
 * these helpers and receive domain outcomes as typed values; unexpected
 * failures are logged here with full server context and answered with a
 * neutral client error (AGENTS.md Rule 2).
 *
 * The registry is addressed only from the verified principal's workspace key
 * (`PROJECT_REGISTRY.getByName`). The public workspace slug is never used to
 * select a shard. A ProjectRoom is reached only after that registry resolves
 * the project as owned.
 *
 * TERMINAL RESPONSE RULE: every terminal outcome below is a plain `Response`.
 * UI route loaders and actions `throw` them, so React Router serves the real
 * status and error-boundary semantics instead of treating the response as
 * loader data and rendering the route with an undefined payload. Resource
 * routes (the project API) `return` them, because there the response is the
 * endpoint's own output. The rule is encoded at every call site.
 */

/** Client-safe project metadata: no workspace key or storage identity. */
export type WorkspaceProject = {
  createdAt: string;
  id: string;
  initialSlideId: string;
  templateId: string;
  title: string;
  updatedAt: string;
};

function toWorkspaceProject(record: ProjectRecord): WorkspaceProject {
  return {
    createdAt: record.createdAt,
    id: record.id,
    initialSlideId: record.initialSlideId,
    templateId: record.templateId,
    title: record.title,
    updatedAt: record.updatedAt,
  };
}

function projectRegistry(env: Env, principal: DemoPrincipal) {
  return env.PROJECT_REGISTRY.getByName(principal.workspaceKey);
}

function ownedRoom(env: Env, projectId: string) {
  return env.PROJECT_ROOM.getByName(projectId);
}

export async function listWorkspaceProjects(env: Env, principal: DemoPrincipal): Promise<WorkspaceProject[]> {
  const records = await projectRegistry(env, principal).list();
  return records.map(toWorkspaceProject);
}

export async function resolveOwnedProject(
  env: Env,
  principal: DemoPrincipal,
  projectId: string,
): Promise<WorkspaceProject | null> {
  const record = await projectRegistry(env, principal).resolve(projectId);
  return record ? toWorkspaceProject(record) : null;
}

export type CreateProjectResult =
  | { ok: true; project: WorkspaceProject }
  | { ok: false; failure: { code: 'UNKNOWN_TEMPLATE'; detail: string; templateId: string } };

/** A neutral inline workspace-action failure shown next to the creation form. */
export type WorkspaceActionFailure = {
  code: 'INVALID_INPUT' | 'UNKNOWN_TEMPLATE';
  detail: string;
  templateId?: string;
};

/**
 * Create one project from a template in the principal's registry. The
 * registry DO seeds the room before exposing the record; unexpected
 * failures propagate to the caller's error boundary handling.
 */
export async function createProjectFromTemplate(
  env: Env,
  principal: DemoPrincipal,
  input: { templateId: string; title?: string },
): Promise<CreateProjectResult> {
  if (!findTemplate(input.templateId)) {
    return {
      ok: false,
      failure: {
        code: 'UNKNOWN_TEMPLATE',
        detail: `No template "${input.templateId}" exists.`,
        templateId: input.templateId,
      },
    };
  }
  const project = await projectRegistry(env, principal).create(input);
  return { ok: true, project: toWorkspaceProject(project) };
}

/**
 * Canonical document of an owned project, or null when the principal does
 * not own the id (same shape as an unknown project).
 */
export async function readOwnedProjectDocument(
  env: Env,
  principal: DemoPrincipal,
  projectId: string,
): Promise<PresentationDocument | null> {
  const project = await resolveOwnedProject(env, principal, projectId);
  if (!project) {
    return null;
  }
  return ownedRoom(env, project.id).readDocument();
}

/**
 * One canonical dispatch against an owned project. Kernel rejections
 * (including `STALE_REVISION`) come back as the structured failure — never
 * retried here. `null` means the principal does not own the project.
 */
export async function dispatchOwnedProject(
  env: Env,
  principal: DemoPrincipal,
  projectId: string,
  request: ClientDispatchRequest,
): Promise<DispatchResult | null> {
  const project = await resolveOwnedProject(env, principal, projectId);
  if (!project) {
    return null;
  }
  const canonical = canonicalDispatchRequest(principal, request);
  if (!canonical.ok) {
    return { ok: false, failure: { code: 'INVALID_INPUT', detail: canonical.detail } };
  }
  return ownedRoom(env, project.id).dispatch(canonical.value);
}

/**
 * 404 response for an unknown workspace route parameter. The detail is
 * neutral; nothing about storage or internals is exposed.
 */
export function unknownWorkspaceResponse(): Response {
  return jsonNotFound('No workspace exists with this id.');
}

/**
 * 404 response for an unknown project route parameter. The detail is neutral;
 * nothing about storage or internals is exposed.
 */
export function unknownProjectResponse(): Response {
  return jsonNotFound('No project exists with this id.');
}

/**
 * 404 response for an unknown slide of a known project. The detail is
 * neutral; nothing about storage or internals is exposed.
 */
export function unknownSlideResponse(): Response {
  return jsonNotFound('No slide exists with this id in this project.');
}

/**
 * The one unexpected-error handler of the project API surface: logs the full
 * server context, then answers the client with a neutral structured error.
 */
export function projectErrorResponse(scope: string, error: unknown): Response {
  console.error(`[comake:${scope}]`, error);
  return jsonInternalErrorResponse();
}
