import type { ClientDispatchRequest } from './attribution';
import type { DispatchResult, PresentationDocument } from './document';

export type { ClientDispatchRequest };

/**
 * The store's server boundary: the canonical document lives in the project's
 * ProjectRoom, and this interface is the only way the browser mirror talks to
 * it. The store serializes every call; a transport implementation must never
 * retry a rejected intent itself. The client sends interaction kind only;
 * the server stamps the canonical actor.
 */
export interface ProjectTransport {
  /** POST one canonical dispatch; structured kernel failures are returned as typed results. */
  dispatch(projectId: string, request: ClientDispatchRequest): Promise<DispatchResult>;
  /** GET the canonical document; null when the project does not exist. */
  readDocument(projectId: string): Promise<PresentationDocument | null>;
}

/**
 * Browser HTTP transport for the canonical project API. Structured kernel
 * failures (including `STALE_REVISION`) come back as typed results; network
 * and malformed-response conditions throw, which the store maps to an honest
 * `TRANSPORT_ERROR` result — never a local fallback.
 */
export class HttpProjectTransport implements ProjectTransport {
  async dispatch(projectId: string, request: ClientDispatchRequest): Promise<DispatchResult> {
    let response: Response;
    try {
      response = await fetch(`/api/projects/${projectId}/dispatch`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
    } catch (error) {
      throw new Error(`dispatch request failed for project "${projectId}"`, { cause: error });
    }
    const body = (await response.json()) as DispatchResult;
    if (typeof body !== 'object' || body === null || typeof body.ok !== 'boolean') {
      throw new Error(`malformed dispatch response for project "${projectId}"`);
    }
    return body;
  }

  async readDocument(projectId: string): Promise<PresentationDocument | null> {
    let response: Response;
    try {
      response = await fetch(`/api/projects/${projectId}/document`, { credentials: 'same-origin' });
    } catch (error) {
      throw new Error(`document read failed for project "${projectId}"`, { cause: error });
    }
    const body = (await response.json()) as { ok: true; document: PresentationDocument } | { ok: false };
    if (typeof body !== 'object' || body === null || typeof body.ok !== 'boolean') {
      throw new Error(`malformed document response for project "${projectId}"`);
    }
    return body.ok ? body.document : null;
  }
}
