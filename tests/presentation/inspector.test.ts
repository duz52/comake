import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  consumeDirtyInspectorEscape,
  deriveShellChrome,
  inspectorIsOpen,
  overlayOpenerFromMenuState,
  toggleDrawerTransition,
  toggleInspectorTransition,
  viewportChangeTransition,
} from '../../app/components/presentation/shell-overlay';

test('inspectorIsOpen: default follows the viewport; explicit intent does not', () => {
  assert.equal(inspectorIsOpen('default', true), true);
  assert.equal(inspectorIsOpen('default', false), false);
  assert.equal(inspectorIsOpen('open', true), true);
  assert.equal(inspectorIsOpen('open', false), true);
  assert.equal(inspectorIsOpen('closed', true), false);
  assert.equal(inspectorIsOpen('closed', false), false);
});

test('deriveShellChrome: wide default is the inline column; narrow default is closed', () => {
  assert.deepEqual(deriveShellChrome({ intent: 'default', presenting: false, wideViewport: true }), {
    inspectorOpen: true,
    inspectorInline: true,
    inspectorOverlay: false,
  });
  assert.deepEqual(deriveShellChrome({ intent: 'default', presenting: false, wideViewport: false }), {
    inspectorOpen: false,
    inspectorInline: false,
    inspectorOverlay: false,
  });
});

test('deriveShellChrome: explicit open survives Present as intent but overlay unmounts', () => {
  assert.deepEqual(deriveShellChrome({ intent: 'open', presenting: false, wideViewport: false }), {
    inspectorOpen: true,
    inspectorInline: false,
    inspectorOverlay: true,
  });
  const presenting = deriveShellChrome({ intent: 'open', presenting: true, wideViewport: false });
  assert.equal(presenting.inspectorOpen, true);
  assert.equal(presenting.inspectorOverlay, false);
  assert.equal(presenting.inspectorInline, false);
});

test('toggleInspectorTransition: narrow open occupies the overlay slot and dismisses menus', () => {
  const opened = toggleInspectorTransition({
    drawer: 'agent',
    inspectorOpen: false,
    wideViewport: false,
  });
  assert.deepEqual(opened, { intent: 'open', drawer: null, dismissTransientMenus: true });
  assert.equal(
    deriveShellChrome({ intent: opened.intent, presenting: false, wideViewport: false }).inspectorOverlay,
    true,
  );

  const closed = toggleInspectorTransition({
    drawer: null,
    inspectorOpen: true,
    wideViewport: false,
  });
  assert.deepEqual(closed, { intent: 'closed', drawer: null, dismissTransientMenus: false });
});

test('toggleInspectorTransition: wide open keeps a review drawer', () => {
  assert.deepEqual(
    toggleInspectorTransition({
      drawer: 'comments',
      inspectorOpen: false,
      wideViewport: true,
    }),
    { intent: 'open', drawer: 'comments', dismissTransientMenus: false },
  );
});

test('toggleDrawerTransition: narrow Agent closes inspector; wide Agent does not', () => {
  assert.deepEqual(
    toggleDrawerTransition({ drawer: null, kind: 'agent', wideViewport: false }),
    { drawer: 'agent', inspectorIntent: 'closed', dismissTransientMenus: true },
  );
  assert.deepEqual(
    toggleDrawerTransition({ drawer: null, kind: 'agent', wideViewport: true }),
    { drawer: 'agent', inspectorIntent: undefined, dismissTransientMenus: true },
  );
  assert.deepEqual(
    toggleDrawerTransition({ drawer: 'agent', kind: 'agent', wideViewport: false }),
    { drawer: null, inspectorIntent: undefined, dismissTransientMenus: false },
  );
});

test('viewportChangeTransition: default desktop to phone closes inspector without writing intent', () => {
  assert.deepEqual(viewportChangeTransition({ drawer: 'agent', intent: 'default', wide: false }), {
    wideViewport: false,
    drawer: 'agent',
    dismissTransientMenus: false,
  });
});

test('viewportChangeTransition: explicit open to phone yields the review drawer in the same turn', () => {
  assert.deepEqual(viewportChangeTransition({ drawer: 'activity', intent: 'open', wide: false }), {
    wideViewport: false,
    drawer: null,
    dismissTransientMenus: true,
  });
});

test('consumeDirtyInspectorEscape: dirty fields cancel; clean fields leave Escape for the overlay', () => {
  let reverted = false;
  let prevented = false;
  consumeDirtyInspectorEscape(
    {
      key: 'Escape',
      preventDefault() {
        prevented = true;
      },
    },
    true,
    () => {
      reverted = true;
    },
  );
  assert.equal(prevented, true);
  assert.equal(reverted, true);

  let cleanPrevented = false;
  consumeDirtyInspectorEscape(
    {
      key: 'Escape',
      preventDefault() {
        cleanPrevented = true;
      },
    },
    false,
    () => {
      throw new Error('clean field must not revert');
    },
  );
  assert.equal(cleanPrevented, false);
});

test('overlayOpenerFromMenuState: an open menu restores to its trigger, not the event target', () => {
  assert.equal(
    overlayOpenerFromMenuState({ fromMenu: true, expandedMore: true, expandedReview: false }),
    'more',
  );
  assert.equal(
    overlayOpenerFromMenuState({ fromMenu: true, expandedMore: false, expandedReview: true }),
    'review',
  );
  assert.equal(
    overlayOpenerFromMenuState({ fromMenu: true, expandedMore: false, expandedReview: false }),
    'more',
  );
  assert.equal(
    overlayOpenerFromMenuState({ fromMenu: false, expandedMore: false, expandedReview: false }),
    'active',
  );
});
