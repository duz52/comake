import { index, route, type RouteConfig } from '@react-router/dev/routes';

export default [
  index('routes/index.tsx'),
  route('workspace/:workspaceId', 'routes/workspace.tsx'),
  route('workspace/:workspaceId/presentation/:presentationId', 'routes/presentation.tsx'),
  route('workspace/:workspaceId/presentation/:presentationId/slide/:slideId', 'routes/presentation-slide.tsx'),
  route('api/workspace/:workspaceId', 'routes/api-workspace.ts'),
  route('api/projects/:projectId/document', 'routes/api-document.ts'),
  route('api/projects/:projectId/dispatch', 'routes/api-dispatch.ts'),
] satisfies RouteConfig;
