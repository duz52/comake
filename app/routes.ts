import { index, route, type RouteConfig } from '@react-router/dev/routes';

export default [
  index('routes/index.tsx'),
  route('workspace/:workspaceId/presentation/:presentationId/slide/:slideId', 'routes/presentation.tsx'),
] satisfies RouteConfig;
