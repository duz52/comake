import { useLoaderData } from 'react-router';
import type { Route } from './+types/presentation-slide';
import { principalFrom, runtimeFrom } from '../lib/server/cloudflare';
import { CANONICAL_WORKSPACE_ID } from '../lib/presentation/location';
import {
  projectErrorResponse,
  readOwnedProjectDocument,
  unknownProjectResponse,
  unknownSlideResponse,
  unknownWorkspaceResponse,
} from '../lib/server/project-service';
import { PresentationWorkspace } from '../components/presentation/workspace';

/**
 * The canonical editor route. The loader validates the public workspace slug,
 * resolves the project from the current principal's registry, reads the
 * canonical ProjectRoom document, and validates the requested slide.
 */
export async function loader({ context, params }: Route.LoaderArgs) {
  const env = runtimeFrom(context).env;
  const principal = principalFrom(context);
  if (params.workspaceId !== CANONICAL_WORKSPACE_ID) {
    throw unknownWorkspaceResponse();
  }
  try {
    const document = await readOwnedProjectDocument(env, principal, params.presentationId);
    if (!document) {
      throw unknownProjectResponse();
    }
    if (!document.presentation.slides[params.slideId]) {
      throw unknownSlideResponse();
    }
    return { document, slideId: params.slideId, workspaceId: params.workspaceId };
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    throw projectErrorResponse('presentation-slide-loader', error);
  }
}

export default function PresentationSlideRoute() {
  const { document, slideId, workspaceId } = useLoaderData<typeof loader>();
  return <PresentationWorkspace document={document} slideId={slideId} workspaceId={workspaceId} />;
}
