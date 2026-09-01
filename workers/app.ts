import { createRequestHandler, RouterContextProvider } from 'react-router';
import { cloudflareRuntime, demoPrincipal } from '../app/lib/server/cloudflare';
import {
  applyDemoSessionResponse,
  isSecretConfigured,
  resolveDemoSession,
} from '../app/lib/server/demo-session';
import { hasSameOrigin, isStateChangingMethod } from '../app/lib/server/origin';
import {
  jsonForbiddenResponse,
  jsonInternalErrorResponse,
  jsonServiceUnavailableResponse,
} from '../app/lib/server/project-protocol';

const requestHandler = createRequestHandler(
  () => import('virtual:react-router/server-build'),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    if (!isSecretConfigured(env.DEMO_SESSION_SECRET)) {
      console.error('[comake:demo-session]', new Error('DEMO_SESSION_SECRET is not configured'));
      return jsonServiceUnavailableResponse();
    }

    if (isStateChangingMethod(request.method) && !hasSameOrigin(request)) {
      return jsonForbiddenResponse();
    }

    const context = new RouterContextProvider();
    context.set(cloudflareRuntime, { env, ctx });

    let session;
    try {
      session = await resolveDemoSession(request, env.DEMO_SESSION_SECRET);
    } catch (error) {
      console.error('[comake:demo-session]', error);
      return jsonInternalErrorResponse();
    }

    context.set(demoPrincipal, session.principal);
    const response = await requestHandler(request, context);
    return applyDemoSessionResponse(response, session);
  },
} satisfies ExportedHandler<Env>;

export { ProjectRoom } from './do/project-room';
export { ProjectRegistry } from './do/project-registry';
