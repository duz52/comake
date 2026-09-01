import type { PresentationSnapshot } from '../../lib/presentation/store';
import type { ChangeSet } from '../../types/presentation';

function formatChangeTime(value: string): string {
  return new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

/**
 * The attributed change history: every recent change set across actors, in
 * reverse order, with its operation count, revision, and revertible agent
 * sets. Human sets are undone through the Undo command instead.
 */
export function ActivityPanel({
  onRevertAgentChange,
  snapshot,
}: {
  onRevertAgentChange: (changeSet: ChangeSet) => void;
  snapshot: PresentationSnapshot;
}) {
  const changeSets = snapshot.changeSetOrder
    .map((id) => snapshot.changeSets[id])
    .filter((changeSet): changeSet is ChangeSet => Boolean(changeSet))
    .reverse();

  return (
    <section className="drawer-section">
      <span className="dsection-label">
        Change sets · {changeSets.length} recent
      </span>
      {changeSets.length === 0 ? (
        <p className="drawer-empty">No changes yet.</p>
      ) : (
        changeSets.map((changeSet) => (
          <div className={`set-row${changeSet.revertedAt ? ' is-reverted' : ''}`} key={changeSet.id}>
            <div className="set-head">
              <span className="set-label">{changeSet.label}</span>
              <time className="set-meta">{formatChangeTime(changeSet.createdAt)}</time>
            </div>
            <div className="set-sub">
              <span className={`set-actor is-${changeSet.actor.kind}`}>
                {changeSet.actor.name} · {changeSet.operations.length} operation
                {changeSet.operations.length === 1 ? '' : 's'}
              </span>
              <span className="set-tag">rev {changeSet.revision}</span>
              {changeSet.revertedAt ? <span className="set-tag is-reverted">reverted</span> : null}
            </div>
            {changeSet.actor.kind === 'agent' && !changeSet.revertedAt ? (
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
  );
}