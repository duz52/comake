import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseControlPresentationInput } from '../../app/lib/presentation/operations';
import { PresentationStore } from '../../app/lib/presentation/store';
import { presentationWebMcpTools } from '../../app/lib/presentation/webmcp';
import { createStore } from './fixtures';

function tool(store: PresentationStore, name: string) {
  const found = presentationWebMcpTools(store).find((entry) => entry.name === name);
  assert.ok(found, `missing tool ${name}`);
  return found;
}

type ToolWire = {
  ok?: boolean;
  code?: string;
  action?: string;
  presenting?: boolean;
  focusRevision?: number;
  detail?: string;
  atStart?: boolean;
  atEnd?: boolean;
  activeSlide?: { id?: string; index?: number };
  presentation?: { presenting?: boolean; activeSlideId?: string };
};

function asResult(value: unknown): ToolWire {
  assert.equal(typeof value, 'object');
  assert.notEqual(value, null);
  return value as ToolWire;
}

test('parseControlPresentationInput rejects unknown keys and invalid combinations', () => {
  const unknown = parseControlPresentationInput({ action: 'start', extra: true });
  assert.equal(unknown.ok, false);
  if (unknown.ok) return;
  assert.match(unknown.detail, /unknown property "extra"/);

  assert.equal(parseControlPresentationInput({ action: '' }).ok, false);

  const nextWithSlide = parseControlPresentationInput({ action: 'next', slideId: 'slide-cover' });
  assert.equal(nextWithSlide.ok, false);
  if (nextWithSlide.ok) return;
  assert.match(nextWithSlide.detail, /slideId is not allowed for action "next"/);

  assert.equal(parseControlPresentationInput({ action: 'exit', slideId: 'slide-cover' }).ok, false);

  const missingGoTo = parseControlPresentationInput({ action: 'go_to_slide' });
  assert.equal(missingGoTo.ok, false);
  if (missingGoTo.ok) return;
  assert.match(missingGoTo.detail, /slideId is required for action "go_to_slide"/);

  const emptySlideId = parseControlPresentationInput({ action: 'go_to_slide', slideId: '' });
  assert.equal(emptySlideId.ok, false);
  if (emptySlideId.ok) return;
  assert.match(emptySlideId.detail, /slideId must be a non-empty string/);

  assert.equal(parseControlPresentationInput({ action: 'start' }).ok, true);
  assert.equal(parseControlPresentationInput({ action: 'start', slideId: 'slide-cover' }).ok, true);
});

test('control_presentation execute matches store results including failure extras', async () => {
  const store = createStore();
  const control = tool(store, 'control_presentation');
  const [coverId, problemId] = store.getSnapshot().presentation.slideOrder;

  const idleNext = asResult(await control.execute({ action: 'next' }));
  assert.equal(idleNext.ok, false);
  assert.equal(idleNext.code, 'NOT_PRESENTING');
  assert.equal(idleNext.action, 'next');
  assert.equal(idleNext.presenting, false);
  assert.equal(idleNext.activeSlide?.id, coverId);
  assert.equal(typeof idleNext.focusRevision, 'number');
  assert.equal(typeof idleNext.detail, 'string');

  const started = asResult(await control.execute({ action: 'start' }));
  assert.equal(started.ok, true);
  assert.equal(started.action, 'start');
  assert.equal(started.presenting, true);
  assert.equal(started.activeSlide?.id, coverId);
  assert.equal(started.atStart, true);

  const jumped = asResult(await control.execute({ action: 'go_to_slide', slideId: problemId }));
  assert.equal(jumped.ok, true);
  assert.equal(jumped.activeSlide?.id, problemId);
  assert.equal(jumped.activeSlide?.index, 2);

  const missing = asResult(await control.execute({ action: 'go_to_slide', slideId: 'nope' }));
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'NOT_FOUND');
  assert.equal(missing.presenting, true);
  assert.equal(missing.activeSlide?.id, problemId);

  const previousAtFirst = asResult(await control.execute({ action: 'go_to_slide', slideId: coverId }));
  assert.equal(previousAtFirst.ok, true);
  const boundary = asResult(await control.execute({ action: 'previous' }));
  assert.equal(boundary.ok, false);
  assert.equal(boundary.code, 'AT_BOUNDARY');
  assert.equal(boundary.activeSlide?.id, coverId);

  const invalid = asResult(await control.execute({ action: 'next', slideId: coverId }));
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, 'INVALID_INPUT');
  assert.equal(invalid.presenting, true);
  assert.equal(invalid.activeSlide?.id, coverId);
});

test('context and outline report presenting from the live store closure', async () => {
  const store = createStore();
  const tools = presentationWebMcpTools(store);
  const context = tools.find((entry) => entry.name === 'get_presentation_context');
  const outline = tools.find((entry) => entry.name === 'get_presentation_outline');
  const control = tools.find((entry) => entry.name === 'control_presentation');
  assert.ok(context && outline && control);

  const before = asResult(await context.execute({}));
  assert.equal(before.ok, true);
  assert.equal(before.presenting, false);
  const beforeOutline = asResult(await outline.execute({}));
  assert.equal(beforeOutline.presentation?.presenting, false);

  await control.execute({ action: 'start' });

  const after = asResult(await context.execute({}));
  assert.equal(after.presenting, true);
  assert.equal(after.activeSlide?.id, store.getSnapshot().session.activeSlideId);
  const afterOutline = asResult(await outline.execute({}));
  assert.equal(afterOutline.presentation?.presenting, true);
  assert.equal(afterOutline.presentation?.activeSlideId, store.getSnapshot().session.activeSlideId);
});

test('control_presentation does not create a change set or require baseRevision', async () => {
  const store = createStore();
  const control = tool(store, 'control_presentation');
  const before = store.getSnapshot();
  await control.execute({ action: 'start' });
  await control.execute({ action: 'next' });
  const after = store.getSnapshot();
  assert.equal(after.presentation.revision, before.presentation.revision);
  assert.deepEqual(after.changeSetOrder, before.changeSetOrder);
  assert.equal(after.session.presenting, true);
  assert.ok(control.inputSchema.properties && typeof control.inputSchema.properties === 'object');
  assert.equal('baseRevision' in control.inputSchema.properties, false);
});
