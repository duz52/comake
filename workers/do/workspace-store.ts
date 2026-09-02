import type { DispatchRequest, DispatchResult, PresentationDocument } from '../../app/lib/presentation/document';
import { dispatchPresentationDocument } from '../../app/lib/presentation/document';
import { cloneTemplateDocument } from '../../app/lib/presentation/template';
import { findTemplate } from '../../app/lib/presentation/templates';
import { isRecord } from '../../app/lib/presentation/operations';
import { WORKSPACE_PROJECT_PAGE_SIZE } from '../../app/lib/workspace/protocol';

/**
 * The SQLite operations of one anonymous-session workspace. WorkspaceRoom
 * runs these against `ctx.storage.sql` inside `transactionSync` (or an
 * equivalent no-await write sequence). Tests run the same functions against
 * an in-process SQLite database. There is no second owner: listing title is
 * `json_extract` of the canonical document, and `updated_at` is written in
 * the same statement as `document_json`.
 */

export type WorkspaceSqlValue = ArrayBuffer | string | number | null;

export type WorkspaceSql = {
  exec<T extends Record<string, WorkspaceSqlValue>>(query: string, ...binds: unknown[]): { toArray(): T[] };
};

export type WorkspaceProjectRecord = {
  createdAt: string;
  id: string;
  initialSlideId: string;
  templateId: string;
  title: string;
  updatedAt: string;
};

export type WorkspaceListResult =
  | { ok: true; nextCursor: string | null; projects: WorkspaceProjectRecord[] }
  | { ok: false; detail: string };

type ProjectListRow = {
  createdAt: string;
  id: string;
  initialSlideId: string;
  templateId: string;
  title: string | null;
  updatedAt: string;
};

type DocumentRow = {
  document_json: string;
};

export function initializeWorkspaceSchema(sql: WorkspaceSql): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      initial_slide_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      document_json TEXT NOT NULL
    )
  `);
  sql.exec('CREATE INDEX IF NOT EXISTS projects_list ON projects (updated_at DESC, id DESC)');
}

export function encodeWorkspaceListCursor(value: { id: string; updatedAt: string }): string {
  return btoa(JSON.stringify({ id: value.id, updatedAt: value.updatedAt }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

export function parseWorkspaceListCursor(value: string): { ok: true; value: { id: string; updatedAt: string } } | { ok: false; detail: string } {
  if (value.length === 0) {
    return { ok: false, detail: 'The listing cursor must be a non-empty string.' };
  }
  let json: string;
  try {
    const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
    json = atob(padded);
  } catch {
    return { ok: false, detail: 'The listing cursor is invalid.' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, detail: 'The listing cursor is invalid.' };
  }
  if (!isRecord(parsed)) {
    return { ok: false, detail: 'The listing cursor is invalid.' };
  }
  for (const key of Object.keys(parsed)) {
    if (key !== 'id' && key !== 'updatedAt') {
      return { ok: false, detail: 'The listing cursor is invalid.' };
    }
  }
  if (typeof parsed.id !== 'string' || parsed.id.length === 0) {
    return { ok: false, detail: 'The listing cursor is invalid.' };
  }
  if (typeof parsed.updatedAt !== 'string' || parsed.updatedAt.length === 0) {
    return { ok: false, detail: 'The listing cursor is invalid.' };
  }
  return { ok: true, value: { id: parsed.id, updatedAt: parsed.updatedAt } };
}

function recordFromListRow(row: ProjectListRow): WorkspaceProjectRecord {
  if (typeof row.title !== 'string' || row.title.length === 0) {
    throw new Error(`Workspace project "${row.id}" document is missing a presentation title.`);
  }
  return {
    id: row.id,
    title: row.title,
    templateId: row.templateId,
    initialSlideId: row.initialSlideId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const LIST_COLUMNS = `
  id,
  template_id AS templateId,
  initial_slide_id AS initialSlideId,
  created_at AS createdAt,
  updated_at AS updatedAt,
  json_extract(document_json, '$.presentation.title') AS title
`;

export function listProjects(
  sql: WorkspaceSql,
  cursor?: string,
  pageSize: number = WORKSPACE_PROJECT_PAGE_SIZE,
): WorkspaceListResult {
  if (pageSize < 1) {
    throw new Error('Workspace listing page size must be a positive integer.');
  }
  const limit = pageSize + 1;
  let rows: ProjectListRow[];
  if (cursor === undefined) {
    rows = sql
      .exec<ProjectListRow>(
        `SELECT ${LIST_COLUMNS} FROM projects ORDER BY updated_at DESC, id DESC LIMIT ?`,
        limit,
      )
      .toArray();
  } else {
    const parsed = parseWorkspaceListCursor(cursor);
    if (!parsed.ok) {
      return parsed;
    }
    rows = sql
      .exec<ProjectListRow>(
        `SELECT ${LIST_COLUMNS} FROM projects
         WHERE updated_at < ? OR (updated_at = ? AND id < ?)
         ORDER BY updated_at DESC, id DESC
         LIMIT ?`,
        parsed.value.updatedAt,
        parsed.value.updatedAt,
        parsed.value.id,
        limit,
      )
      .toArray();
  }

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const projects = page.map(recordFromListRow);
  const last = projects[projects.length - 1];
  return {
    ok: true,
    projects,
    nextCursor: hasMore && last !== undefined ? encodeWorkspaceListCursor({ id: last.id, updatedAt: last.updatedAt }) : null,
  };
}

export function resolveProject(sql: WorkspaceSql, projectId: string): WorkspaceProjectRecord | null {
  const rows = sql
    .exec<ProjectListRow>(`SELECT ${LIST_COLUMNS} FROM projects WHERE id = ?`, projectId)
    .toArray();
  return rows.length > 0 ? recordFromListRow(rows[0]) : null;
}

export function readProjectDocument(sql: WorkspaceSql, projectId: string): PresentationDocument | null {
  const rows = sql
    .exec<DocumentRow>('SELECT document_json FROM projects WHERE id = ?', projectId)
    .toArray();
  if (rows.length === 0) {
    return null;
  }
  return JSON.parse(rows[0].document_json) as PresentationDocument;
}

export function createProject(
  sql: WorkspaceSql,
  input: { templateId: string; title?: string },
): WorkspaceProjectRecord {
  const template = findTemplate(input.templateId);
  if (!template) {
    throw new Error(`Unknown template "${input.templateId}".`);
  }
  const projectId = crypto.randomUUID();
  const { document, initialSlideId } = cloneTemplateDocument(template, projectId, input.title);
  const now = new Date().toISOString();
  sql.exec(
    `INSERT INTO projects (id, template_id, initial_slide_id, created_at, updated_at, document_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    projectId,
    input.templateId,
    initialSlideId,
    now,
    now,
    JSON.stringify(document),
  );
  return {
    id: projectId,
    title: document.presentation.title,
    templateId: input.templateId,
    initialSlideId,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Apply one kernel dispatch. A rejection returns the structured failure and
 * writes nothing. An accepted dispatch updates `document_json` and
 * `updated_at` in one statement. `null` means the project is unknown here.
 */
export function dispatchProject(
  sql: WorkspaceSql,
  projectId: string,
  request: DispatchRequest,
): DispatchResult | null {
  const rows = sql
    .exec<DocumentRow>('SELECT document_json FROM projects WHERE id = ?', projectId)
    .toArray();
  if (rows.length === 0) {
    return null;
  }
  const document = JSON.parse(rows[0].document_json) as PresentationDocument;
  const result = dispatchPresentationDocument(document, request);
  if (!result.ok) {
    return result;
  }
  sql.exec(
    'UPDATE projects SET document_json = ?, updated_at = ? WHERE id = ?',
    JSON.stringify(result.document),
    result.changeSet.createdAt,
    projectId,
  );
  return result;
}
