import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Menu } from '@base-ui/react/menu';
import { MAX_PRESENTATION_TITLE_LENGTH } from '../../lib/presentation/document';
import { workspacePath } from '../../lib/presentation/location';
import type { PresentationSnapshot } from '../../lib/presentation/store';
import type { DrawerKind } from './command-registry';
import { CommandIcon } from './command-icons';
import { ThemeToggle } from '../theme-toggle';
import { Tooltip } from '../ui/tooltip';

export type { DrawerKind } from './command-registry';

/**
 * The compact document header: mark, back affordance, document identity,
 * saved revision, WebMCP status, and the on-demand panel actions. Nothing
 * here claims collaboration, sharing, or presence that is not implemented —
 * unavailable actions are disabled with honest tooltips.
 *
 * The visible title is the canonical presentation title. Clicking it opens
 * an inline editor that commits through `onRenamePresentation` (the same
 * human store transport as every other edit). Below 900px, Agent / Comments
 * / Activity fold into a Review menu so Present and Export stay on one row.
 * The split is CSS, matching the inspector's hydration-safe first paint.
 */
export function EditorHeader({
  activeDrawer,
  canExport,
  menuEpoch,
  onExport,
  onOpenDrawer,
  onPresent,
  onRenamePresentation,
  openCommentCount,
  pendingAgentChanges,
  snapshot,
  webMcpAvailable,
  workspaceId,
}: {
  activeDrawer: DrawerKind | null;
  canExport: boolean;
  menuEpoch: number;
  onExport: () => void;
  onOpenDrawer: (drawer: DrawerKind) => void;
  onPresent: () => void;
  onRenamePresentation: (title: string, expectedTitle: string) => void | Promise<void>;
  openCommentCount: number;
  pendingAgentChanges: number;
  snapshot: PresentationSnapshot;
  webMcpAvailable: boolean;
  workspaceId: string;
}) {
  const revision = snapshot.presentation.revision;
  const savedTooltip = 'This project is saved. Reopening it restores this revision.';
  const webMcpTooltip = webMcpAvailable
    ? 'WebMCP is available: an external agent can connect to this artifact.'
    : 'WebMCP is unavailable in this browser, so no external agent can connect here.';
  const agentTooltip =
    pendingAgentChanges > 0
      ? `Agent review · ${pendingAgentChanges} agent change set${pendingAgentChanges === 1 ? '' : 's'}`
      : 'Agent review';
  const commentsTooltip =
    openCommentCount > 0
      ? `${openCommentCount} open comment${openCommentCount === 1 ? '' : 's'}`
      : 'Open comments';

  return (
    <header className="app-header">
      <Tooltip content="Open workspace">
        <Link aria-label="Open workspace" className="hdr-mark" to={workspacePath(workspaceId)}>
          C
        </Link>
      </Tooltip>
      <div className="hdr-divider" aria-hidden="true" />
      <div className="hdr-crumb">
        <PresentationTitleEditor
          onRename={onRenamePresentation}
          title={snapshot.presentation.title}
        />
      </div>

      <div className="hdr-actions">
        <Tooltip content={savedTooltip}>
          <span className="hchip">Saved · rev {revision}</span>
        </Tooltip>
        <Tooltip content={webMcpTooltip}>
          <span className={`hchip${webMcpAvailable ? ' is-live' : ''}`}>
            <span aria-hidden="true" className="hdot" />
            WebMCP {webMcpAvailable ? 'ready' : 'unavailable'}
          </span>
        </Tooltip>
        <div className="hdr-divider" aria-hidden="true" />
        <Tooltip content="Present this deck full screen">
          <button className="hbutton" onClick={onPresent} type="button">
            Present
          </button>
        </Tooltip>
        <Tooltip content="Download the current presentation as a PowerPoint file" wrapDisabled={!canExport}>
          <button
            aria-label="Export the presentation as PowerPoint"
            className="hbutton is-brand"
            disabled={!canExport}
            onClick={onExport}
            type="button"
          >
            Export .pptx
          </button>
        </Tooltip>
        <div className="hdr-review-inline">
          <Tooltip content={agentTooltip}>
            <button
              aria-pressed={activeDrawer === 'agent'}
              className={`hbutton${activeDrawer === 'agent' ? ' is-on' : ''}${pendingAgentChanges > 0 ? ' has-dot' : ''}`}
              onClick={() => onOpenDrawer('agent')}
              type="button"
            >
              Agent
            </button>
          </Tooltip>
          <Tooltip content={commentsTooltip}>
            <button
              aria-pressed={activeDrawer === 'comments'}
              className={`hbutton${activeDrawer === 'comments' ? ' is-on' : ''}`}
              onClick={() => onOpenDrawer('comments')}
              type="button"
            >
              Comments{openCommentCount > 0 ? ` (${openCommentCount})` : ''}
            </button>
          </Tooltip>
          <Tooltip content="Review the change history">
            <button
              aria-pressed={activeDrawer === 'activity'}
              className={`hbutton${activeDrawer === 'activity' ? ' is-on' : ''}`}
              onClick={() => onOpenDrawer('activity')}
              type="button"
            >
              Activity
            </button>
          </Tooltip>
        </div>
        <div className="hdr-review">
          <ReviewMenu
            activeDrawer={activeDrawer}
            menuEpoch={menuEpoch}
            onOpenDrawer={onOpenDrawer}
            openCommentCount={openCommentCount}
            pendingAgentChanges={pendingAgentChanges}
          />
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}

/**
 * Click-to-edit presentation title. The draft is local; the only write is
 * `onRename` with the title that was showing when the session began.
 * Enter and blur commit; Escape cancels; an unchanged or whitespace-only
 * draft does not dispatch. An active input is `editable` for the workspace
 * keyboard owner, so ordinary editor shortcuts including Mod+K do not fire
 * while renaming.
 */
function PresentationTitleEditor({
  onRename,
  title,
}: {
  onRename: (title: string, expectedTitle: string) => void | Promise<void>;
  title: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const expectedTitleRef = useRef<string | null>(null);
  const restoreButtonFocusRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!editing) {
      if (restoreButtonFocusRef.current) {
        restoreButtonFocusRef.current = false;
        buttonRef.current?.focus();
      }
      return;
    }
    const input = inputRef.current;
    if (!input) {
      return;
    }
    input.focus();
    input.select();
  }, [editing]);

  function beginEditing(): void {
    expectedTitleRef.current = title;
    setDraft(title);
    setEditing(true);
  }

  function endEditing(commit: boolean): void {
    const expectedTitle = expectedTitleRef.current;
    if (expectedTitle === null) {
      return;
    }
    expectedTitleRef.current = null;
    const next = draft.trim();
    setEditing(false);
    if (commit && next !== '' && next !== expectedTitle) {
      void onRename(next, expectedTitle);
    }
  }

  function commitFromKeyboard(): void {
    restoreButtonFocusRef.current = true;
    endEditing(true);
  }

  function cancelFromKeyboard(): void {
    restoreButtonFocusRef.current = true;
    endEditing(false);
  }

  if (editing) {
    return (
      <div className="hdr-title is-editing">
        <input
          aria-label="Presentation title"
          autoComplete="off"
          className="hdr-title-input"
          maxLength={MAX_PRESENTATION_TITLE_LENGTH}
          onBlur={() => endEditing(true)}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitFromKeyboard();
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              cancelFromKeyboard();
            }
          }}
          ref={inputRef}
          size={Math.max(draft.length, 8)}
          value={draft}
        />
      </div>
    );
  }

  return (
    <div className="hdr-title">
      <Tooltip content={title}>
        <button
          aria-label={`Rename presentation: ${title}`}
          className="hdr-title-button"
          onClick={beginEditing}
          ref={buttonRef}
          type="button"
        >
          {title}
        </button>
      </Tooltip>
    </div>
  );
}

function ReviewMenu({
  activeDrawer,
  menuEpoch,
  onOpenDrawer,
  openCommentCount,
  pendingAgentChanges,
}: {
  activeDrawer: DrawerKind | null;
  menuEpoch: number;
  onOpenDrawer: (drawer: DrawerKind) => void;
  openCommentCount: number;
  pendingAgentChanges: number;
}) {
  const reviewOpen = activeDrawer !== null;
  const [open, setOpen] = useState(false);
  const [seenEpoch, setSeenEpoch] = useState(menuEpoch);
  if (seenEpoch !== menuEpoch) {
    setSeenEpoch(menuEpoch);
    setOpen(false);
  }
  return (
    <Menu.Root onOpenChange={setOpen} open={open}>
      <Tooltip content="Review panels">
        <Menu.Trigger
          aria-label="Review panels"
          className={`hbutton${reviewOpen ? ' is-on' : ''}${pendingAgentChanges > 0 ? ' has-dot' : ''}`}
          render={<button type="button" />}
        >
          Review
        </Menu.Trigger>
      </Tooltip>
      <Menu.Portal>
        <Menu.Positioner className="popup-positioner" align="end" sideOffset={4}>
          <Menu.Popup className="bar-menu">
            <Menu.Item
              className={`bar-menu-item${activeDrawer === 'agent' ? ' is-active' : ''}`}
              onClick={() => onOpenDrawer('agent')}
            >
              <CommandIcon className="bar-menu-icon" icon="agent" />
              <span>Agent{pendingAgentChanges > 0 ? ` (${pendingAgentChanges})` : ''}</span>
            </Menu.Item>
            <Menu.Item
              className={`bar-menu-item${activeDrawer === 'comments' ? ' is-active' : ''}`}
              onClick={() => onOpenDrawer('comments')}
            >
              <CommandIcon className="bar-menu-icon" icon="comment" />
              <span>Comments{openCommentCount > 0 ? ` (${openCommentCount})` : ''}</span>
            </Menu.Item>
            <Menu.Item
              className={`bar-menu-item${activeDrawer === 'activity' ? ' is-active' : ''}`}
              onClick={() => onOpenDrawer('activity')}
            >
              <CommandIcon className="bar-menu-icon" icon="activity" />
              <span>Activity</span>
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
