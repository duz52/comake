import { DurableObject } from 'cloudflare:workers';
import { remapTemplateId } from '../../app/lib/presentation/template';
import { findTemplate } from '../../app/lib/presentation/templates';

/**
 * The per-session project registry: one Durable Object per verified demo
 * workspace key (`PROJECT_REGISTRY.getByName(principal.workspaceKey)`),
 * holding one SQLite row per project of that shard. The public workspace
 * slug is never this object's name.
 *
 * The parent coordination atom is the anonymous session workspace, which is
 * exactly what this shard key realizes: registries scale per session and
 * `list` is a single-owner scan, never a global bottleneck.
 */

export interface ProjectRecord {
  id: string;
  title: string;
  templateId: string;
  initialSlideId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  templateId: string;
  title?: string;
}

type ProjectRow = {
  created_at: string;
  id: string;
  initial_slide_id: string;
  template_id: string;
  title: string;
  updated_at: string;
  workspace_id: string;
};

const COLUMNS = 'id, workspace_id, title, template_id, initial_slide_id, created_at, updated_at';

function rowToRecord(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    title: row.title,
    templateId: row.template_id,
    initialSlideId: row.initial_slide_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function registryWorkspaceKey(name: string | undefined): string {
  if (name === undefined || name.length === 0) {
    throw new Error('Project registry is unnamed.');
  }
  return name;
}

export class ProjectRegistry extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        title TEXT NOT NULL,
        template_id TEXT NOT NULL,
        initial_slide_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  }

  /** Every project of this registry, most recently created first. */
  async list(): Promise<ProjectRecord[]> {
    const workspaceKey = registryWorkspaceKey(this.ctx.id.name);
    return this.ctx.storage.sql
      .exec<ProjectRow>(
        `SELECT ${COLUMNS} FROM projects WHERE workspace_id = ? ORDER BY created_at DESC, id`,
        workspaceKey,
      )
      .toArray()
      .map(rowToRecord);
  }

  /** One project by id, or null when the id is unknown to this registry. */
  async resolve(projectId: string): Promise<ProjectRecord | null> {
    const workspaceKey = registryWorkspaceKey(this.ctx.id.name);
    const rows = this.ctx.storage.sql
      .exec<ProjectRow>(
        `SELECT ${COLUMNS} FROM projects WHERE id = ? AND workspace_id = ?`,
        projectId,
        workspaceKey,
      )
      .toArray();
    return rows.length > 0 ? rowToRecord(rows[0]) : null;
  }

  /**
   * Create one project of this registry from a template. The room is seeded
   * completely BEFORE the registry row is inserted, so cross-DO failure can
   * at worst leave an invisible orphan room — never a visible unseeded
   * project. Failures propagate to the caller; nothing is retried here.
   */
  async create(input: CreateProjectInput): Promise<ProjectRecord> {
    const workspaceKey = registryWorkspaceKey(this.ctx.id.name);
    const template = findTemplate(input.templateId);
    if (!template) {
      throw new Error(`Unknown template "${input.templateId}".`);
    }

    const projectId = crypto.randomUUID();
    const title = input.title ?? template.title;
    const initialSlideId = remapTemplateId(projectId, template.initialSlideId);
    const now = new Date().toISOString();

    const room = this.env.PROJECT_ROOM.getByName(projectId);
    await room.seed({ projectId, templateId: input.templateId, title });

    const record: ProjectRecord = {
      id: projectId,
      title,
      templateId: input.templateId,
      initialSlideId,
      createdAt: now,
      updatedAt: now,
    };
    this.ctx.storage.sql.exec(
      `INSERT INTO projects (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      record.id,
      workspaceKey,
      record.title,
      record.templateId,
      record.initialSlideId,
      record.createdAt,
      record.updatedAt,
    );
    return record;
  }
}
