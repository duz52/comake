import { useState } from 'react';
import type { PresentationSnapshot } from '../../lib/presentation/store';
import type { Comment } from '../../types/presentation';
import { AgentMark } from './agent-mark';
import { slideDisplayName } from './slide-label';

function formatCommentTime(value: string): string {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(
    new Date(value),
  );
}

/**
 * Comments stay attached to the artifact: agent notes (written through the
 * WebMCP contract) and human notes for the agent share the same list, each
 * with a real jump-to-slide and resolve action.
 */
export function CommentsPanel({
  onAddComment,
  onOpenComment,
  onResolveComment,
  snapshot,
}: {
  onAddComment: (body: string) => Promise<boolean>;
  onOpenComment: (comment: Comment) => void;
  onResolveComment: (comment: Comment) => void;
  snapshot: PresentationSnapshot;
}) {
  const [draft, setDraft] = useState('');
  const comments = Object.values(snapshot.comments).sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
  const openComments = comments.filter((comment) => !comment.resolved);

  async function submit(): Promise<void> {
    const body = draft.trim();
    if (!body) {
      return;
    }
    if (await onAddComment(body)) {
      setDraft('');
    }
  }

  return (
    <>
      <section className="drawer-section">
        <span className="dsection-label">Add a note</span>
        <div className="composer">
          <textarea
            aria-label="Note for your agent"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder="A note for your agent…"
            value={draft}
          />
          <div className="composer-foot">
            <button disabled={draft.trim().length === 0} onClick={() => void submit()} type="button">
              Add note
            </button>
          </div>
        </div>
      </section>

      <section className="drawer-section">
        <span className="dsection-label">
          Comments · {openComments.length} open of {comments.length}
        </span>
        {comments.length === 0 ? (
          <p className="drawer-empty">
            No comments yet. Agent notes arrive here when the agent is unsure or wants review; you can
            leave notes for it above.
          </p>
        ) : (
          comments.map((comment) => {
            const slide = snapshot.presentation.slides[comment.slideId];
            return (
              <article className={`comment-item${comment.resolved ? ' is-resolved' : ''}`} key={comment.id}>
                <div className="comment-head">
                  <span className={`comment-author${comment.actor.kind === 'human' ? ' human' : ''}`}>
                    {comment.actor.kind === 'agent' ? <AgentMark /> : <span aria-hidden="true">●</span>}
                    {comment.actor.name}
                  </span>
                  <time className="set-meta">{formatCommentTime(comment.createdAt)}</time>
                </div>
                <p className="comment-body">{comment.body}</p>
                <div className="comment-actions">
                  <button onClick={() => onOpenComment(comment)} type="button">
                    {comment.elementId ? 'Show on' : 'Go to'} {slideDisplayName(slide)} →
                  </button>
                  {comment.resolved ? (
                    <span className="set-tag is-reverted">resolved</span>
                  ) : (
                    <button onClick={() => onResolveComment(comment)} type="button">
                      Resolve
                    </button>
                  )}
                </div>
              </article>
            );
          })
        )}
      </section>
    </>
  );
}