import { useEffect } from 'react';
import { startWebMcpRegistration } from '../presentation/webmcp-registration';
import { workspaceWebMcpTools } from './tools';

/**
 * Registers the workspace WebMCP tool set on `document.modelContext`.
 * Cleanup aborts the registration generation so an unmounted page cannot
 * keep tools alive or overwrite a later page's status.
 */
export function useWorkspaceWebMcp(workspaceId: string): void {
  useEffect(() => {
    const modelContext = document.modelContext;
    if (!modelContext) {
      return undefined;
    }
    return startWebMcpRegistration(modelContext, workspaceWebMcpTools(workspaceId), {
      onReady: () => undefined,
      onFailed: (error) => {
        console.error('[webmcp] workspace tool registration failed:', error);
      },
    });
  }, [workspaceId]);
}
