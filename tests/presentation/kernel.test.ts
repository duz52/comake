import assert from 'node:assert/strict';
import { test } from 'node:test';

import { demoActor } from '../../app/lib/presentation/actors';
import {
  dispatchPresentationDocument,
  effectiveCornerRadius,
  shapeStyleFailure,
  type PresentationDocument,
} from '../../app/lib/presentation/document';
import { parseOperation } from '../../app/lib/presentation/operations';
import { createPptxArchive } from '../../app/lib/presentation/pptx-exporter';
import type {
  Frame,
  Presentation,
  PresentationElement,
  ShapeStyle,
  Slide,
} from '../../app/types/presentation';

const humanActor = demoActor('human');
const agentActor = demoActor('agent');

const FRAME: Frame = { x: 10, y: 10, width: 100, height: 100 };

function rectStyle(cornerRadius: number): ShapeStyle {
  return {
    fill: { kind: 'solid', color: '#EC6F42', opacity: 1 },
    geometry: { kind: 'rectangle', cornerRadius },
    stroke: { kind: 'none' },
  };
}

const asStyle = (value: unknown): ShapeStyle => value as ShapeStyle;

function makeDocument(shapes: Array<{ frame: Frame; id: string; locked?: boolean; name: string; rotation?: number; style: ShapeStyle }>): PresentationDocument {
  const slide: Slide = {
    id: 'slide-test',
    name: 'Test',
    background: '#F8F2E8',
    elementOrder: shapes.map((shape) => shape.id),
    elements: Object.fromEntries(
      shapes.map((shape) => [
        shape.id,
        {
          ...shape,
          kind: 'shape' as const,
        },
      ]),
    ),
  };
  return {
    comments: {},
    changeSets: {},
    changeSetOrder: [],
    presentation: {
      id: 'deck-test',
      revision: 0,
      size: { width: 960, height: 540 },
      slideOrder: ['slide-test'],
      slides: { 'slide-test': slide },
      title: 'Test deck',
    },
  };
}

function testDocument(style: ShapeStyle): PresentationDocument {
  return makeDocument([{ id: 'shape-a', name: 'A', frame: FRAME, style }]);
}

function dispatchStyle(document: PresentationDocument, style: ShapeStyle, expectedStyle?: ShapeStyle) {
  return dispatchPresentationDocument(document, {
    actor: humanActor,
    label: 'Restyle shape',
    operations: [
      {
        type: 'update_shape_style',
        slideId: 'slide-test',
        elementId: 'shape-a',
        style,
        expectedStyle,
      },
    ],
  });
}

function shapeOf(document: PresentationDocument, elementId: string): PresentationElement {
  return document.presentation.slides['slide-test'].elements[elementId];
}

test('shapeStyleFailure accepts every canonical geometry, fill, and stroke combination', () => {
  const geometries: ShapeStyle['geometry'][] = [
    { kind: 'rectangle', cornerRadius: 0 },
    { kind: 'rectangle', cornerRadius: 16 },
    { kind: 'ellipse' },
    { kind: 'triangle' },
    { kind: 'diamond' },
  ];
  for (const geometry of geometries) {
    assert.equal(shapeStyleFailure({ fill: { kind: 'none' }, geometry, stroke: { kind: 'none' } }), undefined);
  }
  for (const dash of ['solid', 'dash', 'dot'] as const) {
    assert.equal(
      shapeStyleFailure({
        fill: { kind: 'solid', color: '#EC6F42', opacity: 0.5 },
        geometry: { kind: 'rectangle', cornerRadius: 4 },
        stroke: { kind: 'solid', color: '#1C1C18', dash, opacity: 1, width: 0.75 },
      }),
      undefined,
    );
  }
});

test('shapeStyleFailure rejects unknown discriminants, incomplete solids, and out-of-range values', () => {
  assert.ok(
    shapeStyleFailure(asStyle({ fill: { kind: 'none' }, geometry: { kind: 'hexagon' }, stroke: { kind: 'none' } })),
  );
  assert.ok(
    shapeStyleFailure(
      asStyle({ fill: { kind: 'gradient' }, geometry: { kind: 'rectangle', cornerRadius: 0 }, stroke: { kind: 'none' } }),
    ),
  );
  assert.ok(
    shapeStyleFailure(
      asStyle({
        fill: { kind: 'none' },
        geometry: { kind: 'rectangle', cornerRadius: 0 },
        stroke: { kind: 'solid', color: '#1C1C18', dash: 'dotted', opacity: 1, width: 2 },
      }),
    ),
  );
  assert.ok(
    shapeStyleFailure(
      asStyle({
        fill: { kind: 'solid', color: '#EC6F42' },
        geometry: { kind: 'rectangle', cornerRadius: 0 },
        stroke: { kind: 'none' },
      }),
    ),
  );
  assert.ok(shapeStyleFailure({ ...rectStyle(0), geometry: { kind: 'rectangle', cornerRadius: -1 } }));
  assert.ok(
    shapeStyleFailure({
      ...rectStyle(0),
      fill: { kind: 'solid', color: '#EC6F42', opacity: 0 },
    }),
  );
});

test('effectiveCornerRadius clamps to half the shorter side and is zero for non-rectangles', () => {
  const frame: Frame = { x: 0, y: 0, width: 100, height: 50 };
  assert.equal(effectiveCornerRadius(frame, { kind: 'rectangle', cornerRadius: 40 }), 25);
  assert.equal(effectiveCornerRadius(frame, { kind: 'rectangle', cornerRadius: 1e6 }), 25);
  assert.equal(effectiveCornerRadius(frame, { kind: 'rectangle', cornerRadius: 0 }), 0);
  assert.equal(effectiveCornerRadius(frame, { kind: 'ellipse' }), 0);
  assert.equal(effectiveCornerRadius(frame, { kind: 'triangle' }), 0);
  assert.equal(effectiveCornerRadius(frame, { kind: 'diamond' }), 0);
});

test('update_shape_style replaces the whole style, records a change set, and inverts cleanly', () => {
  const initial = rectStyle(8);
  const document = testDocument(initial);
  const target: ShapeStyle = {
    fill: { kind: 'none' },
    geometry: { kind: 'ellipse' },
    stroke: { kind: 'solid', color: '#1C1C18', dash: 'dash', opacity: 0.5, width: 2 },
  };

  const result = dispatchStyle(document, target, initial);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.document.presentation.revision, 1);
  assert.equal(result.changeSet.revision, 1);
  assert.deepEqual(shapeOf(result.document, 'shape-a').style, target);

  const undo = dispatchPresentationDocument(result.document, {
    actor: agentActor,
    label: 'Undo restyle',
    operations: result.changeSet.inverseOperations,
  });
  assert.equal(undo.ok, true);
  if (!undo.ok) return;
  assert.deepEqual(shapeOf(undo.document, 'shape-a'), shapeOf(document, 'shape-a'));
  assert.equal(undo.document.presentation.revision, 2);
});

test('update_shape_style rejects a stale expectedStyle without mutating the document', () => {
  const document = testDocument(rectStyle(8));
  const before = JSON.stringify(document);
  const stale = dispatchStyle(document, rectStyle(16), rectStyle(99));
  assert.equal(stale.ok, false);
  if (stale.ok) return;
  assert.equal(stale.failure.code, 'CONFLICT');
  assert.equal(JSON.stringify(document), before);
});

test('update_presentation replaces the title, bumps revision, and inverts to the previous title', () => {
  const document = testDocument(rectStyle(8));
  const result = dispatchPresentationDocument(document, {
    actor: humanActor,
    baseRevision: 0,
    label: 'Rename presentation',
    operations: [{ type: 'update_presentation', title: 'Quarter Plan', expectedTitle: 'Test deck' }],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.document.presentation.title, 'Quarter Plan');
  assert.equal(result.document.presentation.revision, 1);
  assert.equal(result.changeSet.operations[0].type, 'update_presentation');

  const undo = dispatchPresentationDocument(result.document, {
    actor: agentActor,
    label: 'Undo rename',
    operations: result.changeSet.inverseOperations,
  });
  assert.equal(undo.ok, true);
  if (!undo.ok) return;
  assert.equal(undo.document.presentation.title, 'Test deck');
  assert.equal(undo.document.presentation.revision, 2);
});

test('parseOperation accepts a canonical shape style and rejects malformed styles', () => {
  const validStyle = {
    fill: { kind: 'solid', color: '#EC6F42', opacity: 0.5 },
    geometry: { kind: 'rectangle', cornerRadius: 4 },
    stroke: { kind: 'solid', color: '#1C1C18', dash: 'dot', opacity: 0.25, width: 0.75 },
  };
  const parsed = parseOperation({
    type: 'update_shape_style',
    slideId: 'slide-test',
    elementId: 'shape-a',
    style: validStyle,
    expectedStyle: undefined,
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual((parsed.value as { style: ShapeStyle }).style, validStyle);

  const malformed = parseOperation({
    type: 'update_shape_style',
    slideId: 'slide-test',
    elementId: 'shape-a',
    style: { ...validStyle, fill: { kind: 'gradient' } },
  });
  assert.equal(malformed.ok, false);
});

function exporterPresentation(): Presentation {
  return makeDocument([
    {
      id: 'plain-rect',
      name: 'A&B <C> "Q" \'R\'',
      frame: { x: 10, y: 10, width: 100, height: 50 },
      style: {
        fill: { kind: 'solid', color: '#EC6F42', opacity: 1 },
        geometry: { kind: 'rectangle', cornerRadius: 0 },
        stroke: { kind: 'none' },
      },
    },
    {
      id: 'round-rect',
      name: 'Rounded',
      frame: { x: 10, y: 10, width: 136, height: 106 },
      style: {
        fill: { kind: 'solid', color: '#EC6F42', opacity: 1 },
        geometry: { kind: 'rectangle', cornerRadius: 14 },
        stroke: { kind: 'none' },
      },
    },
    {
      id: 'faded-ellipse',
      name: 'Faded',
      frame: { x: 10, y: 10, width: 132, height: 132 },
      rotation: 90,
      style: {
        fill: { kind: 'solid', color: '#FFD14E', opacity: 0.5 },
        geometry: { kind: 'ellipse' },
        stroke: { kind: 'none' },
      },
    },
    {
      id: 'triangle',
      name: 'Triangle',
      frame: { x: 10, y: 10, width: 100, height: 100 },
      style: {
        fill: { kind: 'none' },
        geometry: { kind: 'triangle' },
        stroke: { kind: 'solid', color: '#1C1C18', dash: 'dash', opacity: 0.25, width: 2 },
      },
    },
    {
      id: 'diamond',
      name: 'Diamond',
      frame: { x: 10, y: 10, width: 100, height: 50 },
      style: {
        fill: { kind: 'none' },
        geometry: { kind: 'diamond' },
        stroke: { kind: 'solid', color: '#1C1C18', dash: 'dot', opacity: 1, width: 1 },
      },
    },
  ]).presentation;
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] | (bytes[offset + 1] << 8)) >>> 0) & 0xffff;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0) %
    0x100000000
  );
}

function extractZipEntry(archive: Uint8Array, name: string): Uint8Array {
  let offset = 0;
  while (offset + 4 <= archive.length) {
    if (readUint32(archive, offset) !== 0x04034b50) {
      break;
    }
    const method = readUint16(archive, offset + 8);
    const size = readUint32(archive, offset + 18);
    const nameLength = readUint16(archive, offset + 26);
    const extraLength = readUint16(archive, offset + 28);
    const entryName = new TextDecoder().decode(archive.subarray(offset + 30, offset + 30 + nameLength));
    const dataStart = offset + 30 + nameLength + extraLength;
    if (entryName === name) {
      assert.equal(method, 0, 'PPTX entries are stored uncompressed');
      return archive.subarray(dataStart, dataStart + size);
    }
    offset = dataStart + size;
  }
  assert.fail(`missing zip entry "${name}"`);
}

function assertWellFormed(xml: string): void {
  const stack: string[] = [];
  const tagPattern = /<\/?([A-Za-z_][\w.:-]*)(?:\s[^<>]*?)?>/g;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(xml)) !== null) {
    const raw = match[0];
    const name = match[1];
    if (raw.startsWith('</')) {
      assert.equal(stack.pop(), name, `mismatched closing tag </${name}>`);
    } else if (!raw.endsWith('/>')) {
      stack.push(name);
    }
  }
  assert.deepEqual(stack, [], 'unclosed tags in emitted XML');
}

test('the PPTX archive is a valid zip and the slide part is well-formed OOXML', () => {
  const archive = createPptxArchive(exporterPresentation());
  const slide = new TextDecoder().decode(extractZipEntry(archive, 'ppt/slides/slide1.xml'));
  assertWellFormed(slide);
  assert.ok(slide.includes('<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'));
  assert.ok(
    slide.includes('<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 13208"/></a:avLst></a:prstGeom>'),
  );
  assert.ok(slide.includes('<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>'));
  assert.ok(slide.includes('<a:prstGeom prst="triangle"><a:avLst/></a:prstGeom>'));
  assert.ok(slide.includes('<a:prstGeom prst="diamond"><a:avLst/></a:prstGeom>'));
  assert.ok(slide.includes('name="A&amp;B &lt;C&gt; &quot;Q&quot; &apos;R&apos;"'));
  assert.ok(slide.includes('<a:xfrm rot="5400000"><a:off x="127000" y="127000"/>'));
});

test('PPTX color alpha is a child of srgbClr, never a sibling', () => {
  const slide = new TextDecoder().decode(extractZipEntry(createPptxArchive(exporterPresentation()), 'ppt/slides/slide1.xml'));
  assert.ok(slide.includes('<a:srgbClr val="FFD14E"><a:alpha val="50000"/></a:srgbClr>'));
  assert.ok(slide.includes('<a:srgbClr val="1C1C18"><a:alpha val="25000"/></a:srgbClr>'));
  assert.ok(!slide.includes('<a:srgbClr val="FFD14E"/><a:alpha'));
  assert.ok(slide.includes('<a:srgbClr val="EC6F42"/>'));
  assert.ok(!slide.includes('<a:alpha val="100000"/>'));
});
