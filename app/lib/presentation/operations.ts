import { DEMO_DISPLAY_NAME, isActorKind } from './actors';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from './canvas';
import { frameFitsPresentation, isCanonicalColor, strokeDashes } from './document';
import type {
  Actor,
  Comment,
  Frame,
  PresentationElement,
  PresentationOperation,
  ShapeElement,
  ShapeFill,
  ShapeGeometry,
  ShapeStroke,
  ShapeStyle,
  Slide,
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

function parseNonNegativeNumber(value: unknown, subject: string): ParseResult<number> {
  const number = parseFiniteNumber(value, subject);
  if (!number.ok) return number;
  if (number.value < 0) {
    return parseFailure(`${subject} must be a non-negative finite number.`);
  }
  return number;
}

function parseNonNegativeSafeInteger(value: unknown, subject: string): ParseResult<number> {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return parseFailure(`${subject} must be a non-negative safe integer.`);
  }
  return { ok: true, value };
}

/** The canonical color grammar: strict `#RRGGBB` hex, nothing else. */
function parseCanonicalColor(value: unknown, subject: string): ParseResult<string> {
  const string = parseString(value, subject);
  if (!string.ok) return string;
  if (!isCanonicalColor(string.value)) {
    return parseFailure(`${subject} must be a strict #RRGGBB hex color like "#ec6f42".`);
  }
  return string;
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

function parseStringArray(value: unknown, subject: string): ParseResult<string[]> {
  if (!Array.isArray(value)) {
    return parseFailure(`${subject} must be an array of strings.`);
  }
  const entries: string[] = [];
  for (const [index, entry] of value.entries()) {
    const parsed = parseString(entry, `${subject}[${index}]`);
    if (!parsed.ok) return parsed;
    entries.push(parsed.value);
  }
  return { ok: true, value: entries };
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

export function parseFrame(value: unknown, subject: string): ParseResult<Frame> {
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

  const frame: Frame = { x: x.value, y: y.value, width: width.value, height: height.value };
  if (!frameFitsPresentation(frame, { width: SLIDE_WIDTH, height: SLIDE_HEIGHT })) {
    return parseFailure(
      `${subject} must have positive width and height and fit inside the ${SLIDE_WIDTH}x${SLIDE_HEIGHT} presentation.`,
    );
  }
  return { ok: true, value: frame };
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

  const color = parseCanonicalColor(value.color, `${subject}.color`);
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

/** Fractional opacity: finite, > 0, ≤ 1 (mirrors kernel `isCanonicalOpacity`). */
function parseOpacity(value: unknown, subject: string): ParseResult<number> {
  const number = parseFiniteNumber(value, subject);
  if (!number.ok) return number;
  if (number.value <= 0 || number.value > 1) {
    return parseFailure(`${subject} must be a fraction greater than 0 and at most 1.`);
  }
  return number;
}

function parseShapeGeometry(value: unknown, subject: string): ParseResult<ShapeGeometry> {
  if (!isRecord(value)) return parseFailure(`${subject} must be an object.`);
  const kind = value.kind;
  if (kind === 'rectangle') {
    const unknownKey = rejectUnknownKeys(value, ['cornerRadius', 'kind'], subject);
    if (unknownKey) return parseFailure(unknownKey);
    const cornerRadius = parseNonNegativeNumber(value.cornerRadius, `${subject}.cornerRadius`);
    if (!cornerRadius.ok) return cornerRadius;
    return { ok: true, value: { kind: 'rectangle', cornerRadius: cornerRadius.value } };
  }
  if (kind === 'diamond' || kind === 'ellipse' || kind === 'triangle') {
    const unknownKey = rejectUnknownKeys(value, ['kind'], subject);
    if (unknownKey) return parseFailure(unknownKey);
    return { ok: true, value: { kind } };
  }
  return parseFailure(
    `${subject}.kind must be one of "rectangle", "ellipse", "triangle", "diamond".`,
  );
}

function parseShapeFill(value: unknown, subject: string): ParseResult<ShapeFill> {
  if (!isRecord(value)) return parseFailure(`${subject} must be an object.`);
  if (value.kind === 'none') {
    const unknownKey = rejectUnknownKeys(value, ['kind'], subject);
    if (unknownKey) return parseFailure(unknownKey);
    return { ok: true, value: { kind: 'none' } };
  }
  if (value.kind === 'solid') {
    const unknownKey = rejectUnknownKeys(value, ['color', 'kind', 'opacity'], subject);
    if (unknownKey) return parseFailure(unknownKey);
    const color = parseCanonicalColor(value.color, `${subject}.color`);
    if (!color.ok) return color;
    const opacity = parseOpacity(value.opacity, `${subject}.opacity`);
    if (!opacity.ok) return opacity;
    return { ok: true, value: { kind: 'solid', color: color.value, opacity: opacity.value } };
  }
  return parseFailure(`${subject}.kind must be "none" or "solid".`);
}

function parseShapeStroke(value: unknown, subject: string): ParseResult<ShapeStroke> {
  if (!isRecord(value)) return parseFailure(`${subject} must be an object.`);
  if (value.kind === 'none') {
    const unknownKey = rejectUnknownKeys(value, ['kind'], subject);
    if (unknownKey) return parseFailure(unknownKey);
    return { ok: true, value: { kind: 'none' } };
  }
  if (value.kind === 'solid') {
    const unknownKey = rejectUnknownKeys(value, ['color', 'dash', 'kind', 'opacity', 'width'], subject);
    if (unknownKey) return parseFailure(unknownKey);
    const color = parseCanonicalColor(value.color, `${subject}.color`);
    if (!color.ok) return color;
    const opacity = parseOpacity(value.opacity, `${subject}.opacity`);
    if (!opacity.ok) return opacity;
    const width = parsePositiveNumber(value.width, `${subject}.width`);
    if (!width.ok) return width;
    const dash = parseEnum(value.dash, strokeDashes, `${subject}.dash`);
    if (!dash.ok) return dash;
    return {
      ok: true,
      value: {
        kind: 'solid',
        color: color.value,
        dash: dash.value,
        opacity: opacity.value,
        width: width.value,
      },
    };
  }
  return parseFailure(`${subject}.kind must be "none" or "solid".`);
}

function parseShapeStyle(value: unknown, subject: string): ParseResult<ShapeStyle> {
  if (!isRecord(value)) return parseFailure(`${subject} must be an object.`);
  const unknownKey = rejectUnknownKeys(value, ['fill', 'geometry', 'stroke'], subject);
  if (unknownKey) return parseFailure(unknownKey);
  const geometry = parseShapeGeometry(value.geometry, `${subject}.geometry`);
  if (!geometry.ok) return geometry;
  const fill = parseShapeFill(value.fill, `${subject}.fill`);
  if (!fill.ok) return fill;
  const stroke = parseShapeStroke(value.stroke, `${subject}.stroke`);
  if (!stroke.ok) return stroke;
  return { ok: true, value: { fill: fill.value, geometry: geometry.value, stroke: stroke.value } };
}

function parseShapeElement(value: unknown, subject: string): ParseResult<ShapeElement> {
  if (!isRecord(value)) {
    return parseFailure(`${subject} must be an object.`);
  }
  const unknownKey = rejectUnknownKeys(value, ['frame', 'id', 'kind', 'locked', 'name', 'rotation', 'style'], subject);
  if (unknownKey) return parseFailure(unknownKey);
  if (value.kind !== 'shape') {
    return parseFailure(`${subject}.kind must be "shape".`);
  }

  const base = parseElementBase(value, subject);
  if (!base.ok) return base;
  const style = parseShapeStyle(value.style, `${subject}.style`);
  if (!style.ok) return style;

  const element: ShapeElement = { ...base.value, kind: 'shape', style: style.value };

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

function parseSlide(value: unknown, subject: string): ParseResult<Slide> {
  if (!isRecord(value)) {
    return parseFailure(`${subject} must be an object.`);
  }
  const unknownKey = rejectUnknownKeys(value, ['background', 'elementOrder', 'elements', 'id', 'name', 'notes'], subject);
  if (unknownKey) return parseFailure(unknownKey);

  const id = parseNonEmptyString(value.id, `${subject}.id`);
  if (!id.ok) return id;
  const name = parseNonEmptyString(value.name, `${subject}.name`);
  if (!name.ok) return name;
  const background = parseCanonicalColor(value.background, `${subject}.background`);
  if (!background.ok) return background;

  if (!Array.isArray(value.elementOrder)) {
    return parseFailure(`${subject}.elementOrder must be an array.`);
  }
  const elementOrder: string[] = [];
  const orderedIds = new Set<string>();
  for (const [index, entry] of value.elementOrder.entries()) {
    if (typeof entry !== 'string' || entry.length === 0) {
      return parseFailure(`${subject}.elementOrder[${index}] must be a non-empty string.`);
    }
    if (orderedIds.has(entry)) {
      return parseFailure(`${subject}.elementOrder contains duplicate id "${entry}".`);
    }
    orderedIds.add(entry);
    elementOrder.push(entry);
  }

  if (!isRecord(value.elements)) {
    return parseFailure(`${subject}.elements must be an object.`);
  }
  const elements: Record<string, PresentationElement> = {};
  for (const [key, rawElement] of Object.entries(value.elements)) {
    const element = parseElement(rawElement, `${subject}.elements.${key}`);
    if (!element.ok) return element;
    if (element.value.id !== key) {
      return parseFailure(`${subject}.elements.${key} has id "${element.value.id}" that does not match its key.`);
    }
    elements[key] = element.value;
  }

  for (const entry of elementOrder) {
    if (!(entry in elements)) {
      return parseFailure(`${subject}.elementOrder references "${entry}" which is not present in elements.`);
    }
  }
  for (const key of Object.keys(elements)) {
    if (!orderedIds.has(key)) {
      return parseFailure(`${subject}.elementOrder is missing element "${key}".`);
    }
  }

  const slide: Slide = {
    id: id.value,
    name: name.value,
    background: background.value,
    elementOrder,
    elements,
  };

  const notes = parseOptional(value.notes, parseString, `${subject}.notes`);
  if (!notes.ok) return notes;
  if (notes.value !== undefined) slide.notes = notes.value;

  return { ok: true, value: slide };
}

function parseActor(value: unknown, subject: string): ParseResult<Actor> {
  if (!isRecord(value)) {
    return parseFailure(`${subject} must be an object.`);
  }
  const unknownKey = rejectUnknownKeys(value, ['id', 'kind', 'name'], subject);
  if (unknownKey) return parseFailure(unknownKey);

  const id = parseNonEmptyString(value.id, `${subject}.id`);
  if (!id.ok) return id;
  if (!isActorKind(value.kind)) {
    return parseFailure(`${subject}.kind must be one of "human", "agent", "system".`);
  }
  const name = parseNonEmptyString(value.name, `${subject}.name`);
  if (!name.ok) return name;
  return { ok: true, value: { id: id.value, kind: value.kind, name: name.value } };
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
  let actor: Actor;
  if (value.actor === undefined) {
    actor = { id: 'client', kind: 'human', name: DEMO_DISPLAY_NAME };
  } else {
    const parsedActor = parseActor(value.actor, `${subject}.actor`);
    if (!parsedActor.ok) return parsedActor;
    actor = parsedActor.value;
  }
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
    actor,
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

    case 'update_shape_style': {
      const unknownKey = rejectUnknownKeys(
        value,
        ['elementId', 'expectedStyle', 'slideId', 'style', 'type'],
        'update_shape_style operation',
      );
      if (unknownKey) return parseFailure(unknownKey);
      const slideId = parseNonEmptyString(value.slideId, 'update_shape_style operation.slideId');
      if (!slideId.ok) return slideId;
      const elementId = parseNonEmptyString(value.elementId, 'update_shape_style operation.elementId');
      if (!elementId.ok) return elementId;
      const style = parseShapeStyle(value.style, 'update_shape_style operation.style');
      if (!style.ok) return style;
      const expectedStyle = parseOptional(value.expectedStyle, parseShapeStyle, 'update_shape_style operation.expectedStyle');
      if (!expectedStyle.ok) return expectedStyle;

      return {
        ok: true,
        value: {
          type,
          slideId: slideId.value,
          elementId: elementId.value,
          style: style.value,
          expectedStyle: expectedStyle.value,
        },
      };
    }

    case 'update_text_style': {
      const unknownKey = rejectUnknownKeys(
        value,
        ['elementId', 'expectedStyle', 'slideId', 'style', 'type'],
        'update_text_style operation',
      );
      if (unknownKey) return parseFailure(unknownKey);
      const slideId = parseNonEmptyString(value.slideId, 'update_text_style operation.slideId');
      if (!slideId.ok) return slideId;
      const elementId = parseNonEmptyString(value.elementId, 'update_text_style operation.elementId');
      if (!elementId.ok) return elementId;
      const style = parseTextStyle(value.style, 'update_text_style operation.style');
      if (!style.ok) return style;
      const expectedStyle = parseOptional(value.expectedStyle, parseTextStyle, 'update_text_style operation.expectedStyle');
      if (!expectedStyle.ok) return expectedStyle;

      return {
        ok: true,
        value: {
          type,
          slideId: slideId.value,
          elementId: elementId.value,
          style: style.value,
          expectedStyle: expectedStyle.value,
        },
      };
    }

    case 'update_element_order': {
      const unknownKey = rejectUnknownKeys(
        value,
        ['elementOrder', 'expectedElementOrder', 'slideId', 'type'],
        'update_element_order operation',
      );
      if (unknownKey) return parseFailure(unknownKey);
      const slideId = parseNonEmptyString(value.slideId, 'update_element_order operation.slideId');
      if (!slideId.ok) return slideId;
      if (!Array.isArray(value.elementOrder)) {
        return parseFailure('update_element_order operation.elementOrder must be an array.');
      }
      const elementOrder: string[] = [];
      const orderedIds = new Set<string>();
      for (const [index, entry] of value.elementOrder.entries()) {
        if (typeof entry !== 'string' || entry.length === 0) {
          return parseFailure(`update_element_order operation.elementOrder[${index}] must be a non-empty string.`);
        }
        if (orderedIds.has(entry)) {
          return parseFailure(`update_element_order operation.elementOrder contains duplicate id "${entry}".`);
        }
        orderedIds.add(entry);
        elementOrder.push(entry);
      }
      const expectedElementOrder = parseOptional(
        value.expectedElementOrder,
        parseStringArray,
        'update_element_order operation.expectedElementOrder',
      );
      if (!expectedElementOrder.ok) return expectedElementOrder;

      return {
        ok: true,
        value: {
          type,
          slideId: slideId.value,
          elementOrder,
          expectedElementOrder: expectedElementOrder.value,
        },
      };
    }

    case 'update_slide': {
      const unknownKey = rejectUnknownKeys(
        value,
        [
          'background',
          'expectedBackground',
          'expectedName',
          'expectedNotes',
          'name',
          'notes',
          'slideId',
          'type',
        ],
        'update_slide operation',
      );
      if (unknownKey) return parseFailure(unknownKey);
      const slideId = parseNonEmptyString(value.slideId, 'update_slide operation.slideId');
      if (!slideId.ok) return slideId;
      const name = parseNonEmptyString(value.name, 'update_slide operation.name');
      if (!name.ok) return name;
      const background = parseCanonicalColor(value.background, 'update_slide operation.background');
      if (!background.ok) return background;
      const notes = parseOptional(value.notes, parseString, 'update_slide operation.notes');
      if (!notes.ok) return notes;
      const expectedName = parseOptional(value.expectedName, parseNonEmptyString, 'update_slide operation.expectedName');
      if (!expectedName.ok) return expectedName;
      const expectedBackground = parseOptional(value.expectedBackground, parseCanonicalColor, 'update_slide operation.expectedBackground');
      if (!expectedBackground.ok) return expectedBackground;
      const expectedNotes = parseOptional(value.expectedNotes, parseString, 'update_slide operation.expectedNotes');
      if (!expectedNotes.ok) return expectedNotes;

      return {
        ok: true,
        value: {
          type,
          slideId: slideId.value,
          name: name.value,
          background: background.value,
          notes: notes.value,
          expectedName: expectedName.value,
          expectedBackground: expectedBackground.value,
          expectedNotes: expectedNotes.value,
        },
      };
    }

    case 'create_slide': {
      const unknownKey = rejectUnknownKeys(value, ['insertAt', 'slide', 'type'], 'create_slide operation');
      if (unknownKey) return parseFailure(unknownKey);
      const slide = parseSlide(value.slide, 'create_slide operation.slide');
      if (!slide.ok) return slide;
      const insertAt = parseOptional(value.insertAt, parseNonNegativeSafeInteger, 'create_slide operation.insertAt');
      if (!insertAt.ok) return insertAt;

      return {
        ok: true,
        value: {
          type,
          slide: slide.value,
          insertAt: insertAt.value,
        },
      };
    }

    case 'delete_slide': {
      const unknownKey = rejectUnknownKeys(value, ['expectedSlide', 'slideId', 'type'], 'delete_slide operation');
      if (unknownKey) return parseFailure(unknownKey);
      const slideId = parseNonEmptyString(value.slideId, 'delete_slide operation.slideId');
      if (!slideId.ok) return slideId;
      const expectedSlide = parseOptional(value.expectedSlide, parseSlide, 'delete_slide operation.expectedSlide');
      if (!expectedSlide.ok) return expectedSlide;

      return {
        ok: true,
        value: {
          type,
          slideId: slideId.value,
          expectedSlide: expectedSlide.value,
        },
      };
    }

    case 'create_element': {
      const unknownKey = rejectUnknownKeys(value, ['element', 'insertAt', 'slideId', 'type'], 'create_element operation');
      if (unknownKey) return parseFailure(unknownKey);
      const slideId = parseNonEmptyString(value.slideId, 'create_element operation.slideId');
      if (!slideId.ok) return slideId;
      const element = parseElement(value.element, 'create_element operation.element');
      if (!element.ok) return element;
      const insertAt = parseOptional(value.insertAt, parseNonNegativeSafeInteger, 'create_element operation.insertAt');
      if (!insertAt.ok) return insertAt;

      return {
        ok: true,
        value: {
          type,
          slideId: slideId.value,
          element: element.value,
          insertAt: insertAt.value,
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
      const comment = parseComment(value.comment, 'add_comment operation.comment');
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

const canonicalColorSchema = {
  type: 'string',
  pattern: '^#[0-9a-fA-F]{6}$',
  description: 'Strict #RRGGBB hex color like "#ec6f42".',
};

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
    color: canonicalColorSchema,
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

const shapeGeometrySchema = {
  oneOf: [
    {
      type: 'object',
      properties: {
        kind: { const: 'rectangle' },
        cornerRadius: {
          type: 'number',
          minimum: 0,
          description: 'Authored corner radius in slide points; rendered clamped to half the shorter side.',
        },
      },
      required: ['kind', 'cornerRadius'],
      additionalProperties: false,
    },
    { type: 'object', properties: { kind: { const: 'ellipse' } }, required: ['kind'], additionalProperties: false },
    { type: 'object', properties: { kind: { const: 'triangle' } }, required: ['kind'], additionalProperties: false },
    { type: 'object', properties: { kind: { const: 'diamond' } }, required: ['kind'], additionalProperties: false },
  ],
};

const shapeFillSchema = {
  oneOf: [
    { type: 'object', properties: { kind: { const: 'none' } }, required: ['kind'], additionalProperties: false },
    {
      type: 'object',
      properties: {
        kind: { const: 'solid' },
        color: canonicalColorSchema,
        opacity: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
      },
      required: ['kind', 'color', 'opacity'],
      additionalProperties: false,
    },
  ],
};

const shapeStrokeSchema = {
  oneOf: [
    { type: 'object', properties: { kind: { const: 'none' } }, required: ['kind'], additionalProperties: false },
    {
      type: 'object',
      properties: {
        kind: { const: 'solid' },
        color: canonicalColorSchema,
        opacity: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
        width: { type: 'number', exclusiveMinimum: 0, description: 'Stroke width in slide points.' },
        dash: { enum: ['solid', 'dash', 'dot'] },
      },
      required: ['kind', 'color', 'dash', 'opacity', 'width'],
      additionalProperties: false,
    },
  ],
};

const shapeStyleSchema = {
  type: 'object',
  properties: {
    geometry: shapeGeometrySchema,
    fill: shapeFillSchema,
    stroke: shapeStrokeSchema,
  },
  required: ['fill', 'geometry', 'stroke'],
  additionalProperties: false,
};

const shapeElementSchema = {
  type: 'object',
  properties: {
    kind: { const: 'shape' },
    id: { type: 'string', minLength: 1, description: 'Fresh stable element id, unique within the slide.' },
    name: { type: 'string', minLength: 1 },
    frame: frameSchema,
    style: shapeStyleSchema,
    locked: { type: 'boolean', description: 'Locked elements can never be edited, moved, or deleted afterwards.' },
    rotation: { type: 'number' },
  },
  required: ['kind', 'id', 'name', 'frame', 'style'],
  additionalProperties: false,
};

const elementSchema = {
  oneOf: [textElementSchema, shapeElementSchema],
  description: 'A complete text or shape element; echo the exact field names used by read_presentation_slide.',
};

const slideSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 },
    background: canonicalColorSchema,
    elementOrder: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      uniqueItems: true,
      description: 'Every element id appears exactly once, in back-to-front order.',
    },
    elements: {
      type: 'object',
      additionalProperties: elementSchema,
      description: 'Each key is the element id and must equal the element\'s "id" field.',
    },
    notes: { type: 'string' },
  },
  required: ['id', 'name', 'background', 'elementOrder', 'elements'],
  additionalProperties: false,
};

const actorSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1 },
    kind: { enum: ['human', 'agent', 'system'] },
    name: { type: 'string', minLength: 1 },
  },
  required: ['id', 'kind', 'name'],
  additionalProperties: false,
  description:
    'Attribution is assigned by the server from the verified session; client-supplied actor fields are ignored.',
};

const commentSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1 },
    actor: actorSchema,
    body: { type: 'string', minLength: 1 },
    createdAt: { type: 'string', format: 'date-time' },
    elementId: { type: 'string', minLength: 1 },
    resolved: { type: 'boolean' },
    slideId: { type: 'string', minLength: 1 },
  },
  required: ['id', 'body', 'createdAt', 'resolved', 'slideId'],
  additionalProperties: false,
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

const updateShapeStyleOperationSchema = {
  type: 'object',
  properties: {
    type: { const: 'update_shape_style' },
    slideId: { type: 'string', minLength: 1 },
    elementId: { type: 'string', minLength: 1 },
    style: {
      ...shapeStyleSchema,
      description: 'The complete replacement shape style; geometry, fill, and stroke are replaced atomically.',
    },
    expectedStyle: {
      ...shapeStyleSchema,
      description: 'Optional optimistic guard: the complete style you read before editing.',
    },
  },
  required: ['type', 'slideId', 'elementId', 'style'],
  additionalProperties: false,
};

const updateTextStyleOperationSchema = {
  type: 'object',
  properties: {
    type: { const: 'update_text_style' },
    slideId: { type: 'string', minLength: 1 },
    elementId: { type: 'string', minLength: 1 },
    style: {
      ...textStyleSchema,
      description: 'The complete replacement text style; every canonical style field is replaced atomically.',
    },
    expectedStyle: {
      ...textStyleSchema,
      description: 'Optional optimistic guard: the complete style you read before editing.',
    },
  },
  required: ['type', 'slideId', 'elementId', 'style'],
  additionalProperties: false,
};

const updateElementOrderOperationSchema = {
  type: 'object',
  properties: {
    type: { const: 'update_element_order' },
    slideId: { type: 'string', minLength: 1 },
    elementOrder: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      uniqueItems: true,
      description: "An exact permutation of the slide's existing element ids in the new back-to-front order; nothing added, dropped, or duplicated.",
    },
    expectedElementOrder: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      description: 'Optional optimistic guard: the element order you read before editing.',
    },
  },
  required: ['type', 'slideId', 'elementOrder'],
  additionalProperties: false,
};

const updateSlideOperationSchema = {
  type: 'object',
  properties: {
    type: { const: 'update_slide' },
    slideId: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1, description: 'The complete replacement slide name.' },
    background: canonicalColorSchema,
    notes: { type: 'string', description: 'Optional speaker notes; omitting them clears any existing notes.' },
    expectedName: { type: 'string', minLength: 1, description: 'Optional optimistic guard: the name you read before editing.' },
    expectedBackground: {
      ...canonicalColorSchema,
      description: 'Optional optimistic guard: the background you read before editing.',
    },
    expectedNotes: { type: 'string', description: 'Optional optimistic guard: the notes you read before editing.' },
  },
  required: ['type', 'slideId', 'name', 'background'],
  additionalProperties: false,
};

const createSlideOperationSchema = {
  type: 'object',
  properties: {
    type: { const: 'create_slide' },
    slide: { ...slideSchema, description: 'The complete slide to insert.' },
    insertAt: {
      type: 'integer',
      minimum: 0,
      description: 'Optional zero-based insertion position in the current slide order (0 inserts before the first slide); omit to append at the end.',
    },
  },
  required: ['type', 'slide'],
  additionalProperties: false,
};

const deleteSlideOperationSchema = {
  type: 'object',
  properties: {
    type: { const: 'delete_slide' },
    slideId: { type: 'string', minLength: 1 },
    expectedSlide: {
      ...slideSchema,
      description: 'Optional optimistic guard: the slide exactly as it was read.',
    },
  },
  required: ['type', 'slideId'],
  additionalProperties: false,
};

const createElementOperationSchema = {
  type: 'object',
  properties: {
    type: { const: 'create_element' },
    slideId: { type: 'string', minLength: 1 },
    element: elementSchema,
    insertAt: {
      type: 'integer',
      minimum: 0,
      description: "Optional zero-based z-position in the slide's element order (0 inserts behind everything); omission appends at the top.",
    },
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
    comment: commentSchema,
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
          updateTextStyleOperationSchema,
          updateFrameOperationSchema,
          updateShapeStyleOperationSchema,
          updateElementOrderOperationSchema,
          updateSlideOperationSchema,
          createSlideOperationSchema,
          deleteSlideOperationSchema,
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
