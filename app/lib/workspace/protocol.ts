import { presentationSlidePath } from '../presentation/location';
import { isRecord, parsePresentationTitle, parseToolInput } from '../presentation/operations';
import { blankTemplate, listTemplates } from '../presentation/templates';

/**
 * Workspace agent contract: strict parsers and listing records. Creation
 * still goes through `createProjectFromTemplate`; this module only names
 * the self-describing JSON the workspace page exposes to WebMCP.
 */

/**
 * Finite workspace listing page. One request never returns every project
 * ever created; continuation is an opaque `nextCursor`.
 */
export const WORKSPACE_PROJECT_PAGE_SIZE = 50;

export type WorkspaceTemplateRecord = {
  id: string;
  slideCount: number;
  title: string;
};

export type WorkspaceListedProject = {
  createdAt: string;
  editorUrl: string;
  id: string;
  initialSlideId: string;
  templateId: string;
  title: string;
  updatedAt: string;
};

export type WorkspaceContext = {
  nextCursor: string | null;
  pageSize: number;
  projects: WorkspaceListedProject[];
  templates: WorkspaceTemplateRecord[];
  workspaceId: string;
};

export type CreatedPresentation = {
  editorUrl: string;
  initialSlideId: string;
  projectId: string;
  templateId: string;
  title: string;
};

export type CreatePresentationInput = {
  templateId: string;
  title: string;
};

export type CreatePresentationParseResult =
  | { ok: true; value: CreatePresentationInput }
  | { ok: false; detail: string };

/** Stable template catalog for the workspace agent contract, including blank. */
export function workspaceTemplateCatalog(): WorkspaceTemplateRecord[] {
  return listTemplates().map((template) => ({
    id: template.id,
    title: template.title,
    slideCount: template.slideOrder.length,
  }));
}

export function listedWorkspaceProject(
  workspaceId: string,
  project: {
    createdAt: string;
    id: string;
    initialSlideId: string;
    templateId: string;
    title: string;
    updatedAt: string;
  },
): WorkspaceListedProject {
  return {
    id: project.id,
    title: project.title,
    templateId: project.templateId,
    initialSlideId: project.initialSlideId,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    editorUrl: presentationSlidePath(workspaceId, project.id, project.initialSlideId),
  };
}

export function workspaceContextFromPage(
  workspaceId: string,
  page: {
    nextCursor: string | null;
    projects: Array<{
      createdAt: string;
      id: string;
      initialSlideId: string;
      templateId: string;
      title: string;
      updatedAt: string;
    }>;
  },
): WorkspaceContext {
  return {
    workspaceId,
    templates: workspaceTemplateCatalog(),
    projects: page.projects.map((project) => listedWorkspaceProject(workspaceId, project)),
    pageSize: WORKSPACE_PROJECT_PAGE_SIZE,
    nextCursor: page.nextCursor,
  };
}

export function createdPresentationFromProject(
  workspaceId: string,
  project: { id: string; initialSlideId: string; templateId: string; title: string },
): CreatedPresentation {
  return {
    projectId: project.id,
    initialSlideId: project.initialSlideId,
    title: project.title,
    templateId: project.templateId,
    editorUrl: presentationSlidePath(workspaceId, project.id, project.initialSlideId),
  };
}

function parseOptionalTemplateId(value: unknown, subject: string): { ok: true; value: string | undefined } | { ok: false; detail: string } {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, detail: `${subject} must be a non-empty string.` };
  }
  return { ok: true, value };
}

/**
 * Parse the agent create-presentation body. `title` is required and must
 * satisfy the canonical title grammar. `templateId` is optional and
 * defaults to the blank template; unknown ids are rejected by the service,
 * not here.
 */
export function parseCreatePresentationInput(input: unknown): CreatePresentationParseResult {
  const parsed = parseToolInput(input, ['templateId', 'title']);
  if (!parsed.ok) {
    return parsed;
  }
  const title = parsePresentationTitle(parsed.value.title, 'title');
  if (!title.ok) {
    return title;
  }
  const templateId = parseOptionalTemplateId(parsed.value.templateId, 'templateId');
  if (!templateId.ok) {
    return templateId;
  }
  return {
    ok: true,
    value: {
      title: title.value,
      templateId: templateId.value ?? blankTemplate.id,
    },
  };
}

export function parseWorkspaceContextInput(
  input: unknown,
): { ok: true; value: { cursor?: string } } | { ok: false; detail: string } {
  const parsed = parseToolInput(input, ['cursor']);
  if (!parsed.ok) {
    return parsed;
  }
  if (parsed.value.cursor === undefined) {
    return { ok: true, value: {} };
  }
  if (typeof parsed.value.cursor !== 'string' || parsed.value.cursor.length === 0) {
    return { ok: false, detail: 'cursor must be a non-empty string.' };
  }
  return { ok: true, value: { cursor: parsed.value.cursor } };
}

export function workspaceApiPath(workspaceId: string, query?: { cursor?: string }): string {
  const path = `/api/workspace/${workspaceId}`;
  if (query?.cursor === undefined) {
    return path;
  }
  return `${path}?cursor=${encodeURIComponent(query.cursor)}`;
}

/**
 * The resource-route JSON body: the protocol context plus `ok`, or a
 * structured failure. Pagination treats success only after
 * {@link isWorkspaceContextSuccess} validates the complete page.
 */
export type WorkspaceContextResponse =
  | ({ ok: true } & WorkspaceContext)
  | { ok: false; failure: { code: string; detail: string } };

const CONTEXT_SUCCESS_KEYS = ['ok', 'nextCursor', 'pageSize', 'projects', 'templates', 'workspaceId'] as const;
const LISTED_PROJECT_KEYS = [
  'createdAt',
  'editorUrl',
  'id',
  'initialSlideId',
  'templateId',
  'title',
  'updatedAt',
] as const;
const TEMPLATE_RECORD_KEYS = ['id', 'slideCount', 'title'] as const;

function hasExactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  if (keys.length !== allowed.length) {
    return false;
  }
  for (const key of keys) {
    if (!allowed.includes(key)) {
      return false;
    }
  }
  return true;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isCanonicalListedTitle(value: unknown): value is string {
  const parsed = parsePresentationTitle(value, 'title');
  return parsed.ok && parsed.value === value;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isTemplateRecord(value: unknown): value is WorkspaceTemplateRecord {
  return (
    isRecord(value) &&
    hasExactKeys(value, TEMPLATE_RECORD_KEYS) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.title) &&
    isPositiveSafeInteger(value.slideCount)
  );
}

function isListedProject(value: unknown, workspaceId: string): value is WorkspaceListedProject {
  if (!isRecord(value) || !hasExactKeys(value, LISTED_PROJECT_KEYS)) {
    return false;
  }
  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.initialSlideId) ||
    !isNonEmptyString(value.templateId) ||
    !isCanonicalListedTitle(value.title) ||
    !isIsoTimestamp(value.createdAt) ||
    !isIsoTimestamp(value.updatedAt)
  ) {
    return false;
  }
  return value.editorUrl === presentationSlidePath(workspaceId, value.id, value.initialSlideId);
}

/**
 * Runtime protocol boundary for a workspace listing page. Narrows only when
 * every field required by pagination is well-formed: this workspace's id,
 * the finite page size, a null or non-empty cursor, template records, and
 * listed projects whose `editorUrl` is the canonical slide path. Unknown
 * keys, coercion, and recovery are failures.
 */
export function isWorkspaceContextSuccess(
  value: unknown,
  workspaceId: string,
): value is { ok: true } & WorkspaceContext {
  if (!isRecord(value) || value.ok !== true || !hasExactKeys(value, CONTEXT_SUCCESS_KEYS)) {
    return false;
  }
  if (value.workspaceId !== workspaceId || !isNonEmptyString(value.workspaceId)) {
    return false;
  }
  if (value.pageSize !== WORKSPACE_PROJECT_PAGE_SIZE) {
    return false;
  }
  if (value.nextCursor !== null && !isNonEmptyString(value.nextCursor)) {
    return false;
  }
  if (!Array.isArray(value.templates) || !Array.isArray(value.projects)) {
    return false;
  }
  for (const template of value.templates) {
    if (!isTemplateRecord(template)) {
      return false;
    }
  }
  for (const project of value.projects) {
    if (!isListedProject(project, workspaceId)) {
      return false;
    }
  }
  return true;
}
