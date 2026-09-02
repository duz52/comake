import { redirect } from 'react-router';
import type { Route } from './+types/presentation';
import { principalFrom, runtimeFrom } from '../lib/server/cloudflare';
import { CANONICAL_WORKSPACE_ID, presentationSlidePath } from '../lib/presentation/location';
import {
  projectErrorResponse,
  resolveOwnedProject,
  unknownProjectResponse,
  unknownWorkspaceResponse,
} from '../lib/server/project-service';

/**
 * Presentation-level entry: validates the public workspace slug, resolves the
 * project from the current principal's WorkspaceRoom, and deterministically
 * lands on the project's persisted initial slide. Unknown workspaces and
 * projects (including another session's ids) are thrown 404 responses.
 */
export async function loader({ context, params }: Route.LoaderArgs) {
  const env = runtimeFrom(context).env;
  const principal = principalFrom(context);
  if (params.workspaceId !== CANONICAL_WORKSPACE_ID) {
    throw unknownWorkspaceResponse();
  }
  try {
    const project = await resolveOwnedProject(env, principal, params.presentationId);
    if (!project) {
      throw unknownProjectResponse();
    }
    return redirect(presentationSlidePath(params.workspaceId, project.id, project.initialSlideId));
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    throw projectErrorResponse('presentation-loader', error);
  }
}

export default function PresentationRoute() {
  return null;
}
