import { Link } from 'react-router';
import { workspacePath } from '../../lib/presentation/location';
import type { PresentationSnapshot } from '../../lib/presentation/store';
import type { DrawerKind } from './command-registry';
import { ThemeToggle } from '../theme-toggle';

export type { DrawerKind } from './command-registry';

/**
 * The compact document header: mark, back affordance, document identity,
 * saved revision, WebMCP status, and the on-demand panel actions. Nothing
 * here claims collaboration, sharing, or presence that is not implemented —
 * unavailable actions are disabled with honest tooltips.
 */
export function EditorHeader({
  activeDrawer,
  canExport,
  onExport,
  onOpenDrawer,
  onPresent,
  openCommentCount,
  pendingAgentChanges,
  snapshot,
  webMcpAvailable,
  workspaceId,
}: {
  activeDrawer: DrawerKind | null;
  canExport: boolean;
  onExport: () => void;
  onOpenDrawer: (drawer: DrawerKind) => void;
  onPresent: () => void;
  openCommentCount: number;
  pendingAgentChanges: number;
  snapshot: PresentationSnapshot;
  webMcpAvailable: boolean;
  workspaceId: string;
}) {
  const revision = snapshot.presentation.revision;

  return (
    <header className="app-header">
      <Link
        aria-label="Open workspace"
        className="hdr-mark"
        title="Open workspace"
        to={workspacePath(workspaceId)}
      >
        C
      </Link>
      <div className="hdr-divider" aria-hidden="true" />
      <div className="hdr-crumb">
        <div className="hdr-title">
          <span className="hdr-title-text">{snapshot.presentation.title}</span>
        </div>
      </div>

      <div className="hdr-actions">
        <span
          className="hchip"
          title="This project is saved. Reopening it restores this revision."
        >
          Saved · rev {revision}
        </span>
        <span
          className={`hchip${webMcpAvailable ? ' is-live' : ''}`}
          title={
            webMcpAvailable
              ? 'WebMCP is available: an external agent can connect to this artifact.'
              : 'WebMCP is unavailable in this browser, so no external agent can connect here.'
          }
        >
          <span aria-hidden="true" className="hdot" />
          WebMCP {webMcpAvailable ? 'ready' : 'unavailable'}
        </span>
        <div className="hdr-divider" aria-hidden="true" />
        <button className="hbutton" onClick={onPresent} title="Present this deck full screen" type="button">
          Present
        </button>
        <button
          aria-label="Export the presentation as PowerPoint"
          className="hbutton is-brand"
          disabled={!canExport}
          onClick={onExport}
          title="Download the current presentation as a PowerPoint file"
          type="button"
        >
          Export .pptx
        </button>
        <button
          aria-pressed={activeDrawer === 'agent'}
          className={`hbutton${activeDrawer === 'agent' ? ' is-on' : ''}${pendingAgentChanges > 0 ? ' has-dot' : ''}`}
          onClick={() => onOpenDrawer('agent')}
          title={`Agent review${pendingAgentChanges > 0 ? ` · ${pendingAgentChanges} agent change set${pendingAgentChanges === 1 ? '' : 's'}` : ''}`}
          type="button"
        >
          Agent
        </button>
        <button
          aria-pressed={activeDrawer === 'comments'}
          className={`hbutton${activeDrawer === 'comments' ? ' is-on' : ''}`}
          onClick={() => onOpenDrawer('comments')}
          title={openCommentCount > 0 ? `${openCommentCount} open comment${openCommentCount === 1 ? '' : 's'}` : 'Open comments'}
          type="button"
        >
          Comments{openCommentCount > 0 ? ` (${openCommentCount})` : ''}
        </button>
        <button
          aria-pressed={activeDrawer === 'activity'}
          className={`hbutton${activeDrawer === 'activity' ? ' is-on' : ''}`}
          onClick={() => onOpenDrawer('activity')}
          title="Review the change history"
          type="button"
        >
          Activity
        </button>
        <ThemeToggle />
      </div>
    </header>
  );
}