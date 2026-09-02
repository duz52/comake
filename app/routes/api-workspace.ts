import type { Route } from './+types/api-workspace';
import { principalFrom, runtimeFrom } from '../lib/server/cloudflare';
import { CANONICAL_WORKSPACE_ID } from '../lib/presentation/location';
import {
  jsonInvalidDispatch,
  jsonMethodNotAllowedResponse,
  PRIVATE_NO_STORE,
} from '../lib/server/project-protocol';
import {
  createProjectFromTemplate,
  listWorkspaceProjects,
  projectErrorResponse,
  unknownWorkspaceResponse,
} from '../lib/server/project-service';
import {
  createdPresentationFromProject,
  parseCreatePresentationInput,
  workspaceContextFromPage,
} from '../lib/workspace/protocol';

/**
 * Workspace agent transport: GET lists this principal's projects and the
 * template catalog; POST creates one owned project through
 * `createProjectFromTemplate`. The public slug is validated the same way
 * as the HTML workspace route. Tools wrap this JSON; they do not navigate.
 */

function jsonHeaders(): HeadersInit {
  return { 'Cache-Control': PRIVATE_NO_STORE };
}

export async function loader({ context, params, request }: Route.LoaderArgs) {
  if (params.workspaceId !== CANONICAL_WORKSPACE_ID) {
    return unknownWorkspaceResponse();
  }
  try {
    const cursor = new URL(request.url).searchParams.get('cursor') ?? undefined;
    if (cursor === '') {
      return jsonInvalidDispatch('cursor must be a non-empty string.');
    }
    const listed = await listWorkspaceProjects(runtimeFrom(context).env, principalFrom(context), cursor);
    if (!listed.ok) {
      return jsonInvalidDispatch(listed.detail);
    }
    return Response.json(
      { ok: true, ...workspaceContextFromPage(params.workspaceId, listed) },
      { headers: jsonHeaders() },
    );
  } catch (error) {
    return projectErrorResponse('workspace-context', error);
  }
}

export async function action({ context, params, request }: Route.ActionArgs) {
  if (request.method !== 'POST') {
    return jsonMethodNotAllowedResponse();
  }
  if (params.workspaceId !== CANONICAL_WORKSPACE_ID) {
    return unknownWorkspaceResponse();
  }
  try {
    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return jsonInvalidDispatch('The request body must be valid JSON.');
    }
    const parsed = parseCreatePresentationInput(input);
    if (!parsed.ok) {
      return jsonInvalidDispatch(parsed.detail);
    }
    const result = await createProjectFromTemplate(runtimeFrom(context).env, principalFrom(context), {
      templateId: parsed.value.templateId,
      title: parsed.value.title,
    });
    if (!result.ok) {
      return Response.json(
        { ok: false, failure: result.failure },
        { status: 400, headers: jsonHeaders() },
      );
    }
    return Response.json(
      { ok: true, ...createdPresentationFromProject(params.workspaceId, result.project) },
      { headers: jsonHeaders() },
    );
  } catch (error) {
    return projectErrorResponse('workspace-create', error);
  }
}
