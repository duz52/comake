import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canonicalDispatchRequest, type ClientDispatchRequest } from '../../app/lib/presentation/attribution';
import {
  dispatchPresentationDocument,
  type DispatchResult,
  type PresentationDocument,
} from '../../app/lib/presentation/document';
import { PresentationStore } from '../../app/lib/presentation/store';
import type { ProjectTransport } from '../../app/lib/presentation/transport';
import type { TextElement } from '../../app/types/presentation';
import { fixtureDocument, KernelTransport, PROJECT_ID, TEST_PRINCIPAL } from './fixtures';

function initialSlideId(document: PresentationDocument): string {
  return document.presentation.slideOrder[0];
}

function createRequest(name: string): ClientDispatchRequest {
  const document = fixtureDocument();
  const element: TextElement = {
    id: `el-${name}`,
    kind: 'text',
    name,
    frame: { x: 40, y: 40, width: 120, height: 80 },
    text: name,
    style: { color: '#111111', fontFamily: 'Manrope, sans-serif', fontSize: 19 },
  };
  return {
    actorKind: 'human',
    label: `Added ${name}`,
    operations: [{ type: 'create_element', slideId: initialSlideId(document), element }],
  };
}

function kernelRequest(name: string) {
  const canonical = canonicalDispatchRequest(TEST_PRINCIPAL, createRequest(name));
  if (!canonical.ok) {
    throw new Error(canonical.detail);
  }
  return canonical.value;
}

class AheadTransport implements ProjectTransport {
  public serverDocument: PresentationDocument;
  public readCalls = 0;
  public dispatchCalls = 0;

  constructor(serverDocument: PresentationDocument) {
    this.serverDocument = serverDocument;
  }

  async dispatch(_projectId: string, _request: ClientDispatchRequest): Promise<DispatchResult> {
    this.dispatchCalls += 1;
    return {
      ok: false,
      failure: { code: 'STALE_REVISION', currentRevision: this.serverDocument.presentation.revision },
    };
  }

  async readDocument(_projectId: string): Promise<PresentationDocument | null> {
    this.readCalls += 1;
    return this.serverDocument;
  }
}

class FailingTransport implements ProjectTransport {
  public reads = 0;

  async dispatch(_projectId: string, _request: ClientDispatchRequest): Promise<DispatchResult> {
    throw new Error('network unreachable');
  }

  async readDocument(_projectId: string): Promise<PresentationDocument | null> {
    this.reads += 1;
    return null;
  }
}

class RecordingTransport extends KernelTransport {
  public baseRevisions: Array<number | undefined> = [];

  constructor(document: PresentationDocument = fixtureDocument()) {
    super(document);
  }

  async dispatch(projectId: string, request: ClientDispatchRequest): Promise<DispatchResult> {
    this.baseRevisions.push(request.baseRevision);
    return super.dispatch(projectId, request);
  }
}

function newStore(transport: ProjectTransport = new KernelTransport(fixtureDocument())): PresentationStore {
  return new PresentationStore(fixtureDocument(), initialSlideId(fixtureDocument()), transport, PROJECT_ID);
}

test('an accepted write replaces the mirror with the authoritative document', async () => {
  const transport = new KernelTransport(fixtureDocument());
  const store = newStore(transport);
  const before = store.getSnapshot();

  const result = await store.dispatch(createRequest('Accepted'));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.changeSet.revision, 1);

  const after = store.getSnapshot();
  assert.equal(after.presentation.revision, 1);
  assert.ok(after.presentation.slides[before.session.activeSlideId].elements['el-Accepted']);
  assert.equal(transport.readCalls, 0);
  assert.equal(after.userUndoStack.length, 1);
  assert.equal(after.changeSetOrder.length, 1);
});

test('a stale revision refreshes the mirror once and never retries the write', async () => {
  const transport = new AheadTransport(fixtureDocument());
  const ahead = dispatchPresentationDocument(transport.serverDocument, kernelRequest('Server ahead'));
  assert.equal(ahead.ok, true);
  if (!ahead.ok) return;
  transport.serverDocument = ahead.document;

  const store = newStore(transport);
  const stale = await store.dispatch(createRequest('Stale intent'));

  assert.equal(stale.ok, false);
  if (stale.ok) return;
  assert.deepEqual(stale.failure, { code: 'STALE_REVISION', currentRevision: 1 });
  assert.equal(transport.readCalls, 1);
  assert.equal(transport.dispatchCalls, 1);

  const mirror = store.getSnapshot();
  assert.equal(mirror.presentation.revision, 1);
  assert.ok(mirror.presentation.slides[initialSlideId(mirror)].elements['el-Server ahead']);
  assert.equal(mirror.userUndoStack.length, 0);
});

test('a transport error does not mutate store state', async () => {
  const transport = new FailingTransport();
  const store = newStore(transport);
  const before = store.getSnapshot();

  const result = await store.dispatch(createRequest('Never lands'));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, 'TRANSPORT_ERROR');

  const after = store.getSnapshot();
  assert.equal(after.presentation.revision, before.presentation.revision);
  assert.deepEqual(after.userUndoStack, []);
  assert.equal(transport.reads, 0);
});

test('concurrent writes are serialized and cannot reorder', async () => {
  const transport = new RecordingTransport();
  const store = newStore(transport);

  const results = await Promise.all(
    ['One', 'Two', 'Three', 'Four', 'Five'].map((name) => store.dispatch(createRequest(name))),
  );
  for (const result of results) {
    assert.equal(result.ok, true);
  }

  assert.deepEqual(transport.baseRevisions, [0, 1, 2, 3, 4]);
  assert.equal(store.getSnapshot().presentation.revision, 5);
  assert.equal(store.getSnapshot().userUndoStack.length, 5);
});
