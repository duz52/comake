import type { Route } from './+types/api-document';
import { principalFrom, runtimeFrom } from '../lib/server/cloudflare';
import { jsonDocumentResponse, jsonMethodNotAllowedResponse } from '../lib/server/project-protocol';
import { projectErrorResponse, readOwnedProjectDocument } from '../lib/server/project-service';

/**
 * Canonical document read: GET /api/projects/:projectId/document.
 * The project is resolved through the current principal's registry before
 * the room is read. Unknown or foreign projects are a real 404.
 */
export async function loader({ context, params }: Route.LoaderArgs) {
  try {
    const document = await readOwnedProjectDocument(
      runtimeFrom(context).env,
      principalFrom(context),
      params.projectId,
    );
    return jsonDocumentResponse(document);
  } catch (error) {
    return projectErrorResponse('document-read', error);
  }
}

export async function action() {
  return jsonMethodNotAllowedResponse();
}
