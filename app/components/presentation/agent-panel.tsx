import type { PresentationSnapshot } from '../../lib/presentation/store';
import type { ChangeSet } from '../../types/presentation';
import { AgentMark } from './agent-mark';
import { slideDisplayName } from './slide-label';

function formatChangeTime(value: string): string {
  return new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function operationCount(changeSet: ChangeSet): number {
  return changeSet.operations.length;
}

/**
 * The operational agent surface: WebMCP readiness, the exact human focus the
 * agent would act on, and the latest agent-attributed change sets with their
 * real revert actions. Never a chatbot; every claim maps to the native
 * WebMCP contract.
 */
export function AgentPanel({
  onRevertAgentChange,
  snapshot,
  webMcpAvailable,
}: {
  onRevertAgentChange: (changeSet: ChangeSet) => void;
  snapshot: PresentationSnapshot;
  webMcpAvailable: boolean;
}) {
  const { session } = snapshot;
  const activeSlide = snapshot.presentation.slides[session.activeSlideId];
  const selectedElement = session.selectedElementIds[0]
    ? activeSlide.elements[session.selectedElementIds[0]]
    : undefined;
  const selectionCount = session.selectedElementIds.length;

  const agentChangeSets = snapshot.changeSetOrder
    .map((id) => snapshot.changeSets[id])
    .filter((changeSet): changeSet is ChangeSet => Boolean(changeSet) && changeSet.actor.kind === 'agent')
    .reverse()
    .slice(0, 8);

  return (
    <>
      <section className="drawer-section">
        <span className="dsection-label">Connection</span>
        <div className={`agent-status-card${webMcpAvailable ? ' is-live' : ''}`}>
          <span className="agent-status-icon" aria-hidden="true">
            <AgentMark />
          </span>
          <div>
            <strong>{webMcpAvailable ? 'WebMCP ready' : 'WebMCP unavailable'}</strong>
            <span>
              {webMcpAvailable
                ? 'An external agent can connect to this artifact.'
                : 'No external agent can connect in this browser.'}
            </span>
          </div>
        </div>
      </section>

      <section className="drawer-section">
        <span className="dsection-label">Agent focus</span>
        <div className="focus-line">
          <strong>{slideDisplayName(activeSlide)}</strong>
          {selectedElement ? (
            <>
              <span aria-hidden="true">·</span>
              <span>
                {selectedElement.name} <span className="isection-tag">{selectedElement.kind}</span>
                {selectionCount > 1 ? <span className="isection-tag">+{selectionCount - 1} more</span> : null}
              </span>
            </>
          ) : (
            <span>· nothing selected</span>
          )}
        </div>
      </section>

      <section className="drawer-section">
        <span className="dsection-label">Agent changes</span>
        {agentChangeSets.length === 0 ? (
          <p className="drawer-empty">
            No agent changes yet.
            {webMcpAvailable ? ' The artifact is ready for an external WebMCP agent.' : ''}
          </p>
        ) : (
          agentChangeSets.map((changeSet) => (
            <div className={`set-row${changeSet.revertedAt ? ' is-reverted' : ''}`} key={changeSet.id}>
              <div className="set-head">
                <span className="set-label">{changeSet.label}</span>
                <time className="set-meta">{formatChangeTime(changeSet.createdAt)}</time>
              </div>
              <div className="set-sub">
                <span className="set-actor">
                  <AgentMark /> {changeSet.actor.name} · {operationCount(changeSet)} operation
                  {operationCount(changeSet) === 1 ? '' : 's'} · rev {changeSet.revision}
                </span>
                {changeSet.revertedAt ? <span className="set-tag is-reverted">reverted</span> : null}
              </div>
              {!changeSet.revertedAt ? (
                <div className="set-actions">
                  <button
                    className="quick-btn"
                    onClick={() => onRevertAgentChange(changeSet)}
                    title="Undo this agent change set as one atomic step"
                    type="button"
                  >
                    Revert this set
                  </button>
                </div>
              ) : null}
            </div>
          ))
        )}
      </section>
    </>
  );
}