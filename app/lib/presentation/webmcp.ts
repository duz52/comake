import { useEffect, useState } from 'react';
import {
  controlPresentationInputSchema,
  isRecord,
  parseControlPresentationInput,
  parseToolInput,
  parseWriteInput,
  presentationWriteInputSchema,
  type ParseResult,
} from './operations';
import { downloadPptx } from './pptx-download';
import { DEMO_DISPLAY_NAME } from './actors';
import { slideTitleText, type DispatchFailure } from './document';
import {
  presentViewFrom,
  PresentationStore,
  type PresentationSnapshot,
  type PresentResult,
  type TransportFailure,
} from './store';
import { startWebMcpRegistration, type RegisteredTool } from './webmcp-registration';
import type { ChangeSet, Frame, Presentation, Slide } from '../../types/presentation';

/**
 * WebMCP adapter: registers the page's self-describing tool contract on
 * `document.modelContext`. Every tool result is structured JSON; failures
 * carry a finite public code and repair-safe details only. All writes go
 * through the presentation store's dispatch owner.
 */

type ToolFailureCode =
  | 'AT_BOUNDARY'
  | 'CONFLICT'
  | 'INVALID_INPUT'
  | 'LOCKED_ELEMENT'
  | 'NOT_FOUND'
  | 'NOT_PRESENTING'
  | 'STALE_REVISION'
  | 'TRANSPORT_ERROR'
  | 'UNSUPPORTED';

/** Bounded changeset window; the store's own history is larger and stays internal. */
const CHANGESET_READ_LIMIT = 12;

type ToolResult = Record<string, unknown>;

function toolFailure(code: ToolFailureCode, detail: string, extra?: ToolResult): ToolResult {
  return { ok: false, code, detail, ...extra };
}

function invalidInput(detail: string): ToolResult {
  return toolFailure('INVALID_INPUT', detail);
}

function dispatchFailureResult(failure: DispatchFailure | TransportFailure): ToolResult {
  if (failure.code === 'STALE_REVISION') {
    return toolFailure(
      'STALE_REVISION',
      'The presentation revision no longer matches baseRevision. Re-read the presentation and retry.',
      { currentRevision: failure.currentRevision },
    );
  }
  if (failure.code === 'TRANSPORT_ERROR') {
    return toolFailure(
      'TRANSPORT_ERROR',
      'The presentation server could not be reached. Re-read the presentation and retry.',
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
  return parseNonEmptyStringValue(input[key], key);
}

function parseNonEmptyStringValue(value: unknown, subject: string): ParseResult<string> {
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, detail: `${subject} must be a non-empty string.` };
  }
  return { ok: true, value };
}

function parseOptionalInput<T>(value: unknown, parse: (entry: unknown) => ParseResult<T>): ParseResult<T | undefined> {
  return value === undefined ? { ok: true, value: undefined } : parse(value);
}

function noInputSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {},
    additionalProperties: false,
  };
}

/** Canonical canvas geometry: slide-point units, origin at the top-left, x right / y down. */
function describeCoordinateSpace(size: Presentation['size']): ToolResult {
  return {
    origin: 'top-left',
    unit: 'slide-point',
    xAxis: 'right',
    yAxis: 'down',
    width: size.width,
    height: size.height,
  };
}

function describeSlide(slideId: string, index: number, slide: Slide): ToolResult {
  return {
    id: slideId,
    index,
    name: slide.name,
  };
}

function flattenPresentView(view: ReturnType<typeof presentViewFrom>): ToolResult {
  return {
    presenting: view.presenting,
    focusRevision: view.focusRevision,
    activeSlide: view.activeSlide,
    atStart: view.atStart,
    atEnd: view.atEnd,
  };
}

function controlPresentationToolResult(
  result: PresentResult | { ok: false; action?: string; code: ToolFailureCode; detail: string; view: ReturnType<typeof presentViewFrom> },
): ToolResult {
  const body: ToolResult = {
    ok: result.ok,
    ...flattenPresentView(result.view),
  };
  if ('action' in result && result.action !== undefined) {
    body.action = result.action;
  }
  if (!result.ok) {
    body.code = result.code;
    body.detail = result.detail;
  }
  return body;
}

/**
 * Compact element record for the spatial map: geometry and content only.
 * Text styling and shape strokes are intentionally omitted as decoration
 * detail; read_presentation_slide carries the complete canonical value.
 */
function spatialElementRecord(slide: Slide, elementId: string, zIndex: number): ToolResult {
  const element = slide.elements[elementId];
  const record: ToolResult = {
    id: element.id,
    kind: element.kind,
    name: element.name,
    frame: element.frame,
    zIndex,
    locked: element.locked ?? false,
  };
  if (element.rotation !== undefined) {
    record.rotation = element.rotation;
  }
  if (element.kind === 'text') {
    record.text = element.text;
  } else {
    record.geometry = element.style.geometry;
    record.fill = element.style.fill;
  }
  return record;
}

/** Inclusive-edge rectangle intersection in slide coordinates. */
function framesIntersect(left: Frame, right: Frame): boolean {
  return (
    left.x <= right.x + right.width &&
    right.x <= left.x + left.width &&
    left.y <= right.y + right.height &&
    right.y <= left.y + left.height
  );
}

function parseQueryCoordinate(value: unknown, subject: string): ParseResult<number> {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, detail: `${subject} must be a finite number.` };
  }
  return { ok: true, value };
}

function parseQueryExtent(value: unknown, subject: string): ParseResult<number> {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return { ok: false, detail: `${subject} must be a positive finite number.` };
  }
  return { ok: true, value };
}

/**
 * Region parser for the spatial map's read-only query rectangle. Unlike the
 * canonical element frame parser, a region is not placed on the canvas: matching
 * is intersection-based, so it may start anywhere and extend beyond the slide —
 * negative origins and bounds past the 960x540 canvas are valid. Only finite
 * coordinates and a positive finite size are enforced, with repair-safe details.
 */
export function parseQueryRegion(value: unknown): ParseResult<Frame> {
  if (!isRecord(value)) {
    return { ok: false, detail: 'region must be an object.' };
  }
  for (const key of Object.keys(value)) {
    if (key !== 'x' && key !== 'y' && key !== 'width' && key !== 'height') {
      return { ok: false, detail: `region has unknown property "${key}".` };
    }
  }
  const x = parseQueryCoordinate(value.x, 'region.x');
  if (!x.ok) return x;
  const y = parseQueryCoordinate(value.y, 'region.y');
  if (!y.ok) return y;
  const width = parseQueryExtent(value.width, 'region.width');
  if (!width.ok) return width;
  const height = parseQueryExtent(value.height, 'region.height');
  if (!height.ok) return height;
  return { ok: true, value: { x: x.value, y: y.value, width: width.value, height: height.value } };
}

/**
 * One slide's elements matching the optional region rectangle and/or the
 * optional case-insensitive query (names and text content), in canonical z
 * order. Single pass over the slide's elements; the region is an intersection
 * query, so it may lie partly or wholly outside the slide.
 */
export function querySpatialElements(
  slide: Slide,
  region: Frame | undefined,
  query: string | undefined,
): ToolResult[] {
  const normalizedQuery = query?.toLowerCase();
  return slide.elementOrder
    .map((elementId, zIndex) => ({ elementId, zIndex }))
    .filter(({ elementId }) => {
      const element = slide.elements[elementId];
      if (region && !framesIntersect(element.frame, region)) {
        return false;
      }
      if (
        normalizedQuery &&
        !element.name.toLowerCase().includes(normalizedQuery) &&
        !(element.kind === 'text' && element.text.toLowerCase().includes(normalizedQuery))
      ) {
        return false;
      }
      return true;
    })
    .map(({ elementId, zIndex }) => spatialElementRecord(slide, elementId, zIndex));
}

/**
 * The full canonical description of one selected element: stable identity,
 * canonical frame, z order, and the complete canonical element value
 * (text/style or geometry, fill, and stroke).
 */
function describeSelectedElement(slide: Slide, elementId: string): unknown {
  const element = slide.elements[elementId];
  const selection: ToolResult = {
    id: element.id,
    kind: element.kind,
    name: element.name,
    frame: element.frame,
    locked: element.locked ?? false,
    zIndex: slide.elementOrder.indexOf(element.id),
    value: element,
  };
  if (element.rotation !== undefined) {
    selection.rotation = element.rotation;
  }
  return selection;
}

/**
 * The native presentation tool set. Execute closures read `store.getSnapshot()`
 * live; registration must call this once per store, not per slide or mode.
 */
export function presentationWebMcpTools(store: PresentationStore): RegisteredTool[] {
  return [
      {
        name: 'get_presentation_context',
        description:
          'Start here. Read the current human focus and the canonical canvas: document revision, focus revision, whether the slideshow is active (presenting), presentation id and title, the canonical coordinateSpace, the active slide the audience sees (stable id, one-based index, name, title), and the human selection (elementIds plus, for each selected element, kind, name, full canonical frame, optional rotation, locked flag, zIndex, and its full canonical value: text and style, or geometry, fill, and stroke; both arrays are empty when nothing is selected). To start, move next/previous, jump to a slide, or exit the slideshow, call control_presentation — do not screenshot. Call get_presentation_spatial_map or read_presentation_slide from here only when you need a specific slide in more detail.',
        inputSchema: noInputSchema(),
        annotations: { readOnlyHint: true },
        execute: (input) => {
          const parsed = parseToolInput(input, []);
          if (!parsed.ok) {
            return invalidInput(parsed.detail);
          }
          const { presentation, session } = store.getSnapshot();
          const activeSlide = presentation.slides[session.activeSlideId];
          return {
            ok: true,
            revision: presentation.revision,
            focusRevision: session.focusRevision,
            presenting: session.presenting,
            presentation: {
              id: presentation.id,
              title: presentation.title,
            },
            coordinateSpace: describeCoordinateSpace(presentation.size),
            activeSlide: {
              ...describeSlide(activeSlide.id, presentation.slideOrder.indexOf(activeSlide.id) + 1, activeSlide),
              title: slideTitleText(activeSlide),
            },
            selection: {
              elementIds: session.selectedElementIds,
              elements: session.selectedElementIds.map((elementId) =>
                describeSelectedElement(activeSlide, elementId),
              ),
            },
          };
        },
      },
      {
        name: 'get_presentation_spatial_map',
        description:
          'Read the compact structured canvas of one slide by its stable slide id: the canonical coordinateSpace, slide id/one-based index/name/background, and every element in canonical z order with its id, kind, name, frame, zIndex, locked flag, and content (text, or geometry and fill) — text styling and shape strokes are intentionally omitted. Optionally narrow the result with a rectangular region (elements whose frame intersects it, edges inclusive) and/or a case-insensitive query matched against element names and text content; totalElementCount always reports the slide\'s full element count. Prefer this for geometry; use read_presentation_slide only when you need exact styles or comments.',
        inputSchema: {
          type: 'object',
          properties: {
            slideId: {
              type: 'string',
              description: 'Stable Comake slide id from get_presentation_context or get_presentation_outline.',
            },
            region: {
              type: 'object',
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
                width: { type: 'number', exclusiveMinimum: 0 },
                height: { type: 'number', exclusiveMinimum: 0 },
              },
              required: ['x', 'y', 'width', 'height'],
              additionalProperties: false,
              description:
                'Optional rectangular query region in slide coordinates (origin top-left, x right, y down): only elements whose frame intersects it, edges inclusive, are returned. The region is a query, not a placed frame — it may extend beyond the slide, so negative origins and bounds past the 960x540 canvas are accepted.',
            },
            query: {
              type: 'string',
              minLength: 1,
              description:
                'Optional case-insensitive substring matched against each element\'s name and text content.',
            },
          },
          required: ['slideId'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        execute: (input) => {
          const parsed = parseToolInput(input, ['query', 'region', 'slideId']);
          if (!parsed.ok) {
            return invalidInput(parsed.detail);
          }
          const slideId = parseToolString(parsed.value, 'slideId');
          if (!slideId.ok) {
            return invalidInput(slideId.detail);
          }
          const region = parseOptionalInput(parsed.value.region, parseQueryRegion);
          if (!region.ok) {
            return invalidInput(region.detail);
          }
          const query = parseOptionalInput(parsed.value.query, (entry) => parseNonEmptyStringValue(entry, 'query'));
          if (!query.ok) {
            return invalidInput(query.detail);
          }
          const snapshot = store.getSnapshot();
          const slide = snapshot.presentation.slides[slideId.value];
          if (!slide) {
            return toolFailure('NOT_FOUND', `No slide "${slideId.value}" in this presentation.`);
          }
          return {
            ok: true,
            revision: snapshot.presentation.revision,
            coordinateSpace: describeCoordinateSpace(snapshot.presentation.size),
            slide: {
              ...describeSlide(slide.id, snapshot.presentation.slideOrder.indexOf(slide.id) + 1, slide),
              background: slide.background,
            },
            totalElementCount: slide.elementOrder.length,
            elements: querySpatialElements(slide, region.value, query.value),
          };
        },
      },
      {
        name: 'get_presentation_outline',
        description:
          'Read the presentation outline: title, current revision, whether the slideshow is active (presenting), the slide the audience sees (activeSlideId), and every slide with its stable id, name, title text, and element count. After get_presentation_context, use this to enumerate slides beyond the active one and to discover stable slide ids for control_presentation go_to_slide.',
        inputSchema: noInputSchema(),
        annotations: { readOnlyHint: true },
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
              presenting: session.presenting,
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
          'Read one slide by its stable slide id in full detail: background, every element with its complete canonical shape (id, kind, name, frame, text and style, or geometry, fill, and stroke), and all comments on the slide. Use this when you need exact text styling, shape styles, or comments; for geometry-only reads prefer the lighter get_presentation_spatial_map. Read a slide before editing it, and re-read it after any rejection.',
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
        annotations: { readOnlyHint: true },
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
          'Apply one atomic, attributed set of presentation operations: update_text, update_text_style (complete replacement text style), update_frame, update_shape_style (complete replacement shape style: geometry, fill, and stroke), update_element_order (an exact permutation of one slide\'s element ids), update_slide (complete replacement slide name/background/notes), update_presentation (complete replacement presentation title), create_slide, delete_slide, create_element, delete_element, add_comment, remove_comment, or resolve_comment. Every write must supply baseRevision, the revision you last read; if the presentation has advanced past it or any operation is invalid, the whole set is rejected and nothing is partially applied. Reference slides, elements, and comments by their stable ids exactly as the read tools returned them. To rename the presentation, use update_presentation with the complete replacement title and an optional expectedTitle guard. To add a slide, use create_slide with the complete slide shape and an optional zero-based insertAt in the current slide order (0 inserts before the first slide; omission appends at the end), then create its elements with create_element operations in the same set, targeting the new slide\'s stable id — a new slide and its elements are created atomically. To add an element, use create_element with the complete element shape and an optional zero-based insertAt in the slide\'s element order (0 inserts behind everything; omission appends at the top). To delete a slide, use delete_slide by its stable id; the final slide can never be deleted; if the slide has comments, issue their remove_comment operations before delete_slide in the same atomic batch, which preserves canonical integrity and keeps the changeset reversible. To delete an element, use delete_element by its stable slide and element ids; if the element has comments attached to it, issue their remove_comment operations before delete_element in the same atomic batch, which preserves canonical integrity and keeps the changeset reversible. Element frames must fit inside the canonical presentation bounds, and colors must be strict #RRGGBB hex values. Echo element and comment shapes exactly as read_presentation_slide returned them.',
        inputSchema: presentationWriteInputSchema,
        execute: async (input) => {
          const parsed = parseWriteInput(input);
          if (!parsed.ok) {
            return invalidInput(parsed.detail);
          }
          const result = await store.dispatch({
            actorKind: 'agent',
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
        execute: async (input) => {
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
            actor: { id: 'client', kind: 'agent' as const, name: DEMO_DISPLAY_NAME },
            body: body.value,
            createdAt: new Date().toISOString(),
            elementId: elementId.value,
            resolved: false,
            slideId: slideId.value,
          };
          const result = await store.dispatch({
            actorKind: 'agent',
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
        execute: async (input) => {
          const parsed = parseToolInput(input, ['commentId']);
          if (!parsed.ok) {
            return invalidInput(parsed.detail);
          }
          const commentId = parseToolString(parsed.value, 'commentId');
          if (!commentId.ok) {
            return invalidInput(commentId.detail);
          }
          const result = await store.dispatch({
            actorKind: 'agent',
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
        annotations: { readOnlyHint: true },
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
      {
        name: 'control_presentation',
        description:
          'Control the live slideshow: start, next, previous, go_to_slide, or exit. This changes only the client session — it does not create a ChangeSet and does not require baseRevision. next/previous do not wrap; at the first or last slide they return AT_BOUNDARY. next/previous/go_to_slide require an active slideshow (start first); otherwise they return NOT_PRESENTING and do not move editor focus. Voice agents should call this instead of screenshotting.',
        inputSchema: controlPresentationInputSchema,
        execute: (input) => {
          const parsed = parseControlPresentationInput(input);
          if (!parsed.ok) {
            const action =
              isRecord(input) && typeof input.action === 'string' ? input.action : undefined;
            return controlPresentationToolResult({
              ok: false,
              action,
              code: 'INVALID_INPUT',
              detail: parsed.detail,
              view: presentViewFrom(store.getSnapshot()),
            });
          }
          return controlPresentationToolResult(store.controlPresentation(parsed.value));
        },
      },
    ];
}

export function useWebMcp(store: PresentationStore): boolean {
  const [isAvailable, setIsAvailable] = useState(false);

  useEffect(() => {
    const modelContext = document.modelContext;
    if (!modelContext) {
      setIsAvailable(false);
      return undefined;
    }

    return startWebMcpRegistration(modelContext, presentationWebMcpTools(store), {
      onReady: () => setIsAvailable(true),
      onFailed: (error) => {
        console.error('[webmcp] tool registration failed:', error);
        setIsAvailable(false);
      },
    });
  }, [store]);

  return isAvailable;
}
