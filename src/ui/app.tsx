import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import { useNavigate, useParams } from 'react-router';
import { Button } from '../components/ui/button';
import { Tooltip } from '../components/ui/tooltip';
import type {
  ChangeSet,
  Frame,
  PresentationElement,
  ShapeElement,
  TextElement,
} from '../domain/model';
import {
  actors,
  PresentationStore,
  type PresentationSnapshot,
} from '../domain/presentation-store';
import { downloadPptx } from '../client/pptx-download';
import { useWebMcp } from '../webmcp/use-webmcp';

interface DragState {
  elementId: string;
  frame: Frame;
  pointer: { x: number; y: number };
}

function usePresentation(store: PresentationStore): PresentationSnapshot {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}

function frameStyle(frame: Frame): CSSProperties {
  return {
    left: `${(frame.x / 960) * 100}%`,
    top: `${(frame.y / 540) * 100}%`,
    width: `${(frame.width / 960) * 100}%`,
    height: `${(frame.height / 540) * 100}%`,
  };
}

function visibleFrame(element: PresentationElement, drag: DragState | null): Frame {
  return drag?.elementId === element.id ? drag.frame : element.frame;
}

function slideTitle(snapshot: PresentationSnapshot, slideId: string): string {
  const slide = snapshot.presentation.slides[slideId];
  const title = slide.elementOrder
    .map((elementId) => slide.elements[elementId])
    .find((element) => element.name === 'Title');
  return title?.kind === 'text' ? title.text.replace('\n', ' ') : slide.name;
}

function formatChangeTime(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(date);
}

function TextArtwork({
  element,
  selected,
  frame,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  element: TextElement;
  frame: Frame;
  onPointerDown?: (event: PointerEvent<HTMLDivElement>, element: PresentationElement) => void;
  onPointerMove?: (event: PointerEvent<HTMLDivElement>, element: PresentationElement) => void;
  onPointerUp?: (event: PointerEvent<HTMLDivElement>, element: PresentationElement) => void;
  selected?: boolean;
}) {
  const { style } = element;
  return (
    <div
      aria-label={element.name}
      className={`slide-element text-element${selected ? ' is-selected' : ''}`}
      data-element-id={element.id}
      onPointerDown={onPointerDown ? (event) => onPointerDown(event, element) : undefined}
      onPointerMove={onPointerMove ? (event) => onPointerMove(event, element) : undefined}
      onPointerUp={onPointerUp ? (event) => onPointerUp(event, element) : undefined}
      style={{
        ...frameStyle(frame),
        color: style.color,
        fontFamily: style.fontFamily,
        fontSize: `${style.fontSize / 10}cqw`,
        fontWeight: style.fontWeight,
        letterSpacing: style.letterSpacing ? `${style.letterSpacing / 10}cqw` : undefined,
        lineHeight: style.lineHeight,
        textAlign: style.align,
        textTransform: style.textTransform,
      }}
    >
      {element.text}
    </div>
  );
}

function ShapeArtwork({
  element,
  selected,
  frame,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  element: ShapeElement;
  frame: Frame;
  onPointerDown?: (event: PointerEvent<HTMLDivElement>, element: PresentationElement) => void;
  onPointerMove?: (event: PointerEvent<HTMLDivElement>, element: PresentationElement) => void;
  onPointerUp?: (event: PointerEvent<HTMLDivElement>, element: PresentationElement) => void;
  selected?: boolean;
}) {
  return (
    <div
      aria-label={element.name}
      className={`slide-element shape-element${selected ? ' is-selected' : ''}`}
      data-element-id={element.id}
      onPointerDown={onPointerDown ? (event) => onPointerDown(event, element) : undefined}
      onPointerMove={onPointerMove ? (event) => onPointerMove(event, element) : undefined}
      onPointerUp={onPointerUp ? (event) => onPointerUp(event, element) : undefined}
      style={{
        ...frameStyle(frame),
        background: element.fill,
        borderRadius: `${element.radius ?? 0}px`,
      }}
    />
  );
}

function SlideArtwork({
  snapshot,
  slideId,
  drag,
  interactive = false,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  drag?: DragState | null;
  interactive?: boolean;
  onPointerDown?: (event: PointerEvent<HTMLDivElement>, element: PresentationElement) => void;
  onPointerMove?: (event: PointerEvent<HTMLDivElement>, element: PresentationElement) => void;
  onPointerUp?: (event: PointerEvent<HTMLDivElement>, element: PresentationElement) => void;
  slideId: string;
  snapshot: PresentationSnapshot;
}) {
  const slide = snapshot.presentation.slides[slideId];
  const selectedElementId = interactive ? snapshot.session.selectedElementId : undefined;
  return (
    <div className="slide-artwork" style={{ background: slide.background }}>
      {slide.elementOrder.map((elementId) => {
        const element = slide.elements[elementId];
        const frame = visibleFrame(element, drag ?? null);
        const handlers = interactive
          ? { onPointerDown, onPointerMove, onPointerUp }
          : { onPointerDown: undefined, onPointerMove: undefined, onPointerUp: undefined };
        return element.kind === 'text' ? (
          <TextArtwork
            element={element}
            frame={frame}
            key={element.id}
            selected={selectedElementId === element.id}
            {...handlers}
          />
        ) : (
          <ShapeArtwork
            element={element}
            frame={frame}
            key={element.id}
            selected={selectedElementId === element.id}
            {...handlers}
          />
        );
      })}
    </div>
  );
}

function AgentMark() {
  return (
    <span className="agent-mark" aria-hidden="true">
      ✦
    </span>
  );
}

function demoOperations() {
  return [
    {
      type: 'create_element' as const,
      slideId: 'slide-gap',
      element: {
        id: 'gap-agent-card',
        kind: 'shape' as const,
        name: 'Agent context card',
        frame: { x: 680, y: 122, width: 167, height: 170 },
        fill: '#ec6f42',
        radius: 20,
      },
    },
    {
      type: 'create_element' as const,
      slideId: 'slide-gap',
      element: {
        id: 'gap-agent-card-copy',
        kind: 'text' as const,
        name: 'Agent context card copy',
        frame: { x: 702, y: 149, width: 122, height: 110 },
        text: 'AGENT\nENTERS\nHERE',
        style: {
          color: '#1d1d18',
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize: 18,
          fontWeight: 700 as const,
          letterSpacing: 1,
          lineHeight: 1.05,
        },
      },
    },
    {
      type: 'create_element' as const,
      slideId: 'slide-system',
      element: {
        id: 'system-state-card',
        kind: 'shape' as const,
        name: 'Shared state card',
        frame: { x: 527, y: 322, width: 295, height: 93 },
        fill: '#1d1d18',
        radius: 14,
      },
    },
    {
      type: 'create_element' as const,
      slideId: 'slide-system',
      element: {
        id: 'system-state-card-copy',
        kind: 'text' as const,
        name: 'Shared state card copy',
        frame: { x: 550, y: 346, width: 248, height: 48 },
        text: 'The latest edit\nis the brief.',
        style: {
          color: '#f8f2e8',
          fontFamily: 'Fraunces, Georgia, serif',
          fontSize: 25,
          fontWeight: 600 as const,
          letterSpacing: -0.8,
          lineHeight: 1.05,
        },
      },
    },
    {
      type: 'add_comment' as const,
      comment: {
        id: 'comment-pricing',
        actor: actors.agent,
        body: 'I used the shared-state principle here. Should this become the final closing line?',
        createdAt: new Date().toISOString(),
        resolved: false,
        slideId: 'slide-system',
      },
    },
  ];
}

export function PresentationWorkspace() {
  const storeRef = useRef<PresentationStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = new PresentationStore();
  }

  return <Workspace store={storeRef.current} />;
}

function Workspace({ store }: { store: PresentationStore }) {
  const snapshot = usePresentation(store);
  const webMcpAvailable = useWebMcp(store);
  const navigate = useNavigate();
  const { slideId } = useParams();
  const [drag, setDrag] = useState<DragState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const activeSlideId =
    slideId && snapshot.presentation.slides[slideId] ? slideId : snapshot.session.activeSlideId;
  const activeSlide = snapshot.presentation.slides[activeSlideId];
  const selectedElement = snapshot.session.selectedElementId
    ? activeSlide.elements[snapshot.session.selectedElementId]
    : undefined;
  const changeSets = snapshot.changeSetOrder
    .map((id) => snapshot.changeSets[id])
    .filter((changeSet): changeSet is ChangeSet => Boolean(changeSet));
  const latestAgentChange = [...changeSets]
    .reverse()
    .find((changeSet) => changeSet.actor.kind === 'agent' && !changeSet.revertedAt);
  const comments = Object.values(snapshot.comments).filter((comment) => !comment.resolved);

  useEffect(() => {
    if (activeSlideId !== snapshot.session.activeSlideId) {
      store.selectSlide(activeSlideId);
    }
    if (slideId !== activeSlideId) {
      navigate(
        `/workspace/webmcp-launch/presentation/${snapshot.presentation.id}/slide/${activeSlideId}`,
        { replace: true },
      );
    }
  }, [activeSlideId, navigate, slideId, snapshot.presentation.id, snapshot.session.activeSlideId, store]);

  function openSlide(nextSlideId: string): void {
    store.selectSlide(nextSlideId);
    navigate(`/workspace/webmcp-launch/presentation/${snapshot.presentation.id}/slide/${nextSlideId}`);
  }

  function showToast(message: string): void {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>, element: PresentationElement): void {
    if (element.locked) {
      return;
    }
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    store.selectElement(element.id);
    setDrag({
      elementId: element.id,
      frame: { ...element.frame },
      pointer: { x: event.clientX, y: event.clientY },
    });
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>, element: PresentationElement): void {
    if (!drag || drag.elementId !== element.id || !canvasRef.current) {
      return;
    }
    const bounds = canvasRef.current.getBoundingClientRect();
    const horizontalDelta = ((event.clientX - drag.pointer.x) / bounds.width) * 960;
    const verticalDelta = ((event.clientY - drag.pointer.y) / bounds.height) * 540;
    const frame = {
      ...drag.frame,
      x: Math.min(960 - drag.frame.width, Math.max(0, Math.round(drag.frame.x + horizontalDelta))),
      y: Math.min(540 - drag.frame.height, Math.max(0, Math.round(drag.frame.y + verticalDelta))),
    };
    setDrag({ ...drag, frame });
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>, element: PresentationElement): void {
    if (!drag || drag.elementId !== element.id) {
      return;
    }
    event.currentTarget.releasePointerCapture(event.pointerId);
    const changed =
      drag.frame.x !== element.frame.x ||
      drag.frame.y !== element.frame.y ||
      drag.frame.width !== element.frame.width ||
      drag.frame.height !== element.frame.height;
    if (changed) {
      store.dispatch({
        actor: actors.human,
        label: `Moved ${element.name}`,
        operations: [
          {
            type: 'update_frame',
            slideId: activeSlide.id,
            elementId: element.id,
            frame: drag.frame,
            expectedFrame: element.frame,
          },
        ],
      });
    }
    setDrag(null);
  }

  function runDemoAgent(): void {
    const result = store.dispatch({
      actor: actors.agent,
      label: 'Built the co-work bridge',
      operations: demoOperations(),
    });
    showToast(result.ok ? 'GPT added five visible, reviewable changes.' : 'That change needs review before it can be applied.');
  }

  function revertAgentChange(): void {
    if (!latestAgentChange) {
      return;
    }
    const reverted = store.revertAgentChange(latestAgentChange.id);
    showToast(
      reverted
        ? 'The agent change set was reverted.'
        : 'The artifact changed after this proposal. Review it before reverting.',
    );
  }

  function undoHumanChange(): void {
    const undone = store.undoLatestHumanChange();
    showToast(undone ? 'Your latest move was undone.' : 'There is no safe human change to undo.');
  }

  function exportPresentation(): void {
    try {
      downloadPptx(snapshot.presentation);
      showToast('Your editable PowerPoint file is downloading.');
    } catch {
      showToast('The presentation could not be exported. Please try again.');
    }
  }

  function updateSelectedText(value: string): void {
    if (!selectedElement || selectedElement.kind !== 'text' || value === selectedElement.text) {
      return;
    }
    const result = store.dispatch({
      actor: actors.human,
      label: `Edited ${selectedElement.name}`,
      operations: [
        {
          type: 'update_text',
          slideId: activeSlide.id,
          elementId: selectedElement.id,
          text: value,
          expectedText: selectedElement.text,
        },
      ],
    });
    if (!result.ok) {
      showToast('That edit needs review before it can be applied.');
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-symbol">C</div>
          <div>
            <div className="brand-name">COMAKE</div>
            <div className="brand-sentence">a desk for two minds</div>
          </div>
        </div>
        <div className="deck-identity">
          <span className="eyebrow">WORKSPACE / WEBMCP LAUNCH</span>
          <strong>{snapshot.presentation.title}</strong>
        </div>
        <div className="topbar-actions">
          <div className={`mcp-status${webMcpAvailable ? ' is-live' : ''}`}>
            <span className="status-dot" />
            {webMcpAvailable ? 'WEBMCP LIVE' : 'DEMO MODE'}
          </div>
          <Button className="quiet-button" onClick={undoHumanChange} type="button" variant="ghost">
            Undo my move
          </Button>
          <Tooltip content="Download the current canonical artifact as PowerPoint">
            <Button className="export-button" onClick={exportPresentation} type="button" variant="default">
            Export .pptx <span>↗</span>
            </Button>
          </Tooltip>
        </div>
      </header>

      <section className="workspace-grid">
        <aside className="left-rail">
          <div className="project-heading">
            <div>
              <span className="eyebrow">PROJECT</span>
              <strong>WebMCP launch</strong>
            </div>
          </div>
          <nav aria-label="Project artifacts" className="artifact-list">
            <div className="artifact-item">
              <span className="artifact-icon document-icon">≡</span>
              <span>Product brief.doc</span>
            </div>
            <div className="artifact-item is-active">
              <span className="artifact-icon deck-icon">▤</span>
              <span>Launch deck.pptx</span>
              <span className="artifact-live">LIVE</span>
            </div>
            <div className="artifact-item">
              <span className="artifact-icon document-icon">≡</span>
              <span>Research notes.doc</span>
            </div>
          </nav>

          <div className="rail-divider" />
          <div className="slides-heading">
            <span className="eyebrow">SLIDES</span>
            <span>{snapshot.presentation.slideOrder.length}</span>
          </div>
          <div className="slide-list">
            {snapshot.presentation.slideOrder.map((slideId, index) => {
              const isActive = slideId === activeSlide.id;
              return (
                <button
                  className={`slide-thumbnail${isActive ? ' is-active' : ''}`}
                  key={slideId}
                  onClick={() => openSlide(slideId)}
                  type="button"
                >
                  <span className="thumbnail-number">{String(index + 1).padStart(2, '0')}</span>
                  <div className="thumbnail-preview">
                    <SlideArtwork slideId={slideId} snapshot={snapshot} />
                  </div>
                  {slideId === 'slide-gap' && latestAgentChange ? <AgentMark /> : null}
                </button>
              );
            })}
          </div>
          <div className="rail-footer">
            <div className="collaborator-stack" aria-label="Collaborators">
              <span className="avatar avatar-j">J</span>
              <span className="avatar avatar-g">✦</span>
            </div>
            <span>2 minds in this artifact</span>
          </div>
        </aside>

        <section className="editor-area">
          <div className="canvas-toolbar">
            <div className="tool-group">
              <span className="tool-button is-active">Select</span>
              <span className="tool-button">Text</span>
              <span className="tool-button">Shape</span>
            </div>
            <div className="slide-name">
              <span>SLIDE {snapshot.presentation.slideOrder.indexOf(activeSlide.id) + 1}</span>
              <strong>{activeSlide.name}</strong>
            </div>
            <div className="zoom-readout">100%</div>
          </div>
          <div
            className="canvas-stage"
            onPointerDown={() => store.selectElement(undefined)}
          >
            <div className="canvas-caption top-left">960 × 540 / CANONICAL</div>
            <div className="canvas-caption bottom-right">REV {String(snapshot.presentation.revision).padStart(3, '0')}</div>
            <div className="slide-frame" ref={canvasRef}>
              <SlideArtwork
                drag={drag}
                interactive
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                slideId={activeSlide.id}
                snapshot={snapshot}
              />
            </div>
            <div className="canvas-hint">Drag any element. Your move becomes the agent’s latest context.</div>
          </div>
        </section>

        <aside className="right-rail">
          <div className="agent-panel">
            <div className="agent-heading">
              <div className="agent-avatar-large">
                <AgentMark />
              </div>
              <div>
                <span className="eyebrow">COLLABORATOR</span>
                <strong>GPT is in the room</strong>
              </div>
              <span className="presence-pill">seeing live state</span>
            </div>
            <p>
              It can inspect this artifact, make atomic edits, leave comments, and export the same deck
              you are editing.
            </p>
            <Button className="agent-action" onClick={runDemoAgent} type="button" variant="ember">
              <AgentMark />
              {latestAgentChange ? 'Add another agent pass' : 'Run the agent step'}
            </Button>
          </div>

          <section className="changes-panel">
            <div className="panel-title-row">
              <div>
                <span className="eyebrow">CHANGESET</span>
                <h2>What changed</h2>
              </div>
              <span className="change-count">{latestAgentChange ? latestAgentChange.operations.length : 0}</span>
            </div>
            {latestAgentChange ? (
              <div className="change-card">
                <div className="change-card-heading">
                  <div>
                    <span className="actor-line">
                      <AgentMark /> GPT made {latestAgentChange.operations.length} changes
                    </span>
                    <strong>{latestAgentChange.label}</strong>
                  </div>
                  <time>{formatChangeTime(latestAgentChange.createdAt)}</time>
                </div>
                <ul className="operation-list">
                  {latestAgentChange.operations.map((operation, index) => (
                    <li key={`${operation.type}-${index}`}>
                      <span className="operation-symbol">{operation.type === 'add_comment' ? '•' : '+'}</span>
                      {operation.type === 'add_comment'
                        ? 'Left a question for review'
                        : operation.type === 'create_element'
                          ? `Added ${operation.element.name}`
                          : operation.type.replaceAll('_', ' ')}
                    </li>
                  ))}
                </ul>
                <Button className="revert-button" onClick={revertAgentChange} type="button" variant="outline">
                  Revert this set
                </Button>
              </div>
            ) : (
              <div className="empty-change-state">
                <AgentMark />
                <p>No agent changes yet.</p>
                <span>The canvas is ready for a teammate.</span>
              </div>
            )}
          </section>

          <section className="inspector-panel">
            <div className="panel-title-row compact">
              <div>
                <span className="eyebrow">INSPECTOR</span>
                <h2>{selectedElement ? selectedElement.name : 'Nothing selected'}</h2>
              </div>
              {selectedElement ? <span className="element-kind">{selectedElement.kind}</span> : null}
            </div>
            {selectedElement?.kind === 'text' ? (
              <label className="text-editor-field">
                <span>CONTENT</span>
                <textarea
                  defaultValue={selectedElement.text}
                  key={selectedElement.id + selectedElement.text}
                  onBlur={(event) => updateSelectedText(event.target.value)}
                  rows={4}
                />
              </label>
            ) : selectedElement ? (
              <div className="shape-inspector">
                <div className="color-swatch" style={{ background: selectedElement.fill }} />
                <span>Shape on the shared canvas</span>
              </div>
            ) : (
              <p className="inspector-empty">Select a word, card, or shape to make a human edit.</p>
            )}
            {selectedElement ? (
              <div className="frame-values">
                <span>X {Math.round(selectedElement.frame.x)}</span>
                <span>Y {Math.round(selectedElement.frame.y)}</span>
                <span>W {Math.round(selectedElement.frame.width)}</span>
                <span>H {Math.round(selectedElement.frame.height)}</span>
              </div>
            ) : null}
          </section>

          <section className="comments-panel">
            <div className="panel-title-row compact">
              <div>
                <span className="eyebrow">COMMENTS</span>
                <h2>{comments.length} open</h2>
              </div>
            </div>
            {comments.length > 0 ? (
              comments.map((comment) => (
                <div className="comment-card" key={comment.id}>
                  <span className="comment-author">
                    <AgentMark /> {comment.actor.name}
                  </span>
                  <p>{comment.body}</p>
                  <button onClick={() => openSlide(comment.slideId)} type="button">
                    Go to {slideTitle(snapshot, comment.slideId)} →
                  </button>
                </div>
              ))
            ) : (
              <p className="comments-empty">Questions from your agent will stay attached to the artifact.</p>
            )}
          </section>
        </aside>
      </section>
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </main>
  );
}
