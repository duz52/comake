import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import type { TextElement } from '../../types/presentation';

/**
 * The canvas inline text surface: an uncontrolled contenteditable that
 * preserves the element's canonical typography through style inheritance and
 * its line breaks through `white-space: pre-wrap`. Enter inserts a newline,
 * Cmd/Ctrl+Enter commits, Escape commits (Excalidraw/PowerPoint semantics —
 * the draft is kept, never reverted), and blur commits exactly once. IME
 * composition is tracked so Enter and Escape never split a composition.
 *
 * The session state (baseline, dirty, stale) lives in CanvasStage; this
 * component only owns the DOM surface and reports every draft change upward.
 */

interface InlineTextEditorProps {
  /** Caret anchor from the double-click that opened the session; null for keyboard sessions. */
  caretPoint: { clientX: number; clientY: number } | null;
  element: TextElement;
  /**
   * Commit the current draft. Returns true when the session may end (nothing
   * changed, or the guarded command applied); false keeps the session for a
   * stale/conflict review.
   */
  onCommit: (text: string) => boolean;
  onDraftChange: (text: string) => void;
}

export function InlineTextEditor({ caretPoint, element, onCommit, onDraftChange }: InlineTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const committedRef = useRef(false);

  // Seed the surface once with the canonical text; the DOM stays uncontrolled
  // afterwards so typing never resets the caret. A session is a fresh mount
  // (CanvasStage keys it), so this runs exactly once per session.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    editor.textContent = element.text;
    placeCaret(editor, caretPoint);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function commit(): void {
    if (committedRef.current) {
      return;
    }
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    if (onCommit(editor.textContent ?? '')) {
      committedRef.current = true;
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    // The editor owns every key while content is editing: no shell shortcut,
    // canvas nudge/delete, or command palette may react to the same event.
    event.stopPropagation();
    if (event.ctrlKey || event.metaKey) {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
      }
      return;
    }
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        if (!composingRef.current) {
          // Escape commits the draft (Excalidraw/PowerPoint semantics): the
          // text the user shaped is kept. A stale draft keeps the session
          // open for the conflict review instead of resolving it silently.
          commit();
        }
        return;
      case 'Enter':
        // The IME owns Enter while composing; once the composition ends, the
        // following input event reports the final text and Enter inserts a
        // clean newline.
        if (event.nativeEvent.isComposing || composingRef.current) {
          return;
        }
        event.preventDefault();
        if (editorRef.current) {
          insertLineBreak(editorRef.current);
        }
        return;
    }
  }

  function handleInput(): void {
    onDraftChange(editorRef.current?.textContent ?? '');
  }

  return (
    <div
      contentEditable
      className="inline-editor"
      onBlur={() => {
        if (!committedRef.current) {
          commit();
        }
      }}
      onCompositionEnd={() => {
        composingRef.current = false;
        onDraftChange(editorRef.current?.textContent ?? '');
      }}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        // The editor owns pointer input inside the surface: the element below
        // must never start a move/resize gesture from the same event.
        event.stopPropagation();
      }}
      ref={editorRef}
      spellCheck={false}
      suppressContentEditableWarning
    />
  );
}

/**
 * Insert a hard line break at the caret deterministically: the current
 * selection is replaced by a text node carrying exactly one '\n' and the
 * caret moves after it. The browser's default action was already prevented,
 * so the DOM change is fully owned here and the canonical text never gains
 * browser-specific `<br>`/`<div>` markup. A bubbling InputEvent reports the
 * change through the same input path as real typing, keeping the draft state
 * coherent with the DOM.
 */
function insertLineBreak(editor: HTMLElement): void {
  const selection = window.getSelection();
  let range: Range;
  if (
    selection &&
    selection.rangeCount > 0 &&
    editor.contains(selection.getRangeAt(0).startContainer)
  ) {
    range = selection.getRangeAt(0).cloneRange();
  } else {
    // No usable caret (the surface was never focused): append at the end.
    range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
  }
  range.deleteContents();
  const lineBreak = document.createTextNode('\n');
  range.insertNode(lineBreak);
  range.setStartAfter(lineBreak);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
  editor.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      composed: true,
      data: '\n',
      inputType: 'insertLineBreak',
    }),
  );
}

/** Place the caret at the double-click point when it lands inside the surface; otherwise at the end of the text. */
function placeCaret(editor: HTMLElement, caretPoint: { clientX: number; clientY: number } | null): void {
  if (caretPoint) {
    if (typeof document.caretRangeFromPoint === 'function') {
      const range = document.caretRangeFromPoint(caretPoint.clientX, caretPoint.clientY);
      if (range && editor.contains(range.startContainer)) {
        selectRange(editor, range);
        return;
      }
    } else if (typeof document.caretPositionFromPoint === 'function') {
      const position = document.caretPositionFromPoint(caretPoint.clientX, caretPoint.clientY);
      if (position) {
        const range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
        range.collapse(true);
        selectRange(editor, range);
        return;
      }
    }
  }
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  selectRange(editor, range);
}

function selectRange(editor: HTMLElement, range: Range): void {
  if (!editor.contains(range.startContainer)) {
    return;
  }
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  editor.focus();
}