import { actorMatches, agentActor, knownActors } from './actors';
import type {
  Actor,
  Comment,
  Frame,
  PresentationOperation,
  ShapeElement,
  TextElement,
  TextStyle,
} from '../../types/presentation';

/**
 * WebMCP command surface: strict parsers for every operation variant plus the
 * JSON Schema that describes the write envelope to zero-context agents. The
 * parsers and the schema are kept in lockstep in this single module.
 *
 * Validation never drops data: recognized properties are preserved (including
 * optimistic `expected*` guards) and unknown or malformed properties are
 * rejected loudly with a repair-safe detail.
 */

export type ParseResult<T> = { ok: true; value: T } | { ok: false; detail: string };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseFailure<T = never>(detail: string): ParseResult<T> {
  return { ok: false, detail };
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  subject: string,
): string | undefined {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      return `${subject} has unknown property "${key}".`;
    }
  }
  return undefined;
}

function parseFiniteNumber(value: unknown, subject: string): ParseResult<number> {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return parseFailure(`${subject} must be a finite number.`);
  }
  return { ok: true, value };
}

function parsePositiveNumber(value: unknown, subject: string): ParseResult<number> {
  const number = parseFiniteNumber(value, subject);
  if (!number.ok) return number;
  if (number.value <= 0) {
    return parseFailure(`${subject} must be a positive finite number.`);
  }
  return number;
}

function parseString(value: unknown, subject: string): ParseResult<string> {
  if (typeof value !== 'string') {
    return parseFailure(`${subject} must be a string.`);
  }
  return { ok: true, value };
}

function parseNonEmptyString(value: unknown, subject: string): ParseResult<string> {
  const string = parseString(value, subject);
  if (!string.ok) return string;
  if (string.value.length === 0) {
    return parseFailure(`${subject} must be a non-empty string.`);
  }
  return string;
}

function parseBoolean(value: unknown, subject: string): ParseResult<boolean> {
  if (typeof value !== 'boolean') {
    return parseFailure(`${subject} must be a boolean.`);
  }
  return { ok: true, value };
}

function parseEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  subject: string,
): ParseResult<T> {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    return parseFailure(`${subject} must be one of ${allowed.map((entry) => `"${entry}"`).join(', ')}.`);
  }
  return { ok: true, value: value as T };
}

function parseOptional<T>(
  value: unknown,
  parse: (value: unknown, subject: string) => ParseResult<T>,
  subject: string,
): ParseResult<T | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  return parse(value, subject);
}

// --- Element and comment parsers ---------------------------------------------

const textAlignments = ['left', 'center', 'right'] as const;
const fontWeights = [400, 500, 600, 700, 800] as const;
const textTransforms = ['none', 'uppercase'] as const;

function parseFontWeight(value: unknown, subject: string): ParseResult<TextStyle['fontWeight']> {
  if (typeof value !== 'number' || !(fontWeights as readonly number[]).includes(value)) {
    return parseFailure(`${subject} must be one of ${fontWeights.join(', ')}.`);
  }
  return { ok: true, value: value as (typeof fontWeights)[number] };
}

function parseFrame(value: unknown, subject: string): ParseResult<Frame> {
  if (!isRecord(value)) {
    return parseFailure(`${subject} must be an object.`);
  }
  const unknownKey = rejectUnknownKeys(value, ['height', 'width', 'x', 'y'], subject);
  if (unknownKey) return parseFailure(unknownKey);

  const x = parseFiniteNumber(value.x, `${subject}.x`);
  if (!x.ok) return x;
  const y = parseFiniteNumber(value.y, `${subject}.y`);
  if (!y.ok) return y;
  const width = parsePositiveNumber(value.width, `${subject}.width`);
  if (!width.ok) return width;
  const height = parsePositiveNumber(value.height, `${subject}.height`);
  if (!height.ok) return height;

  return { ok: true, value: { x: x.value, y: y.value, width: width.value, height: height.value } };
}

function parseTextStyle(value: unknown, subject: string): ParseResult<TextStyle> {
  if (!isRecord(value)) {
    return parseFailure(`${subject} must be an object.`);
  }
  const unknownKey = rejectUnknownKeys(
    value,
    ['align', 'color', 'fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight', 'textTransform'],
    subject,
  );
  if (unknownKey) return parseFailure(unknownKey);

  const color = parseNonEmptyString(value.color, `${subject}.color`);
  if (!color.ok) return color;
  const fontFamily = parseNonEmptyString(value.fontFamily, `${subject}.fontFamily`);
  if (!fontFamily.ok) return fontFamily;
  const fontSize = parsePositiveNumber(value.fontSize, `${subject}.fontSize`);
  if (!fontSize.ok) return fontSize;

  const style: TextStyle = { color: color.value, fontFamily: fontFamily.value, fontSize: fontSize.value };

  const align = parseOptional(value.align, (entry, entrySubject) => parseEnum(entry, textAlignments, entrySubject), `${subject}.align`);
  if (!align.ok) return align;
  if (align.value !== undefined) style.align = align.value;

  const fontWeight = parseOptional(value.fontWeight, parseFontWeight, `${subject}.fontWeight`);
  if (!fontWeight.ok) return fontWeight;
  if (fontWeight.value !== undefined) style.fontWeight = fontWeight.value;

  const letterSpacing = parseOptional(value.letterSpacing, parseFiniteNumber, `${subject}.letterSpacing`);
  if (!letterSpacing.ok) return letterSpacing;
  if (letterSpacing.value !== undefined) style.letterSpacing = letterSpacing.value;

  const lineHeight = parseOptional(value.lineHeight, parsePositiveNumber, `${subject}.lineHeight`);
  if (!lineHeight.ok) return lineHeight;
  if (lineHeight.value !== undefined) style.lineHeight = lineHeight.value;

  const textTransform = parseOptional(value.textTransform, (entry, entrySubject) => parseEnum(entry, textTransforms, entrySubject), `${subject}.textTransform`);
  if (!textTransform.ok) return textTransform;
  if (textTransform.value !== undefined) style.textTransform = textTransform.value;

  return { ok: true, value: style };
}

interface ElementBaseFields {
  id: string;
  frame: Frame;
  locked?: boolean;
  name: string;
  rotation?: number;
}

function parseElementBase(value: Record<string, unknown>, subject: string): ParseResult<ElementBaseFields> {
  const id = parseNonEmptyString(value.id, `${subject}.id`);
  if (!id.ok) return id;
  const name = parseNonEmptyString(value.name, `${subject}.name`);
  if (!name.ok) return name;
  const frame = parseFrame(value.frame, `${subject}.frame`);
  if (!frame.ok) return frame;

  const base: ElementBaseFields = { id: id.value, frame: frame.value, name: name.value };

  const locked = parseOptional(value.locked, parseBoolean, `${subject}.locked`);
  if (!locked.ok) return locked;
  if (locked.value !== undefined) base.locked = locked.value;

  const rotation = parseOptional(value.rotation, parseFiniteNumber, `${subject}.rotation`);
  if (!rotation.ok) return rotation;
  if (rotation.value !== undefined) base.rotation = rotation.value;

  return { ok: true, value: base };
}

function parseTextElement(value: unknown, subject: string): ParseResult<TextElement> {
  if (!isRecord(value)) {
    return parseFailure(`${subject} must be an object.`);
  }
  const unknownKey = rejectUnknownKeys(value, ['frame', 'id', 'kind', 'locked', 'name', 'rotation', 'style', 'text'], subject);
  if (unknownKey) return parseFailure(unknownKey);
  if (value.kind !== 'text') {
    return parseFailure(`${subject}.kind must be "text".`);
  }

  const base = parseElementBase(value, subject);
  if (!base.ok) return base;
  const text = parseString(value.text, `${subject}.text`);
  if (!text.ok) return text;
  const style = parseTextStyle(value.style, `${subject}.style`);
  if (!style.ok) return style;

  return { ok: true, value: { ...base.value, kind: 'text', style: style.value, text: text.value } };
}

function parseShapeElement(value: unknown, subject: string): ParseResult<ShapeElement> {
  if (!isRecord(value)) {
    return parseFailure(`${subject} must be an object.`);
  }
  const unknownKey = rejectUnknownKeys(value, ['fill', 'frame', 'id', 'kind', 'locked', 'name', 'radius', 'rotation'], subject);
  if (unknownKey) return parseFailure(unknownKey);
  if (value.kind !== 'shape') {
    return parseFailure(`${subject}.kind must be "shape".`);
  }

  const base = parseElementBase(value, subject);
  if (!base.ok) return base;
  const fill = parseNonEmptyString(value.fill, `${subject}.fill`);
  if (!fill.ok) return fill;

  const element: ShapeElement = { ...base.value, fill: fill.value, kind: 'shape' };

  if (value.radius !== undefined) {
    const radius = parseFiniteNumber(value.radius, `${subject}.radius`);
    if (!radius.ok) return radius;
    if (radius.value < 0) {
      return parseFailure(`${subject}.radius must be a non-negative finite number.`);
    }
    element.radius = radius.value;
  }

  return { ok: true, value: element };
}

function parseElement(value: unknown, subject: string): ParseResult<TextElement | ShapeElement> {
  if (!isRecord(value)) {
    return parseFailure(`${subject} must be an object.`);
  }
  if (value.kind === 'text') {
    return parseTextElement(value, subject);
  }
  if (value.kind === 'shape') {
    return parseShapeElement(value, subject);
  }
  return parseFailure(`${subject}.kind must be "text" or "shape".`);
}

function parseKnownActor(value: unknown, subject: string): ParseResult<Actor> {
  if (!isRecord(value)) {
    return parseFailure(`${subject} must be an object.`);
  }
  const unknownKey = rejectUnknownKeys(value, ['id', 'kind', 'name'], subject);
  if (unknownKey) return parseFailure(unknownKey);

  const known = knownActors.find(
    (actor) => actor.id === value.id && actor.kind === value.kind && actor.name === value.name,
  );
  if (!known) {
    return parseFailure(`${subject} must be one of the known Comake actors.`);
  }
  return { ok: true, value: known };
}

function parseTimestamp(value: unknown, subject: string): ParseResult<string> {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    return parseFailure(`${subject} must be an ISO timestamp string.`);
  }
  return { ok: true, value };
}

function parseComment(value: unknown, subject: string): ParseResult<Comment> {
  if (!isRecord(value)) {
    return parseFailure(`${subject} must be an object.`);
  }
  const unknownKey = rejectUnknownKeys(value, ['actor', 'body', 'createdAt', 'elementId', 'id', 'resolved', 'slideId'], subject);
  if (unknownKey) return parseFailure(unknownKey);

  const id = parseNonEmptyString(value.id, `${subject}.id`);
  if (!id.ok) return id;
  const actor = parseKnownActor(value.actor, `${subject}.actor`);
  if (!actor.ok) return actor;
  const body = parseNonEmptyString(value.body, `${subject}.body`);
  if (!body.ok) return body;
  const createdAt = parseTimestamp(value.createdAt, `${subject}.createdAt`);
  if (!createdAt.ok) return createdAt;
  const resolved = parseBoolean(value.resolved, `${subject}.resolved`);
  if (!resolved.ok) return resolved;
  const slideId = parseNonEmptyString(value.slideId, `${subject}.slideId`);
  if (!slideId.ok) return slideId;

  const comment: Comment = {
    id: id.value,
    actor: actor.value,
    body: body.value,
    createdAt: createdAt.value,
    resolved: resolved.value,
    slideId: slideId.value,
  };

  const elementId = parseOptional(value.elementId, parseNonEmptyString, `${subject}.elementId`);
  if (!elementId.ok) return elementId;
  if (elementId.value !== undefined) comment.elementId = elementId.value;

  return { ok: true, value: comment };
}

/** Comments written through the WebMCP contract are always agent-attributed. */
function parseAgentComment(value: unknown, subject: string): ParseResult<Comment> {
  const comment = parseComment(value, subject);
  if (!comment.ok) return comment;
  if (!actorMatches(comment.value.actor, agentActor)) {
    return parseFailure(`${subject}.actor must be the Comake agent identity.`);
  }
  return comment;
}

// --- Operation parser ----------------------------------------------------------

export function parseOperation(value: unknown): ParseResult<PresentationOperation> {
  if (!isRecord(value)) {
    return parseFailure('Operation must be an object.');
  }
  const type = value.type;
  if (typeof type !== 'string') {
    return parseFailure('Operation.type must be a string.');
  }

  switch (type) {
    case 'update_text': {
      const unknownKey = rejectUnknownKeys(value, ['elementId', 'expectedText', 'slideId', 'text', 'type'], 'update_text operation');
      if (unknownKey) return parseFailure(unknownKey);
      const slideId = parseNonEmptyString(value.slideId, 'update_text operation.slideId');
      if (!slideId.ok) return slideId;
      const elementId = parseNonEmptyString(value.elementId, 'update_text operation.elementId');
      if (!elementId.ok) return elementId;
      const text = parseString(value.text, 'update_text operation.text');
      if (!text.ok) return text;
      const expectedText = parseOptional(value.expectedText, parseString, 'update_text operation.expectedText');
      if (!expectedText.ok) return expectedText;

      return {
        ok: true,
        value: {
          type,
          slideId: slideId.value,
          elementId: elementId.value,
          text: text.value,
          expectedText: expectedText.value,
        },
      };
    }

    case 'update_frame': {
      const unknownKey = rejectUnknownKeys(value, ['elementId', 'expectedFrame', 'frame', 'slideId', 'type'], 'update_frame operation');
      if (unknownKey) return parseFailure(unknownKey);
      const slideId = parseNonEmptyString(value.slideId, 'update_frame operation.slideId');
      if (!slideId.ok) return slideId;
      const elementId = parseNonEmptyString(value.elementId, 'update_frame operation.elementId');
      if (!elementId.ok) return elementId;
      const frame = parseFrame(value.frame, 'update_frame operation.frame');
      if (!frame.ok) return frame;
      const expectedFrame = parseOptional(value.expectedFrame, parseFrame, 'update_frame operation.expectedFrame');
      if (!expectedFrame.ok) return expectedFrame;

      return {
        ok: true,
        value: {
          type,
          slideId: slideId.value,
          elementId: elementId.value,
          frame: frame.value,
          expectedFrame: expectedFrame.value,
        },
      };
    }

    case 'create_element': {
      const unknownKey = rejectUnknownKeys(value, ['element', 'slideId', 'type'], 'create_element operation');
      if (unknownKey) return parseFailure(unknownKey);
      const slideId = parseNonEmptyString(value.slideId, 'create_element operation.slideId');
      if (!slideId.ok) return slideId;
      const element = parseElement(value.element, 'create_element operation.element');
      if (!element.ok) return element;

      return {
        ok: true,
        value: {
          type,
          slideId: slideId.value,
          element: element.value,
        },
      };
    }

    case 'delete_element': {
      const unknownKey = rejectUnknownKeys(value, ['elementId', 'expectedElement', 'slideId', 'type'], 'delete_element operation');
      if (unknownKey) return parseFailure(unknownKey);
      const slideId = parseNonEmptyString(value.slideId, 'delete_element operation.slideId');
      if (!slideId.ok) return slideId;
      const elementId = parseNonEmptyString(value.elementId, 'delete_element operation.elementId');
      if (!elementId.ok) return elementId;
      const expectedElement = parseOptional(value.expectedElement, parseElement, 'delete_element operation.expectedElement');
      if (!expectedElement.ok) return expectedElement;

      return {
        ok: true,
        value: {
          type,
          slideId: slideId.value,
          elementId: elementId.value,
          expectedElement: expectedElement.value,
        },
      };
    }

    case 'add_comment': {
      const unknownKey = rejectUnknownKeys(value, ['comment', 'type'], 'add_comment operation');
      if (unknownKey) return parseFailure(unknownKey);
      const comment = parseAgentComment(value.comment, 'add_comment operation.comment');
      if (!comment.ok) return comment;

      return { ok: true, value: { type, comment: comment.value } };
    }

    case 'remove_comment': {
      const unknownKey = rejectUnknownKeys(value, ['commentId', 'expectedComment', 'type'], 'remove_comment operation');
      if (unknownKey) return parseFailure(unknownKey);
      const commentId = parseNonEmptyString(value.commentId, 'remove_comment operation.commentId');
      if (!commentId.ok) return commentId;
      const expectedComment = parseOptional(value.expectedComment, parseComment, 'remove_comment operation.expectedComment');
      if (!expectedComment.ok) return expectedComment;

      return {
        ok: true,
        value: {
          type,
          commentId: commentId.value,
          expectedComment: expectedComment.value,
        },
      };
    }

    case 'resolve_comment': {
      const unknownKey = rejectUnknownKeys(value, ['commentId', 'expectedResolved', 'resolved', 'type'], 'resolve_comment operation');
      if (unknownKey) return parseFailure(unknownKey);
      const commentId = parseNonEmptyString(value.commentId, 'resolve_comment operation.commentId');
      if (!commentId.ok) return commentId;
      const resolved = parseBoolean(value.resolved, 'resolve_comment operation.resolved');
      if (!resolved.ok) return resolved;
      const expectedResolved = parseOptional(value.expectedResolved, parseBoolean, 'resolve_comment operation.expectedResolved');
      if (!expectedResolved.ok) return expectedResolved;

      return {
        ok: true,
        value: {
          type,
          commentId: commentId.value,
          resolved: resolved.value,
          expectedResolved: expectedResolved.value,
        },
      };
    }

    default:
      return parseFailure(`Unknown operation type "${type}".`);
  }
}

// --- Write envelope -------------------------------------------------------------

export interface WriteInput {
  baseRevision: number;
  label: string;
  operations: PresentationOperation[];
}

export function parseWriteInput(input: unknown): ParseResult<WriteInput> {
  if (!isRecord(input)) {
    return parseFailure('Input must be an object.');
  }
  const unknownKey = rejectUnknownKeys(input, ['baseRevision', 'label', 'operations'], 'Input');
  if (unknownKey) return parseFailure(unknownKey);

  const baseRevision = input.baseRevision;
  if (typeof baseRevision !== 'number' || !Number.isInteger(baseRevision) || baseRevision < 0) {
    return parseFailure('baseRevision must be a non-negative integer.');
  }
  const label = parseNonEmptyString(input.label, 'label');
  if (!label.ok) return label;
  if (!Array.isArray(input.operations) || input.operations.length === 0) {
    return parseFailure('operations must be a non-empty array.');
  }

  const operations: PresentationOperation[] = [];
  for (const [index, value] of input.operations.entries()) {
    const operation = parseOperation(value);
    if (!operation.ok) {
      return parseFailure(`operations[${index}]: ${operation.detail}`);
    }
    operations.push(operation.value);
  }

  return { ok: true, value: { baseRevision, label: label.value, operations } };
}

/** Uniform strict input validation for every registered tool. */
export function parseToolInput(
  input: unknown,
  allowedKeys: readonly string[],
): ParseResult<Record<string, unknown>> {
  if (!isRecord(input)) {
    return parseFailure('Input must be an object.');
  }
  const unknownKey = rejectUnknownKeys(input, allowedKeys, 'Input');
  if (unknownKey) return parseFailure(unknownKey);
  return { ok: true, value: input };
}

// --- JSON Schema (kept in lockstep with the parsers above) -----------------------

const frameSchema = {
  type: 'object',
  properties: {
    x: { type: 'number', description: 'Left edge in slide coordinates (0-960).' },
    y: { type: 'number', description: 'Top edge in slide coordinates (0-540).' },
    width: { type: 'number', exclusiveMinimum: 0 },
    height: { type: 'number', exclusiveMinimum: 0 },
  },
  required: ['x', 'y', 'width', 'height'],
  additionalProperties: false,
};

const textStyleSchema = {
  type: 'object',
  properties: {
    align: { enum: ['left', 'center', 'right'] },
    color: { type: 'string', minLength: 1 },
    fontFamily: { type: 'string', minLength: 1 },
    fontSize: { type: 'number', exclusiveMinimum: 0 },
    fontWeight: { enum: [400, 500, 600, 700, 800] },
    letterSpacing: { type: 'number' },
    lineHeight: { type: 'number', exclusiveMinimum: 0 },
    textTransform: { enum: ['none', 'uppercase'] },
  },
  required: ['color', 'fontFamily', 'fontSize'],
  additionalProperties: false,
};

const textElementSchema = {
  type: 'object',
  properties: {
    kind: { const: 'text' },
    id: { type: 'string', minLength: 1, description: 'Fresh stable element id, unique within the slide.' },
    name: { type: 'string', minLength: 1 },
    frame: frameSchema,
    text: { type: 'string', description: 'Full text content; use \n for line breaks.' },
    style: textStyleSchema,
    locked: { type: 'boolean', description: 'Locked elements can never be edited, moved, or deleted afterwards.' },
    rotation: { type: 'number' },
  },
  required: ['kind', 'id', 'name', 'frame', 'text', 'style'],
  additionalProperties: false,
};

const shapeElementSchema = {
  type: 'object',
  properties: {
    kind: { const: 'shape' },
    id: { type: 'string', minLength: 1, description: 'Fresh stable element id, unique within the slide.' },
    name: { type: 'string', minLength: 1 },
    frame: frameSchema,
    fill: { type: 'string', minLength: 1, description: 'Fill color as a hex string like "#ec6f42".' },
    radius: { type: 'number', minimum: 0 },
    locked: { type: 'boolean', description: 'Locked elements can never be edited, moved, or deleted afterwards.' },
    rotation: { type: 'number' },
  },
  required: ['kind', 'id', 'name', 'frame', 'fill'],
  additionalProperties: false,
};

const elementSchema = {
  oneOf: [textElementSchema, shapeElementSchema],
  description: 'A complete text or shape element; echo the exact field names used by read_presentation_slide.',
};

const knownActorSchema = {
  oneOf: knownActors.map((actor) => ({ const: actor })),
};

const commentSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1 },
    actor: knownActorSchema,
    body: { type: 'string', minLength: 1 },
    createdAt: { type: 'string', format: 'date-time' },
    elementId: { type: 'string', minLength: 1 },
    resolved: { type: 'boolean' },
    slideId: { type: 'string', minLength: 1 },
  },
  required: ['id', 'actor', 'body', 'createdAt', 'resolved', 'slideId'],
  additionalProperties: false,
};

const agentCommentSchema = {
  ...commentSchema,
  properties: {
    ...commentSchema.properties,
    actor: {
      const: agentActor,
      description: 'Must be exactly the Comake agent identity; comments written through this tool are always agent-attributed.',
    },
  },
};

const updateTextOperationSchema = {
  type: 'object',
  properties: {
    type: { const: 'update_text' },
    slideId: { type: 'string', minLength: 1 },
    elementId: { type: 'string', minLength: 1 },
    text: { type: 'string', description: 'The full replacement text; use \n for line breaks.' },
    expectedText: { type: 'string', description: 'Optional optimistic guard: the text you read before editing.' },
  },
  required: ['type', 'slideId', 'elementId', 'text'],
  additionalProperties: false,
};

const updateFrameOperationSchema = {
  type: 'object',
  properties: {
    type: { const: 'update_frame' },
    slideId: { type: 'string', minLength: 1 },
    elementId: { type: 'string', minLength: 1 },
    frame: frameSchema,
    expectedFrame: { ...frameSchema, description: 'Optional optimistic guard: the frame you read before editing.' },
  },
  required: ['type', 'slideId', 'elementId', 'frame'],
  additionalProperties: false,
};

const createElementOperationSchema = {
  type: 'object',
  properties: {
    type: { const: 'create_element' },
    slideId: { type: 'string', minLength: 1 },
    element: elementSchema,
  },
  required: ['type', 'slideId', 'element'],
  additionalProperties: false,
};

const deleteElementOperationSchema = {
  type: 'object',
  properties: {
    type: { const: 'delete_element' },
    slideId: { type: 'string', minLength: 1 },
    elementId: { type: 'string', minLength: 1 },
    expectedElement: {
      ...elementSchema,
      description: 'Optional optimistic guard: the element exactly as read_presentation_slide returned it.',
    },
  },
  required: ['type', 'slideId', 'elementId'],
  additionalProperties: false,
};

const addCommentOperationSchema = {
  type: 'object',
  properties: {
    type: { const: 'add_comment' },
    comment: agentCommentSchema,
  },
  required: ['type', 'comment'],
  additionalProperties: false,
};

const removeCommentOperationSchema = {
  type: 'object',
  properties: {
    type: { const: 'remove_comment' },
    commentId: { type: 'string', minLength: 1 },
    expectedComment: {
      ...commentSchema,
      description: 'Optional optimistic guard: the comment exactly as it was read.',
    },
  },
  required: ['type', 'commentId'],
  additionalProperties: false,
};

const resolveCommentOperationSchema = {
  type: 'object',
  properties: {
    type: { const: 'resolve_comment' },
    commentId: { type: 'string', minLength: 1 },
    resolved: { type: 'boolean', description: 'True resolves the comment, false reopens it.' },
    expectedResolved: { type: 'boolean', description: 'Optional optimistic guard: the resolved state you read.' },
  },
  required: ['type', 'commentId', 'resolved'],
  additionalProperties: false,
};

export const presentationWriteInputSchema = {
  type: 'object',
  properties: {
    baseRevision: {
      type: 'integer',
      minimum: 0,
      description:
        'The presentation revision you last read (from get_presentation_outline or read_presentation_slide). The whole write is rejected atomically when the presentation has advanced past it.',
    },
    label: {
      type: 'string',
      minLength: 1,
      description: 'Short human-readable description of this change, shown in the changeset history.',
    },
    operations: {
      type: 'array',
      minItems: 1,
      description:
        'Operations applied in order as one atomic changeset; if any operation fails, nothing is applied.',
      items: {
        oneOf: [
          updateTextOperationSchema,
          updateFrameOperationSchema,
          createElementOperationSchema,
          deleteElementOperationSchema,
          addCommentOperationSchema,
          removeCommentOperationSchema,
          resolveCommentOperationSchema,
        ],
      },
    },
  },
  required: ['baseRevision', 'label', 'operations'],
  additionalProperties: false,
};
