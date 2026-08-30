import { useEffect, useState } from 'react';
import {
  actors,
  type PresentationStore,
  type PresentationSnapshot,
} from '../domain/presentation-store';
import type { Frame, PresentationElement, PresentationOperation } from '../domain/model';
import { downloadPptx } from '../client/pptx-download';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFrame(value: unknown): value is Frame {
  if (!isRecord(value)) {
    return false;
  }
  const { x, y, width, height } = value;
  return (
    typeof x === 'number' &&
    Number.isFinite(x) &&
    typeof y === 'number' &&
    Number.isFinite(y) &&
    typeof width === 'number' &&
    Number.isFinite(width) &&
    width > 0 &&
    typeof height === 'number' &&
    Number.isFinite(height) &&
    height > 0
  );
}

function isTextElement(value: unknown): value is PresentationElement {
  if (!isRecord(value) || value.kind !== 'text' || !isFrame(value.frame) || !isRecord(value.style)) {
    return false;
  }
  const { id, name, text, style } = value;
  return (
    typeof id === 'string' &&
    typeof name === 'string' &&
    typeof text === 'string' &&
    typeof style.color === 'string' &&
    typeof style.fontFamily === 'string' &&
    typeof style.fontSize === 'number' &&
    Number.isFinite(style.fontSize)
  );
}

function isShapeElement(value: unknown): value is PresentationElement {
  if (!isRecord(value) || value.kind !== 'shape' || !isFrame(value.frame)) {
    return false;
  }
  return typeof value.id === 'string' && typeof value.name === 'string' && typeof value.fill === 'string';
}

function parseOperation(value: unknown): PresentationOperation | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return undefined;
  }

  switch (value.type) {
    case 'update_text':
      if (
        typeof value.slideId === 'string' &&
        typeof value.elementId === 'string' &&
        typeof value.text === 'string'
      ) {
        return {
          type: 'update_text',
          slideId: value.slideId,
          elementId: value.elementId,
          text: value.text,
        };
      }
      return undefined;

    case 'update_frame':
      if (
        typeof value.slideId === 'string' &&
        typeof value.elementId === 'string' &&
        isFrame(value.frame)
      ) {
        return {
          type: 'update_frame',
          slideId: value.slideId,
          elementId: value.elementId,
          frame: value.frame,
        };
      }
      return undefined;

    case 'create_element':
      if (
        typeof value.slideId === 'string' &&
        (isTextElement(value.element) || isShapeElement(value.element))
      ) {
        return {
          type: 'create_element',
          slideId: value.slideId,
          element: value.element,
        };
      }
      return undefined;

    case 'delete_element':
      if (typeof value.slideId === 'string' && typeof value.elementId === 'string') {
        return {
          type: 'delete_element',
          slideId: value.slideId,
          elementId: value.elementId,
        };
      }
      return undefined;

    default:
      return undefined;
  }
}

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function slideSummary(snapshot: PresentationSnapshot, slideId: string): unknown {
  const slide = snapshot.presentation.slides[slideId];
  if (!slide) {
    return { found: false };
  }

  return {
    found: true,
    slide,
    comments: Object.values(snapshot.comments).filter((comment) => comment.slideId === slideId),
    revision: snapshot.presentation.revision,
  };
}

const noInputSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

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
          'Read the active Comake presentation outline, slide IDs, titles, element counts, and current revision before making changes.',
        inputSchema: noInputSchema,
        execute: () => {
          const { presentation, session } = store.getSnapshot();
          return stringify({
            id: presentation.id,
            title: presentation.title,
            revision: presentation.revision,
            activeSlideId: session.activeSlideId,
            slides: presentation.slideOrder.map((slideId, index) => {
              const slide = presentation.slides[slideId];
              const title = slide.elementOrder
                .map((elementId) => slide.elements[elementId])
                .find((element) => element.name === 'Title');
              return {
                index: index + 1,
                id: slide.id,
                name: slide.name,
                title: title?.kind === 'text' ? title.text : undefined,
                elementCount: slide.elementOrder.length,
              };
            }),
          });
        },
      },
      {
        name: 'read_presentation_slide',
        description:
          'Read one presentation slide by stable slide ID, including all editable elements and open comments.',
        inputSchema: {
          type: 'object',
          properties: {
            slideId: {
              type: 'string',
              description: 'Stable Comake slide ID from get_presentation_outline.',
            },
          },
          required: ['slideId'],
          additionalProperties: false,
        },
        execute: (input) => {
          if (!isRecord(input) || typeof input.slideId !== 'string') {
            return stringify({ ok: false });
          }
          return stringify(slideSummary(store.getSnapshot(), input.slideId));
        },
      },
      {
        name: 'apply_presentation_operations',
        description:
          'Apply one atomic, attributable set of presentation operations. Read the affected slide first. Use stable IDs only. Comake rejects stale or invalid changes as a whole.',
        inputSchema: {
          type: 'object',
          properties: {
            label: {
              type: 'string',
              description: 'A concise description of the intended collaborative change.',
            },
            operations: {
              type: 'array',
              description:
                'Operations of type update_text, update_frame, create_element, or delete_element. Each operation targets stable slide and element IDs.',
              items: { type: 'object' },
              minItems: 1,
            },
          },
          required: ['label', 'operations'],
          additionalProperties: false,
        },
        execute: (input) => {
          if (!isRecord(input) || typeof input.label !== 'string' || !Array.isArray(input.operations)) {
            return stringify({ ok: false });
          }
          const operations = input.operations.map(parseOperation);
          if (operations.some((operation) => operation === undefined)) {
            return stringify({ ok: false });
          }
          const result = store.dispatch({
            actor: actors.agent,
            label: input.label,
            operations: operations as PresentationOperation[],
          });
          return stringify(
            result.ok
              ? {
                  ok: true,
                  changeSetId: result.changeSet.id,
                  revision: result.changeSet.revision,
                }
              : { ok: false },
          );
        },
      },
      {
        name: 'add_presentation_comment',
        description:
          'Leave a visible comment under the agent identity when a fact, direction, or creative choice needs human review.',
        inputSchema: {
          type: 'object',
          properties: {
            slideId: { type: 'string' },
            elementId: { type: 'string' },
            body: { type: 'string' },
          },
          required: ['slideId', 'body'],
          additionalProperties: false,
        },
        execute: (input) => {
          if (
            !isRecord(input) ||
            typeof input.slideId !== 'string' ||
            typeof input.body !== 'string' ||
            !store.getSnapshot().presentation.slides[input.slideId]
          ) {
            return stringify({ ok: false });
          }
          const result = store.dispatch({
            actor: actors.agent,
            label: 'Left a comment',
            operations: [
              {
                type: 'add_comment',
                comment: {
                  id: crypto.randomUUID(),
                  actor: actors.agent,
                  body: input.body,
                  createdAt: new Date().toISOString(),
                  elementId: typeof input.elementId === 'string' ? input.elementId : undefined,
                  resolved: false,
                  slideId: input.slideId,
                },
              },
            ],
          });
          return stringify(result.ok ? { ok: true, changeSetId: result.changeSet.id } : { ok: false });
        },
      },
      {
        name: 'export_presentation_pptx',
        description: 'Export the current canonical presentation state as a PowerPoint .pptx file.',
        inputSchema: noInputSchema,
        execute: () => {
          downloadPptx(store.getSnapshot().presentation);
          return stringify({ ok: true });
        },
      },
    ];

    void Promise.all(
      tools.map((tool) => modelContext.registerTool(tool, { signal: controller.signal })),
    ).catch(() => {
      setIsAvailable(false);
    });

    return () => controller.abort();
  }, [store]);

  return isAvailable;
}
