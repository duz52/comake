import { DurableObject } from 'cloudflare:workers';
import type { DispatchRequest, DispatchResult, PresentationDocument } from '../../app/lib/presentation/document';
import {
  createProject,
  dispatchProject,
  initializeWorkspaceSchema,
  listProjects,
  readProjectDocument,
  resolveProject,
  type WorkspaceListResult,
  type WorkspaceProjectRecord,
} from './workspace-store';

/**
 * One Durable Object per verified demo workspace key
 * (`WORKSPACE_ROOM.getByName(principal.workspaceKey)`). It is the single
 * atomic coordination owner of that session's project identity, canonical
 * documents, revisions, and listing metadata. The public workspace slug is
 * never this object's name.
 *
 * Create inserts the project row and canonical document in one statement.
 * Dispatch runs the shared pure kernel and, on accept, writes the new
 * document JSON and listing `updated_at` in one statement — no network I/O
 * and no second owner between those writes. Listing title is read from the
 * stored document via SQLite JSON extraction.
 */

export class WorkspaceRoom extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      initializeWorkspaceSchema(this.ctx.storage.sql);
    });
  }

  async list(cursor?: string): Promise<WorkspaceListResult> {
    return listProjects(this.ctx.storage.sql, cursor);
  }

  async resolve(projectId: string): Promise<WorkspaceProjectRecord | null> {
    return resolveProject(this.ctx.storage.sql, projectId);
  }

  async readDocument(projectId: string): Promise<PresentationDocument | null> {
    return readProjectDocument(this.ctx.storage.sql, projectId);
  }

  async create(input: { templateId: string; title?: string }): Promise<WorkspaceProjectRecord> {
    return this.ctx.storage.transactionSync(() => createProject(this.ctx.storage.sql, input));
  }

  async dispatch(projectId: string, request: DispatchRequest): Promise<DispatchResult | null> {
    return this.ctx.storage.transactionSync(() => dispatchProject(this.ctx.storage.sql, projectId, request));
  }
}
