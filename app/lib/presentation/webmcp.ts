import { useEffect, useState } from 'react';
import {
  parseToolInput,
  parseWriteInput,
  presentationWriteInputSchema,
  type ParseResult,
} from './operations';
import { downloadPptx } from './pptx-download';
import { agentActor } from './actors';
import {
  slideTitleText,
  PresentationStore,
  type DispatchFailure,
  type PresentationSnapshot,
} from './store';
import type { ChangeSet } from '../../types/presentation';

/**
 * WebMCP adapter: registers the page's self-describing tool contract on
 * `document.modelContext`. Every tool result is structured JSON; failures
 * carry a finite public code and repair-safe details only. All writes go
 * through the presentation store's dispatch owner.
 */

type ToolFailureCode =
  | 'CONFLICT'
  | 'INVALID_INPUT'
  | 'LOCKED_ELEMENT'
  | 'NOT_FOUND'
  | 'STALE_REVISION'
  | 'UNSUPPORTED';

interface RegisteredTool {
  description: string;
  execute: (input: unknown) => unknown | Promise<unknown>;
  inputSchema: Record<string, unknown>;
  name: string;
}

interface ModelContext {
  registerTool: (tool: RegisteredTool, options?: { signal?: AbortSignal }) => Promise<unknown>;
}

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
}

/** Bounded changeset window; the store's own history is larger and stays internal. */
const CHANGESET_READ_LIMIT = 12;

type ToolResult = Record<string, unknown>;

function toolFailure(code: ToolFailureCode, detail: string, extra?: ToolResult): ToolResult {
  return { ok: false, code, detail, ...extra };
}

function invalidInput(detail: string): ToolResult {
  return toolFailure('INVALID_INPUT', detail);
}

function dispatchFailureResult(failure: DispatchFailure): ToolResult {
  if (failure.code === 'STALE_REVISION') {
    return toolFailure(
      'STALE_REVISION',
      'The presentation revision no longer matches baseRevision. Re-read the presentation and retry.',
      { currentRevision: failure.currentRevision },
    );
  }
  return toolFailure(failure.code, failure.detail);
}

function writeSuccess(changeSet: ChangeSet): ToolResult {
  return {
    ok: true,
    changeSetId: changeSet.id,
    revision: changeSet.revision,
    operationCount: changeSet.operations.length,
  };
}

function describeChangeSet(changeSet: ChangeSet): ToolResult {
  const operationCounts: Record<string, number> = {};
  for (const operation of changeSet.operations) {
    operationCounts[operation.type] = (operationCounts[operation.type] ?? 0) + 1;
  }
  return {
    id: changeSet.id,
    actor: { kind: changeSet.actor.kind, name: changeSet.actor.name },
    label: changeSet.label,
    revision: changeSet.revision,
    createdAt: changeSet.createdAt,
    reverted: changeSet.revertedAt !== undefined,
    operationCounts,
  };
}

function parseToolString(input: Record<string, unknown>, key: string): ParseResult<string> {
  const value = input[key];
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, detail: `${key} must be a non-empty string.` };
  }
  return { ok: true, value };
}

function noInputSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {},
    additionalProperties: false,
  };
}

export function useWebMcp(store: PresentationStore): boolean {
  const [isAvailable, setIsAvailable] = useState(false);

  useEffect(() => {
    const modelContext = document.modelContext;
    setIsAvailable(Boolean(modelContext));
    if (!modelContext) {
      return undefined;
    }

    const controller = new AbortController();
    const tools: RegisteredTool[] = [
      {
        name: 'get_presentation_outline',
        description:
          'Read the presentation outline: title, current revision, the slide the human is viewing, and every slide with its stable id, name, title text, and element count. Start here to discover stable slide ids and the current revision.',
        inputSchema: noInputSchema(),
        execute: (input) => {
          const parsed = parseToolInput(input, []);
          if (!parsed.ok) {
            return invalidInput(parsed.detail);
          }
          const { presentation, session } = store.getSnapshot();
          return {
            ok: true,
            presentation: {
              id: presentation.id,
              title: presentation.title,
              revision: presentation.revision,
              activeSlideId: session.activeSlideId,
              slides: presentation.slideOrder.map((slideId, index) => {
                const slide = presentation.slides[slideId];
                return {
                  index: index + 1,
                  id: slide.id,
                  name: slide.name,
                  title: slideTitleText(slide),
                  elementCount: slide.elementOrder.length,
                };
              }),
            },
          };
        },
      },
      {
        name: 'read_presentation_slide',
        description:
          'Read one slide by its stable slide id: background, every element with its full shape (id, kind, name, frame, text and style, or fill), and all comments on the slide. Read a slide before editing it, and re-read it after any rejection.',
        inputSchema: {
          type: 'object',
          properties: {
            slideId: {
              type: 'string',
              description: 'Stable Comake slide id from get_presentation_outline.',
            },
          },
          required: ['slideId'],
          additionalProperties: false,
        },
        execute: (input) => {
          const parsed = parseToolInput(input, ['slideId']);
          if (!parsed.ok) {
            return invalidInput(parsed.detail);
          }
          const slideId = parseToolString(parsed.value, 'slideId');
          if (!slideId.ok) {
            return invalidInput(slideId.detail);
          }
          const snapshot = store.getSnapshot();
          const slide = snapshot.presentation.slides[slideId.value];
          if (!slide) {
            return toolFailure('NOT_FOUND', `No slide "${slideId.value}" in this presentation.`);
          }
          return {
            ok: true,
            revision: snapshot.presentation.revision,
            slide,
            comments: Object.values(snapshot.comments).filter((comment) => comment.slideId === slideId.value),
          };
        },
      },
      {
        name: 'apply_presentation_operations',
        description:
          'Apply one atomic, attributed set of presentation operations: update_text, update_frame, create_element, delete_element, add_comment, remove_comment, or resolve_comment. The whole set is rejected when baseRevision does not match the current revision or when any operation is invalid; nothing is partially applied. Echo element and comment shapes exactly as read_presentation_slide returned them.',
        inputSchema: presentationWriteInputSchema,
        execute: (input) => {
          const parsed = parseWriteInput(input);
          if (!parsed.ok) {
            return invalidInput(parsed.detail);
          }
          const result = store.dispatch({
            actor: agentActor,
            baseRevision: parsed.value.baseRevision,
            label: parsed.value.label,
            operations: parsed.value.operations,
          });
          return result.ok ? writeSuccess(result.changeSet) : dispatchFailureResult(result.failure);
        },
      },
      {
        name: 'add_presentation_comment',
        description:
          'Leave a comment under the agent identity on one slide, optionally attached to an element, when a fact, direction, or creative choice needs human review. The comment id and timestamp are created for you.',
        inputSchema: {
          type: 'object',
          properties: {
            slideId: { type: 'string', description: 'Stable slide id the comment belongs to.' },
            elementId: {
              type: 'string',
              description: 'Optional stable element id the comment is attached to.',
            },
            body: { type: 'string', minLength: 1 },
          },
          required: ['slideId', 'body'],
          additionalProperties: false,
        },
        execute: (input) => {
          const parsed = parseToolInput(input, ['body', 'elementId', 'slideId']);
          if (!parsed.ok) {
            return invalidInput(parsed.detail);
          }
          const slideId = parseToolString(parsed.value, 'slideId');
          if (!slideId.ok) {
            return invalidInput(slideId.detail);
          }
          const body = parseToolString(parsed.value, 'body');
          if (!body.ok) {
            return invalidInput(body.detail);
          }
          const elementId =
            parsed.value.elementId === undefined
              ? { ok: true as const, value: undefined }
              : parseToolString(parsed.value, 'elementId');
          if (!elementId.ok) {
            return invalidInput(elementId.detail);
          }

          const comment = {
            id: crypto.randomUUID(),
            actor: agentActor,
            body: body.value,
            createdAt: new Date().toISOString(),
            elementId: elementId.value,
            resolved: false,
            slideId: slideId.value,
          };
          const result = store.dispatch({
            actor: agentActor,
            label: 'Left a comment',
            operations: [{ type: 'add_comment', comment }],
          });
          if (!result.ok) {
            return dispatchFailureResult(result.failure);
          }
          return {
            ok: true,
            changeSetId: result.changeSet.id,
            revision: result.changeSet.revision,
            commentId: comment.id,
          };
        },
      },
      {
        name: 'resolve_presentation_comment',
        description:
          'Mark one comment resolved by its stable comment id. Resolving an already-resolved comment is rejected.',
        inputSchema: {
          type: 'object',
          properties: {
            commentId: { type: 'string', description: 'Stable comment id from read_presentation_slide.' },
          },
          required: ['commentId'],
          additionalProperties: false,
        },
        execute: (input) => {
          const parsed = parseToolInput(input, ['commentId']);
          if (!parsed.ok) {
            return invalidInput(parsed.detail);
          }
          const commentId = parseToolString(parsed.value, 'commentId');
          if (!commentId.ok) {
            return invalidInput(commentId.detail);
          }
          const result = store.dispatch({
            actor: agentActor,
            label: 'Resolved a comment',
            operations: [
              {
                type: 'resolve_comment',
                commentId: commentId.value,
                resolved: true,
                expectedResolved: false,
              },
            ],
          });
          if (!result.ok) {
            return dispatchFailureResult(result.failure);
          }
          return {
            ok: true,
            changeSetId: result.changeSet.id,
            revision: result.changeSet.revision,
            commentId: commentId.value,
          };
        },
      },
      {
        name: 'list_presentation_changesets',
        description:
          'List the most recent attributed changesets: actor kind and name, label, revision, timestamp, reverted status, and per-operation-type counts. Bounded to the latest 12; older history is not exposed.',
        inputSchema: noInputSchema(),
        execute: (input) => {
          const parsed = parseToolInput(input, []);
          if (!parsed.ok) {
            return invalidInput(parsed.detail);
          }
          const snapshot: PresentationSnapshot = store.getSnapshot();
          const latestIds = snapshot.changeSetOrder.slice(-CHANGESET_READ_LIMIT).reverse();
          return {
            ok: true,
            revision: snapshot.presentation.revision,
            changesets: latestIds.map((id) => describeChangeSet(snapshot.changeSets[id])),
          };
        },
      },
      {
        name: 'export_presentation_pptx',
        description:
          'Export the current canonical presentation as a PowerPoint .pptx file downloaded by the browser.',
        inputSchema: noInputSchema(),
        execute: (input) => {
          const parsed = parseToolInput(input, []);
          if (!parsed.ok) {
            return invalidInput(parsed.detail);
          }
          try {
            const filename = downloadPptx(store.getSnapshot().presentation);
            return { ok: true, filename };
          } catch (error) {
            console.error('[webmcp] pptx export failed:', error);
            return toolFailure('UNSUPPORTED', 'The presentation could not be exported in this environment.');
          }
        },
      },
    ];

    void Promise.all(
      tools.map((tool) => modelContext.registerTool(tool, { signal: controller.signal })),
    ).catch((error) => {
      console.error('[webmcp] tool registration failed:', error);
      setIsAvailable(false);
    });

    return () => controller.abort();
  }, [store]);

  return isAvailable;
}
