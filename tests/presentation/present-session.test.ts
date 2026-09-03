import assert from 'node:assert/strict';
import { test } from 'node:test';

import { slideTitleText } from '../../app/lib/presentation/document';
import { PresentationStore } from '../../app/lib/presentation/store';
import { createStore } from './fixtures';

function slideIds(store: PresentationStore): string[] {
  return store.getSnapshot().presentation.slideOrder;
}

function canonicalUnchanged(
  before: ReturnType<PresentationStore['getSnapshot']>,
  after: ReturnType<PresentationStore['getSnapshot']>,
): void {
  assert.equal(after.presentation.revision, before.presentation.revision);
  assert.deepEqual(after.changeSetOrder, before.changeSetOrder);
  assert.deepEqual(after.userUndoStack, before.userUndoStack);
  assert.deepEqual(after.userRedoStack, before.userRedoStack);
}

test('start from idle presents the current slide and bumps focus without a change set', () => {
  const store = createStore();
  const before = store.getSnapshot();
  const [coverId] = slideIds(store);
  const cover = before.presentation.slides[coverId];

  const result = store.controlPresentation({ action: 'start' });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.action, 'start');
  assert.equal(result.view.presenting, true);
  assert.equal(result.view.focusRevision, before.session.focusRevision + 1);
  assert.deepEqual(result.view.activeSlide, {
    id: coverId,
    index: 1,
    name: cover.name,
    title: slideTitleText(cover),
  });
  assert.equal(result.view.atStart, true);
  assert.equal(result.view.atEnd, false);

  const after = store.getSnapshot();
  assert.equal(after.session.presenting, true);
  assert.equal(after.session.activeSlideId, coverId);
  assert.equal(after.session.focusRevision, before.session.focusRevision + 1);
  canonicalUnchanged(before, after);
});

test('start twice on the same slide is ok and does not bump focus', () => {
  const store = createStore();
  store.controlPresentation({ action: 'start' });
  const afterFirst = store.getSnapshot();
  const second = store.controlPresentation({ action: 'start' });
  assert.equal(second.ok, true);
  assert.equal(store.getSnapshot().session.focusRevision, afterFirst.session.focusRevision);
  assert.equal(store.getSnapshot().session.presenting, true);
});

test('start with a valid slideId jumps, clears selection, and bumps focus once', () => {
  const store = createStore();
  const [coverId, problemId] = slideIds(store);
  const cover = store.getSnapshot().presentation.slides[coverId];
  const elementId = cover.elementOrder[0];
  store.selectElement(elementId);
  const before = store.getSnapshot();
  assert.deepEqual(before.session.selectedElementIds, [elementId]);

  const result = store.controlPresentation({ action: 'start', slideId: problemId });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.view.presenting, true);
  assert.equal(result.view.activeSlide.id, problemId);
  assert.equal(result.view.activeSlide.index, 2);
  assert.equal(result.view.focusRevision, before.session.focusRevision + 1);
  assert.deepEqual(store.getSnapshot().session.selectedElementIds, []);
  canonicalUnchanged(before, store.getSnapshot());
});

test('start with an unknown slideId is NOT_FOUND and does not enter presenting', () => {
  const store = createStore();
  const before = store.getSnapshot();
  const result = store.controlPresentation({ action: 'start', slideId: 'missing-slide' });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'NOT_FOUND');
  assert.equal(result.view.presenting, false);
  assert.equal(store.getSnapshot().session.presenting, false);
  assert.equal(store.getSnapshot().session.focusRevision, before.session.focusRevision);
  assert.equal(store.getSnapshot().session.activeSlideId, before.session.activeSlideId);
});

test('next, previous, and go_to_slide while idle are NOT_PRESENTING', () => {
  const store = createStore();
  const [coverId, problemId] = slideIds(store);
  const before = store.getSnapshot();

  for (const command of [
    { action: 'next' as const },
    { action: 'previous' as const },
    { action: 'go_to_slide' as const, slideId: problemId },
  ]) {
    const result = store.controlPresentation(command);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'NOT_PRESENTING');
    assert.equal(result.view.presenting, false);
    assert.equal(result.view.activeSlide.id, coverId);
  }

  const after = store.getSnapshot();
  assert.equal(after.session.focusRevision, before.session.focusRevision);
  assert.equal(after.session.activeSlideId, coverId);
  canonicalUnchanged(before, after);
});

test('next at the last slide and previous at the first are AT_BOUNDARY', () => {
  const store = createStore();
  const order = slideIds(store);
  store.controlPresentation({ action: 'start' });
  const atFirst = store.getSnapshot();
  const previous = store.controlPresentation({ action: 'previous' });
  assert.equal(previous.ok, false);
  if (previous.ok) return;
  assert.equal(previous.code, 'AT_BOUNDARY');
  assert.equal(previous.view.activeSlide.id, order[0]);
  assert.equal(store.getSnapshot().session.focusRevision, atFirst.session.focusRevision);

  store.controlPresentation({ action: 'go_to_slide', slideId: order[order.length - 1] });
  const atLast = store.getSnapshot();
  const next = store.controlPresentation({ action: 'next' });
  assert.equal(next.ok, false);
  if (next.ok) return;
  assert.equal(next.code, 'AT_BOUNDARY');
  assert.equal(next.view.activeSlide.id, order[order.length - 1]);
  assert.equal(store.getSnapshot().session.focusRevision, atLast.session.focusRevision);
});

test('next and previous in the middle move to the neighbor and bump focus once', () => {
  const store = createStore();
  const [, problemId, gapId] = slideIds(store);
  store.controlPresentation({ action: 'start', slideId: problemId });
  const problem = store.getSnapshot().presentation.slides[problemId];
  store.selectElement(problem.elementOrder[0]);
  const beforeNext = store.getSnapshot();

  const next = store.controlPresentation({ action: 'next' });
  assert.equal(next.ok, true);
  if (!next.ok) return;
  assert.equal(next.view.activeSlide.id, gapId);
  assert.equal(next.view.focusRevision, beforeNext.session.focusRevision + 1);
  assert.deepEqual(store.getSnapshot().session.selectedElementIds, []);

  const previous = store.controlPresentation({ action: 'previous' });
  assert.equal(previous.ok, true);
  if (!previous.ok) return;
  assert.equal(previous.view.activeSlide.id, problemId);
});

test('go_to_slide to the same id with a selection does not clear it or bump focus', () => {
  const store = createStore();
  const [coverId] = slideIds(store);
  store.controlPresentation({ action: 'start' });
  const elementId = store.getSnapshot().presentation.slides[coverId].elementOrder[0];
  store.selectElement(elementId);
  const before = store.getSnapshot();

  const result = store.controlPresentation({ action: 'go_to_slide', slideId: coverId });
  assert.equal(result.ok, true);
  assert.deepEqual(store.getSnapshot().session.selectedElementIds, [elementId]);
  assert.equal(store.getSnapshot().session.focusRevision, before.session.focusRevision);
});

test('go_to_slide with an unknown id is NOT_FOUND', () => {
  const store = createStore();
  store.controlPresentation({ action: 'start' });
  const before = store.getSnapshot();
  const result = store.controlPresentation({ action: 'go_to_slide', slideId: 'nope' });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'NOT_FOUND');
  assert.equal(store.getSnapshot().session.activeSlideId, before.session.activeSlideId);
  assert.equal(store.getSnapshot().session.focusRevision, before.session.focusRevision);
});

test('exit while presenting leaves the last shown slide; exit while idle does not bump focus', () => {
  const store = createStore();
  const [, problemId] = slideIds(store);
  store.controlPresentation({ action: 'start', slideId: problemId });
  const presenting = store.getSnapshot();
  const exit = store.controlPresentation({ action: 'exit' });
  assert.equal(exit.ok, true);
  if (!exit.ok) return;
  assert.equal(exit.view.presenting, false);
  assert.equal(exit.view.activeSlide.id, problemId);
  assert.equal(exit.view.focusRevision, presenting.session.focusRevision + 1);

  const idle = store.getSnapshot();
  const second = store.controlPresentation({ action: 'exit' });
  assert.equal(second.ok, true);
  assert.equal(store.getSnapshot().session.focusRevision, idle.session.focusRevision);
  assert.equal(store.getSnapshot().session.presenting, false);
});

test('optional start slideId while already presenting jumps without exiting', () => {
  const store = createStore();
  const [coverId, problemId] = slideIds(store);
  store.controlPresentation({ action: 'start' });
  const before = store.getSnapshot();
  const jumped = store.controlPresentation({ action: 'start', slideId: problemId });
  assert.equal(jumped.ok, true);
  if (!jumped.ok) return;
  assert.equal(jumped.view.presenting, true);
  assert.equal(jumped.view.activeSlide.id, problemId);
  assert.equal(jumped.view.focusRevision, before.session.focusRevision + 1);
  assert.notEqual(coverId, problemId);
});
