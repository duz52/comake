/**
 * The concise editor status line: slide position, selection state, canvas
 * facts, and revision. Static facts only — transient feedback goes through
 * the live toast region.
 */
export function EditorStatusBar({
  revision,
  selectedCount,
  slideCount,
  slideName,
  slideNumber,
}: {
  revision: number;
  selectedCount: number;
  slideCount: number;
  slideName: string;
  slideNumber: number;
}) {
  const selectionText =
    selectedCount === 0
      ? 'Nothing selected'
      : selectedCount === 1
        ? '1 element selected'
        : `${selectedCount} elements selected`;

  return (
    <footer className="status-bar">
      <div className="status-group">
        <span>
          Slide <span className="status-strong">{slideNumber}</span>
          <span aria-hidden="true"> / </span>
          {slideCount} · {slideName}
        </span>
        <span className="status-sep" aria-hidden="true">·</span>
        <span>{selectionText}</span>
      </div>
      <div className="status-group">
        <span className="status-hint">⌘K commands · V/T/S tools · ⌘D duplicate · Del delete</span>
        <span className="status-sep" aria-hidden="true">·</span>
        <span aria-hidden="true">960 × 540 · 16:9</span>
        <span className="status-sep" aria-hidden="true">·</span>
        <span>Rev {revision}</span>
      </div>
    </footer>
  );
}