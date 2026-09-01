import type { Route } from './+types/api-dispatch';
import { principalFrom, runtimeFrom } from '../lib/server/cloudflare';
import {
  jsonDispatchResponse,
  jsonInvalidDispatch,
  jsonMethodNotAllowedResponse,
  jsonNotFound,
  parseDispatchRequest,
} from '../lib/server/project-protocol';
import { dispatchOwnedProject, projectErrorResponse } from '../lib/server/project-service';

/**
 * Canonical dispatch: POST /api/projects/:projectId/dispatch. The body is an
 * untrusted client envelope (interaction kind only); attribution is stamped
 * from the verified principal after ownership resolution. Kernel rejections
 * are returned as structured failures with a mapped status and are never
 * retried.
 */
export async function action({ context, params, request }: Route.ActionArgs) {
  try {
    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return jsonInvalidDispatch('The request body must be valid JSON.');
    }
    const parsed = parseDispatchRequest(input);
    if (!parsed.ok) {
      return jsonInvalidDispatch(parsed.detail);
    }
    const result = await dispatchOwnedProject(
      runtimeFrom(context).env,
      principalFrom(context),
      params.projectId,
      parsed.value,
    );
    if (!result) {
      return jsonNotFound('No project exists with this id.');
    }
    return jsonDispatchResponse(result);
  } catch (error) {
    return projectErrorResponse('dispatch', error);
  }
}

export async function loader() {
  return jsonMethodNotAllowedResponse();
}
