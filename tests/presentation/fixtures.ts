import { canonicalDispatchRequest, type ClientDispatchRequest } from '../../app/lib/presentation/attribution';
import {
  dispatchPresentationDocument,
  type DispatchResult,
  type PresentationDocument,
} from '../../app/lib/presentation/document';
import { PresentationStore } from '../../app/lib/presentation/store';
import { cloneTemplateDocument } from '../../app/lib/presentation/template';
import { launchTemplate } from '../../app/lib/presentation/templates/launch';
import type { ProjectTransport } from '../../app/lib/presentation/transport';

export const PROJECT_ID = 'p-unit-test';
export const TEST_PRINCIPAL = { actorId: 'demo', displayName: 'Demo' };

export function fixtureDocument(): PresentationDocument {
  return cloneTemplateDocument(launchTemplate, PROJECT_ID).document;
}

/** In-memory transport that runs the canonical kernel and records call counts. */
export class KernelTransport implements ProjectTransport {
  protected document: PresentationDocument;
  public dispatchCalls = 0;
  public readCalls = 0;

  constructor(document: PresentationDocument) {
    this.document = document;
  }

  async dispatch(_projectId: string, request: ClientDispatchRequest): Promise<DispatchResult> {
    this.dispatchCalls += 1;
    const canonical = canonicalDispatchRequest(TEST_PRINCIPAL, request);
    if (!canonical.ok) {
      return { ok: false, failure: { code: 'INVALID_INPUT', detail: canonical.detail } };
    }
    const result = dispatchPresentationDocument(this.document, canonical.value);
    if (result.ok) {
      this.document = result.document;
    }
    return result;
  }

  async readDocument(_projectId: string): Promise<PresentationDocument | null> {
    this.readCalls += 1;
    return this.document;
  }
}

export function createStore(transport?: ProjectTransport): PresentationStore {
  const document = fixtureDocument();
  return new PresentationStore(
    document,
    document.presentation.slideOrder[0],
    transport ?? new KernelTransport(document),
    PROJECT_ID,
  );
}
