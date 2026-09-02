import { redirect, useActionData, useLoaderData, useParams } from 'react-router';
import type { Route } from './+types/workspace';
import { WorkspaceHome } from '../components/workspace/workspace-home';
import { principalFrom, runtimeFrom } from '../lib/server/cloudflare';
import { CANONICAL_WORKSPACE_ID, presentationSlidePath } from '../lib/presentation/location';
import { parseCreateProjectForm } from '../lib/server/project-protocol';
import {
  createProjectFromTemplate,
  listWorkspaceProjects,
  projectErrorResponse,
  unknownWorkspaceResponse,
  type WorkspaceActionFailure,
} from '../lib/server/project-service';
import { useWorkspaceWebMcp } from '../lib/workspace/webmcp';

/**
 * The workspace home: the persisted project list of the current anonymous
 * session plus the template creation surface. The loader validates the public
 * workspace slug (throwing a real 404 for unknown ids) and lists the first
 * page of this principal's workspace together with the continuation cursor.
 * The action strictly validates the creation form, creates the project in
 * that workspace object, and redirects into the project's persisted initial
 * slide. Workspace WebMCP tools are registered on this page through
 * `document.modelContext`.
 */
export async function loader({ context, params }: Route.LoaderArgs) {
  const env = runtimeFrom(context).env;
  const principal = principalFrom(context);
  if (params.workspaceId !== CANONICAL_WORKSPACE_ID) {
    throw unknownWorkspaceResponse();
  }
  try {
    const listed = await listWorkspaceProjects(env, principal);
    if (!listed.ok) {
      throw projectErrorResponse('workspace-loader', listed.detail);
    }
    return { projects: listed.projects, nextCursor: listed.nextCursor };
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    throw projectErrorResponse('workspace-loader', error);
  }
}

export async function action({ context, params, request }: Route.ActionArgs) {
  const env = runtimeFrom(context).env;
  const principal = principalFrom(context);
  if (params.workspaceId !== CANONICAL_WORKSPACE_ID) {
    throw unknownWorkspaceResponse();
  }
  try {
    const form = await request.formData();
    const templateField = form.get('templateId');
    const submittedTemplateId = typeof templateField === 'string' ? templateField : undefined;
    const parsed = parseCreateProjectForm(form);
    if (!parsed.ok) {
      return {
        ok: false as const,
        failure: { code: 'INVALID_INPUT' as const, detail: parsed.detail, templateId: submittedTemplateId },
      };
    }
    const result = await createProjectFromTemplate(env, principal, {
      templateId: parsed.value.templateId,
      title: parsed.value.title,
    });
    if (!result.ok) {
      return { ok: false as const, failure: result.failure };
    }
    return redirect(
      presentationSlidePath(params.workspaceId, result.project.id, result.project.initialSlideId),
    );
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    throw projectErrorResponse('workspace-action', error);
  }
}

export default function WorkspaceRoute() {
  const { nextCursor, projects } = useLoaderData<typeof loader>();
  const workspaceId = useParams().workspaceId!;
  useWorkspaceWebMcp(workspaceId);
  const actionData = useActionData<typeof action>();
  const actionFailure: WorkspaceActionFailure | null =
    actionData && !actionData.ok ? actionData.failure : null;
  return (
    <WorkspaceHome
      actionFailure={actionFailure}
      nextCursor={nextCursor}
      projects={projects}
      workspaceId={workspaceId}
    />
  );
}
