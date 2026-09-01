import type { ClientDispatchRequest } from '../presentation/attribution';
import type {
  DispatchFailure,
  DispatchResult,
  PresentationDocument,
} from '../presentation/document';
import { isRecord, parseOperation, type ParseResult } from '../presentation/operations';

/**
 * The pure HTTP contract of the canonical project API: strict parsing of the
 * dispatch envelope and the project-creation form, HTTP status mapping for
 * kernel rejections, and the JSON response envelope. No bindings, no storage,
 * no React Router — fully unit-testable in Node.
 *
 * Failure codes are the kernel's `DispatchFailure` vocabulary plus HTTP-layer
 * codes this boundary owns: `METHOD_NOT_ALLOWED`, `INTERNAL_ERROR`,
 * `FORBIDDEN`, and `SERVICE_UNAVAILABLE`. Details are client-safe: they name
 * the rejected subject, never internals.
 */

/** Shared-cache isolation for cookie-gated HTML/JSON. */
export const PRIVATE_NO_STORE = 'private, no-store';

/** The one workspace creation intent the creation form accepts. */
export const CREATE_PROJECT_INTENT = 'create-project';

/** Hard upper bound of a project title, enforced at the form boundary. */
export const MAX_PROJECT_TITLE_LENGTH = 100;

function jsonHeaders(): HeadersInit {
  return { 'Cache-Control': PRIVATE_NO_STORE };
}

/** A strictly validated project-creation form; `value` is ready for the registry. */
export type CreateProjectFormResult =
  | { ok: true; value: { templateId: string; title?: string } }
  | { ok: false; detail: string };

/**
 * Parse and strictly validate an untrusted creation form. The intent and the
 * template id are required; the title is optional, trimmed, bounded in
 * length, and free of control characters. Unknown fields are rejected so a
 * changed form can never slip an unvalidated value through.
 */
export function parseCreateProjectForm(form: FormData): CreateProjectFormResult {
  let unknownField: string | undefined;
  form.forEach((_value, key) => {
    if (key !== 'intent' && key !== 'templateId' && key !== 'title') {
      unknownField = key;
    }
  });
  if (unknownField !== undefined) {
    return { ok: false, detail: 'The creation form contains an unknown field.' };
  }
  if (form.get('intent') !== CREATE_PROJECT_INTENT) {
    return { ok: false, detail: 'The creation form is missing its action.' };
  }
  const templateId = form.get('templateId');
  if (typeof templateId !== 'string' || templateId.length === 0) {
    return { ok: false, detail: 'Choose a template to create a presentation.' };
  }
  const titleInput = form.get('title');
  let title: string | undefined;
  if (titleInput !== null) {
    if (typeof titleInput !== 'string') {
      return { ok: false, detail: 'The presentation title must be text.' };
    }
    title = titleInput.trim();
    if (title.length === 0) {
      title = undefined;
    } else if (title.length > MAX_PROJECT_TITLE_LENGTH) {
      return { ok: false, detail: `The presentation title can be ${MAX_PROJECT_TITLE_LENGTH} characters at most.` };
    } else if (/[\u0000-\u001f\u007f]/.test(title)) {
      return { ok: false, detail: 'The presentation title cannot contain control characters.' };
    }
  }
  const value: { templateId: string; title?: string } = { templateId };
  if (title !== undefined) {
    value.title = title;
  }
  return { ok: true, value };
}

function parseFailure(detail: string): { ok: false; detail: string } {
  return { ok: false, detail };
}

/** Parse and strictly validate an untrusted client dispatch envelope. */
export function parseDispatchRequest(input: unknown): ParseResult<ClientDispatchRequest> {
  if (!isRecord(input)) {
    return parseFailure('The dispatch request must be a JSON object.');
  }
  for (const key of Object.keys(input)) {
    if (
      key !== 'actorKind' &&
      key !== 'baseRevision' &&
      key !== 'label' &&
      key !== 'operations' &&
      key !== 'revertsChangeSetId'
    ) {
      return parseFailure(`The dispatch request has unknown property "${key}".`);
    }
  }

  if (input.actorKind !== 'human' && input.actorKind !== 'agent') {
    return parseFailure('The actor kind must be "human" or "agent".');
  }

  if (typeof input.label !== 'string' || input.label.length === 0) {
    return parseFailure('The label must be a non-empty string.');
  }

  let baseRevision: number | undefined;
  if (input.baseRevision !== undefined) {
    if (typeof input.baseRevision !== 'number' || !Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0) {
      return parseFailure('The base revision must be a non-negative safe integer.');
    }
    baseRevision = input.baseRevision;
  }

  let revertsChangeSetId: string | undefined;
  if (input.revertsChangeSetId !== undefined) {
    if (typeof input.revertsChangeSetId !== 'string' || input.revertsChangeSetId.length === 0) {
      return parseFailure('The reverted change set id must be a non-empty string.');
    }
    revertsChangeSetId = input.revertsChangeSetId;
  }

  if (!Array.isArray(input.operations)) {
    return parseFailure('The operations must be an array.');
  }
  const operations = [];
  for (const [index, operation] of input.operations.entries()) {
    const parsed = parseOperation(operation);
    if (!parsed.ok) {
      return parseFailure(`Operation at index ${index} is invalid: ${parsed.detail}`);
    }
    operations.push(parsed.value);
  }

  return {
    ok: true,
    value: {
      actorKind: input.actorKind,
      baseRevision,
      label: input.label,
      operations,
      revertsChangeSetId,
    },
  };
}

/** HTTP status of a kernel rejection. */
export function dispatchFailureStatus(failure: DispatchFailure): number {
  switch (failure.code) {
    case 'INVALID_INPUT':
      return 400;
    case 'NOT_FOUND':
      return 404;
    case 'CONFLICT':
    case 'LOCKED_ELEMENT':
    case 'STALE_REVISION':
      return 409;
  }
}

/** The canonical dispatch response: the kernel result with a mapped status. */
export function jsonDispatchResponse(result: DispatchResult): Response {
  if (result.ok) {
    return Response.json(result, { headers: jsonHeaders() });
  }
  return Response.json(result, { status: dispatchFailureStatus(result.failure), headers: jsonHeaders() });
}

/** The canonical document-read response; a missing document is a real 404. */
export function jsonDocumentResponse(document: PresentationDocument | null): Response {
  if (!document) {
    return jsonNotFound('No project exists with this id.');
  }
  return Response.json({ ok: true, document }, { headers: jsonHeaders() });
}

export function jsonNotFound(detail: string): Response {
  return Response.json({ ok: false, failure: { code: 'NOT_FOUND', detail } }, { status: 404, headers: jsonHeaders() });
}

export function jsonInvalidDispatch(detail: string): Response {
  return Response.json(
    { ok: false, failure: { code: 'INVALID_INPUT', detail } },
    { status: 400, headers: jsonHeaders() },
  );
}

export function jsonForbiddenResponse(): Response {
  return Response.json(
    { ok: false, failure: { code: 'FORBIDDEN', detail: 'The request could not be completed. Please try again.' } },
    { status: 403, headers: jsonHeaders() },
  );
}

export function jsonMethodNotAllowedResponse(): Response {
  return Response.json(
    { ok: false, failure: { code: 'METHOD_NOT_ALLOWED', detail: 'This endpoint does not support this HTTP method.' } },
    { status: 405, headers: jsonHeaders() },
  );
}

export function jsonInternalErrorResponse(): Response {
  return Response.json(
    { ok: false, failure: { code: 'INTERNAL_ERROR', detail: 'The request could not be completed. Please try again.' } },
    { status: 500, headers: jsonHeaders() },
  );
}

export function jsonServiceUnavailableResponse(): Response {
  return Response.json(
    {
      ok: false,
      failure: { code: 'SERVICE_UNAVAILABLE', detail: 'The request could not be completed. Please try again.' },
    },
    { status: 503, headers: jsonHeaders() },
  );
}
