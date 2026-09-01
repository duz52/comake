import { DurableObject } from 'cloudflare:workers';
import type { DispatchRequest, DispatchResult, PresentationDocument } from '../../app/lib/presentation/document';
import { dispatchPresentationDocument } from '../../app/lib/presentation/document';
import { cloneTemplateDocument } from '../../app/lib/presentation/template';
import { findTemplate } from '../../app/lib/presentation/templates';

/**
 * The canonical owner of one project's document and revision. One room exists
 * per project (`idFromName(projectId)`); it is the only writer of the
 * canonical state and runs the shared pure kernel
 * (`dispatchPresentationDocument`) for every accepted mutation.
 *
 * Canonical state lives exclusively in SQLite (`ctx.storage.sql`) so it
 * survives hibernation and eviction; nothing is cached in memory across
 * events. The stored row is a single JSON document whose `presentation.id`
 * and `presentation.revision` are the project and revision identities, so
 * every persistence step is one atomic SQL statement.
 */

type DocumentRow = { document_json: string };

export interface SeedProjectRoomInput {
  projectId: string;
  templateId: string;
  title?: string;
}

export interface SeedProjectRoomResult {
  /** True when this call wrote the seed; false when the room was already seeded. */
  seeded: boolean;
}

export class ProjectRoom extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        project_id TEXT PRIMARY KEY,
        document_json TEXT NOT NULL
      )
    `);
  }

  /**
   * Idempotent seed: writes the template clone only while the room holds no
   * document; a repeat call is a no-op. The room enforces its own identity —
   * it only ever stores the document of the project it is named for.
   */
  async seed(input: SeedProjectRoomInput): Promise<SeedProjectRoomResult> {
    if (this.ctx.id.name !== input.projectId) {
      throw new Error(`Project room "${this.ctx.id.name}" cannot seed a different project "${input.projectId}".`);
    }
    const stored = this.readStoredDocument();
    if (stored) {
      return { seeded: false };
    }
    const template = findTemplate(input.templateId);
    if (!template) {
      throw new Error(`Unknown template "${input.templateId}".`);
    }
    const { document } = cloneTemplateDocument(template, input.projectId, input.title);
    // Single-statement atomic insert of the complete seed.
    this.ctx.storage.sql.exec(
      'INSERT INTO documents (project_id, document_json) VALUES (?, ?)',
      input.projectId,
      JSON.stringify(document),
    );
    return { seeded: true };
  }

  /** The canonical document, or null when the room has not been seeded. */
  async readDocument(): Promise<PresentationDocument | null> {
    return this.readStoredDocument();
  }

  /**
   * Run one atomic kernel dispatch against the canonical document. Rejections
   * (including `STALE_REVISION`) are the kernel's structured failures returned
   * as-is — never retried; accepted dispatches bump the revision and persist
   * the new document in the same event.
   */
  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    const current = this.readStoredDocument();
    if (!current) {
      return {
        ok: false,
        failure: { code: 'NOT_FOUND', detail: 'No document exists in this project room yet.' },
      };
    }
    const result = dispatchPresentationDocument(current, request);
    if (!result.ok) {
      return result;
    }
    // Single-statement atomic persist of the accepted dispatch outcome: the
    // new document carries the bumped revision, so state and revision commit
    // together or not at all.
    this.ctx.storage.sql.exec(
      'UPDATE documents SET document_json = ? WHERE project_id = ?',
      JSON.stringify(result.document),
      current.presentation.id,
    );
    return result;
  }

  private readStoredDocument(): PresentationDocument | null {
    const rows = this.ctx.storage.sql
      .exec<DocumentRow>('SELECT document_json FROM documents')
      .toArray();
    if (rows.length === 0) {
      return null;
    }
    return JSON.parse(rows[0].document_json) as PresentationDocument;
  }
}
