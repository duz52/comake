import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decideSessionRoute } from '../../app/lib/presentation/location';

const base = {
  activeSlideId: 'slide-2',
  routeSlideId: 'slide-4',
  navigationType: 'POP',
  routeMoved: false,
  routeSlideExists: true,
  pushEditorHistory: false,
};

test('matching ids are idle even when a leftover push intent or POP is present', () => {
  assert.deepEqual(
    decideSessionRoute({
      ...base,
      routeSlideId: 'slide-2',
      navigationType: 'POP',
      routeMoved: true,
      pushEditorHistory: true,
    }),
    { kind: 'idle' },
  );
});

test('a POP whose route id moved onto a live slide is inbound and ignores push intent', () => {
  assert.deepEqual(
    decideSessionRoute({
      ...base,
      navigationType: 'POP',
      routeMoved: true,
      routeSlideExists: true,
      pushEditorHistory: true,
    }),
    { kind: 'inbound-pop', slideId: 'slide-4' },
  );
});

test('initial POP load with a stale URL replace-projects the session', () => {
  assert.deepEqual(
    decideSessionRoute({
      ...base,
      navigationType: 'POP',
      routeMoved: false,
      pushEditorHistory: false,
    }),
    { kind: 'project', replace: true },
  );
});

test('editor push intent projects with PUSH when the session moved the displayed slide', () => {
  assert.deepEqual(
    decideSessionRoute({
      ...base,
      navigationType: 'POP',
      routeMoved: false,
      pushEditorHistory: true,
    }),
    { kind: 'project', replace: false },
  );
});

test('session changes after PUSH or REPLACE settlement replace-project unless a new push intent is set', () => {
  assert.deepEqual(
    decideSessionRoute({
      ...base,
      navigationType: 'REPLACE',
      routeMoved: true,
      pushEditorHistory: false,
    }),
    { kind: 'project', replace: true },
  );
  assert.deepEqual(
    decideSessionRoute({
      ...base,
      navigationType: 'PUSH',
      routeMoved: true,
      pushEditorHistory: true,
    }),
    { kind: 'project', replace: false },
  );
});

test('an invalid or deleted POP route is not inbound and replace-projects the live session', () => {
  assert.deepEqual(
    decideSessionRoute({
      ...base,
      routeSlideId: 'deleted',
      navigationType: 'POP',
      routeMoved: true,
      routeSlideExists: false,
      pushEditorHistory: false,
    }),
    { kind: 'project', replace: true },
  );
  assert.deepEqual(
    decideSessionRoute({
      ...base,
      routeSlideId: undefined,
      navigationType: 'POP',
      routeMoved: true,
      routeSlideExists: false,
      pushEditorHistory: false,
    }),
    { kind: 'project', replace: true },
  );
});
