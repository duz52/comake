import { MAX_PRESENTATION_TITLE_LENGTH } from '../presentation/document';
import { isRecord } from '../presentation/operations';
import type { RegisteredTool } from '../presentation/webmcp-registration';
import {
  parseCreatePresentationInput,
  parseWorkspaceContextInput,
  workspaceApiPath,
} from './protocol';

/**
 * Workspace WebMCP tools: list/create for the current session. Results are
 * structured JSON. Tools never navigate; create returns an editorUrl the
 * caller can open.
 */

type ToolFailureCode = 'INVALID_INPUT' | 'NOT_FOUND' | 'TRANSPORT_ERROR' | 'UNKNOWN_TEMPLATE';

type ToolResult = Record<string, unknown>;

type WorkspaceFetch = typeof fetch;

function toolFailure(code: ToolFailureCode, detail: string, extra?: ToolResult): ToolResult {
  return { ok: false, code, detail, ...extra };
}

function invalidInput(detail: string): ToolResult {
  return toolFailure('INVALID_INPUT', detail);
}

function createPresentationInputSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        minLength: 1,
        maxLength: MAX_PRESENTATION_TITLE_LENGTH,
        description: `Required presentation title. Non-empty after trim, at most ${MAX_PRESENTATION_TITLE_LENGTH} characters, no control characters.`,
      },
      templateId: {
        type: 'string',
        minLength: 1,
        description:
          'Optional stable template id from get_workspace_context. Omission creates a blank presentation.',
      },
    },
    required: ['title'],
    additionalProperties: false,
  };
}

function failureFromBody(body: Record<string, unknown>): ToolResult | undefined {
  if (body.ok !== false || !isRecord(body.failure)) {
    return undefined;
  }
  const code = body.failure.code;
  const detail = body.failure.detail;
  if (typeof code !== 'string' || typeof detail !== 'string') {
    return undefined;
  }
  if (code === 'INVALID_INPUT' || code === 'NOT_FOUND' || code === 'UNKNOWN_TEMPLATE') {
    const extra: ToolResult = {};
    if (typeof body.failure.templateId === 'string') {
      extra.templateId = body.failure.templateId;
    }
    return toolFailure(code, detail, extra);
  }
  return undefined;
}

async function workspaceRequest(
  request: WorkspaceFetch,
  url: string,
  init: RequestInit,
): Promise<ToolResult> {
  let response: Response;
  try {
    response = await request(url, { credentials: 'same-origin', ...init });
  } catch (error) {
    console.error('[webmcp] workspace request failed:', error);
    return toolFailure('TRANSPORT_ERROR', 'The request could not be completed. Please try again.');
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    console.error('[webmcp] workspace response was not JSON:', error);
    return toolFailure('TRANSPORT_ERROR', 'The request could not be completed. Please try again.');
  }

  if (!isRecord(body)) {
    console.error('[webmcp] unexpected workspace response:', body);
    return toolFailure('TRANSPORT_ERROR', 'The request could not be completed. Please try again.');
  }

  if (body.ok === true) {
    return body;
  }

  const structured = failureFromBody(body);
  if (structured) {
    return structured;
  }

  console.error('[webmcp] unexpected workspace response:', body);
  return toolFailure('TRANSPORT_ERROR', 'The request could not be completed. Please try again.');
}

/**
 * The workspace tool set. `request` is injectable so registration and
 * execute can be tested without a browser network.
 */
export function workspaceWebMcpTools(
  workspaceId: string,
  request: WorkspaceFetch = fetch,
): RegisteredTool[] {
  const apiPath = workspaceApiPath(workspaceId);
  return [
    {
      name: 'get_workspace_context',
      description:
        'Start here on the workspace home. Read the public workspace id, the template catalog (stable id, title, slide count), and this session\'s projects (stable id, title, updatedAt, editorUrl). The project list is a finite page (pageSize); when more projects exist, nextCursor is a non-null opaque token to pass back as cursor. Open a project\'s editorUrl to edit that presentation. This tool does not navigate the browser.',
      inputSchema: {
        type: 'object',
        properties: {
          cursor: {
            type: 'string',
            minLength: 1,
            description:
              'Opaque listing cursor from a previous get_workspace_context nextCursor. Omit for the first page.',
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        const parsed = parseWorkspaceContextInput(input);
        if (!parsed.ok) {
          return invalidInput(parsed.detail);
        }
        return workspaceRequest(request, workspaceApiPath(workspaceId, parsed.value), { method: 'GET' });
      },
    },
    {
      name: 'create_presentation',
      description:
        'Create one owned presentation in this workspace. title is required. templateId is optional and defaults to the blank template. Returns project id, initial slide id, title, template id, and editorUrl. Open editorUrl yourself; this tool does not navigate.',
      inputSchema: createPresentationInputSchema(),
      execute: async (input) => {
        const parsed = parseCreatePresentationInput(input);
        if (!parsed.ok) {
          return invalidInput(parsed.detail);
        }
        return workspaceRequest(request, apiPath, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: parsed.value.title,
            templateId: parsed.value.templateId,
          }),
        });
      },
    },
  ];
}
