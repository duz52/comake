import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { PresentationStore, PresentationSnapshot } from '../../lib/presentation/store';
import { effectiveCornerRadius, shapeStyleMatches } from '../../lib/presentation/document';
import type {
  Frame,
  PresentationElement,
  ShapeElement,
  ShapeFill,
  ShapeGeometry,
  ShapeStyle,
  ShapeStroke,
  Slide,
  StrokeDash,
  TextElement,
  TextStyle,
} from '../../types/presentation';
import {
  updateFrameElements,
  updateShapeStyle,
  updateSlideProperties,
  updateText,
  updateTextStyle,
  type CommandEnv,
  type SlidePropertiesPatch,
} from './commands';
import { clamp, frameFieldBounds, framesEqual } from './gesture';
import {
  opacityToPercent,
  percentToOpacity,
  SHAPE_GEOMETRY_OPTIONS,
  STROKE_DASH_OPTIONS,
  switchGeometryTo,
} from './shape-style-utils';
import { slideDisplayName } from './slide-label';

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const BLACK_FALLBACK_HEX = '#000000';
/** The accent every new element paints with; the seed for a revealed paint. */
const DEFAULT_PAINT_HEX = '#ec6f42';

const FONT_FAMILIES = [
  'Manrope, sans-serif',
  'Fraunces, Georgia, serif',
  'IBM Plex Mono, monospace',
  'Inter, sans-serif',
  'Georgia, serif',
] as const;

const FONT_WEIGHTS: ReadonlyArray<400 | 500 | 600 | 700 | 800> = [400, 500, 600, 700, 800];

/**
 * The contextual inspector. With no selection it shows slide properties and
 * slide quick actions; with a selection it shows content, typography or
 * appearance, and position/size.
 *
 * Draft ownership: every field drafts locally and commits one attributed
 * change on blur or Enter. A dirty draft never overwrites a canonical change
 * that landed elsewhere — it compares against the canonical value captured
 * when editing began, surfaces a review state with "Use latest" when that
 * value changed, and commits stay optimistically guarded so a conflict is
 * rejected, never clobbered.
 */
export function InspectorPanel({
  notify,
  primaryId,
  selectedIds,
  slideId,
  snapshot,
  store,
}: {
  notify: (message: string) => void;
  primaryId?: string;
  selectedIds: readonly string[];
  slideId: string;
  snapshot: PresentationSnapshot;
  store: PresentationStore;
}) {
  const slide = snapshot.presentation.slides[slideId];
  const selectedElement = primaryId ? slide.elements[primaryId] : undefined;
  const env: CommandEnv = { slideId, snapshot, store };

  function commitText(element: TextElement, text: string): boolean {
    const result = updateText(env, element, text);
    if (!result.ok) {
      notify(result.notice);
    }
    return result.ok;
  }

  function commitFrame(element: PresentationElement, frame: Frame): boolean {
    if (framesEqual(frame, element.frame)) {
      return true;
    }
    const moved = frame.x !== element.frame.x || frame.y !== element.frame.y;
    const resized = frame.width !== element.frame.width || frame.height !== element.frame.height;
    const label =
      moved && resized ? `Updated ${element.name}` : moved ? `Moved ${element.name}` : `Resized ${element.name}`;
    const result = updateFrameElements(env, label, [
      { elementId: element.id, expected: element.frame, next: frame },
    ]);
    if (!result.ok) {
      notify(result.notice);
    }
    return result.ok;
  }

  function commitShapeStyle(element: ShapeElement, style: ShapeStyle): boolean {
    const result = updateShapeStyle(env, element, style);
    if (!result.ok) {
      notify(result.notice);
    }
    return result.ok;
  }

  function commitTextStyle(element: TextElement, style: TextStyle): boolean {
    const result = updateTextStyle(env, element, style);
    if (!result.ok) {
      notify(result.notice);
    }
    return result.ok;
  }

  function commitSlideProperties(slide: Slide, patch: SlidePropertiesPatch): boolean {
    const result = updateSlideProperties(env, slide, patch);
    if (!result.ok) {
      notify(result.notice);
    }
    return result.ok;
  }

  return (
    <aside aria-label="Inspector" className="inspector-panel">
      <div className="inspector-headline">
        {selectedElement ? (
          <>
            <strong>{selectedElement.name}</strong>
            <span className="isection-tag">{selectedElement.kind}</span>
            {selectedElement.locked ? <span className="isection-tag">locked</span> : null}
          </>
        ) : (
          <strong>{slideDisplayName(slide)}</strong>
        )}
      </div>
      <div className="inspector-scroll">
        {selectedIds.length === 0 ? (
          <SlideProperties env={env} onCommit={commitSlideProperties} slide={slide} />
        ) : null}

        {selectedIds.length > 1 && selectedElement ? (
          <section className="inspector-section">
            <div className="isection-head">
              <span className="isection-label">Selection</span>
              <span className="isection-tag">{selectedIds.length} elements</span>
            </div>
            <p className="multi-note">Editing the active element below; the rest stay selected.</p>
          </section>
        ) : null}

        {selectedElement?.kind === 'text' ? (
          <>
            <section className="inspector-section">
              <div className="isection-head">
                <span className="isection-label">Text</span>
              </div>
              <TextContentField
                disabled={selectedElement.locked === true}
                element={selectedElement}
                key={selectedElement.id}
                onCommit={(text) => commitText(selectedElement, text)}
              />
            </section>
            <TypographySection
              element={selectedElement}
              key={selectedElement.id}
              onCommit={(style) => commitTextStyle(selectedElement, style)}
            />
          </>
        ) : null}

        {selectedElement?.kind === 'shape' ? (
          <section className="inspector-section">
            <div className="isection-head">
              <span className="isection-label">Appearance</span>
            </div>
            <ShapeStyleFields
              element={selectedElement}
              key={selectedElement.id}
              onCommit={(style) => commitShapeStyle(selectedElement, style)}
            />
          </section>
        ) : null}

        {selectedElement ? (
          <section className="inspector-section">
            <div className="isection-head">
              <span className="isection-label">Position &amp; size</span>
            </div>
            <FrameFields
              disabled={selectedElement.locked === true}
              element={selectedElement}
              key={selectedElement.id}
              onCommit={(frame) => commitFrame(selectedElement, frame)}
            />
            {selectedElement.locked ? (
              <p className="locked-note">This element is locked; it cannot be edited, moved, or deleted.</p>
            ) : null}
          </section>
        ) : null}
      </div>
    </aside>
  );
}

// --- Shared pieces -----------------------------------------------------------------

function ReviewBar({ onUseLatest }: { onUseLatest: () => void }) {
  return (
    <div className="draft-review">
      <span>Updated elsewhere — review before saving.</span>
      <button
        // The mousedown default would blur the focused field and commit its
        // draft first, overwriting the change this review is warning about —
        // exactly what "Use latest" is meant to discard. Suppress it so the
        // click alone adopts the canonical values.
        onMouseDown={(event) => event.preventDefault()}
        onClick={onUseLatest}
        type="button"
      >
        Use latest
      </button>
    </div>
  );
}

// --- Slide properties (no selection) -------------------------------------------------

function SlideProperties({
  env,
  onCommit,
  slide,
}: {
  env: CommandEnv;
  onCommit: (slide: Slide, patch: SlidePropertiesPatch) => boolean;
  slide: Slide;
}) {
  const [nameDraft, setNameDraft] = useState(slide.name);
  const [notesDraft, setNotesDraft] = useState(slide.notes ?? '');
  const [backgroundDraft, setBackgroundDraft] = useState(slide.background);
  const [pickedBackground, setPickedBackground] = useState<string | null>(null);
  // Per-field edit sessions: each field captures the canonical baseline when
  // its editing begins, commits its own guarded change on blur/Enter, and
  // never lets another field's commit discard its draft.
  const [nameEdited, setNameEdited] = useState(false);
  const [notesEdited, setNotesEdited] = useState(false);
  const [backgroundEdited, setBackgroundEdited] = useState(false);
  const [baseName, setBaseName] = useState(slide.name);
  const [baseNotes, setBaseNotes] = useState(slide.notes ?? '');
  const [baseBackground, setBaseBackground] = useState(slide.background);
  const nameStale = nameEdited && slide.name !== baseName;
  const notesStale = notesEdited && (slide.notes ?? '') !== baseNotes;
  const backgroundStale = backgroundEdited && slide.background !== baseBackground;

  // A dirty draft is the user's word; only untouched fields follow the canon.
  useEffect(() => {
    if (!nameEdited) {
      setNameDraft(slide.name);
    }
    if (!notesEdited) {
      setNotesDraft(slide.notes ?? '');
    }
    if (!backgroundEdited) {
      setBackgroundDraft(slide.background);
      setPickedBackground(null);
    }
  }, [backgroundEdited, nameEdited, notesEdited, slide.background, slide.name, slide.notes]);

  function beginNameEdit(): void {
    if (!nameEdited) {
      setBaseName(slide.name);
      setNameEdited(true);
    }
  }

  function beginNotesEdit(): void {
    if (!notesEdited) {
      setBaseNotes(slide.notes ?? '');
      setNotesEdited(true);
    }
  }

  function beginBackgroundEdit(): void {
    if (!backgroundEdited) {
      setBaseBackground(slide.background);
      setBackgroundEdited(true);
    }
  }

  function commitName(): void {
    const name = nameDraft.trim();
    if (name.length === 0 || name === slide.name) {
      setNameDraft(slide.name);
      setBaseName(slide.name);
      setNameEdited(false);
      return;
    }
    if (onCommit(slide, { name })) {
      setBaseName(name);
      setNameEdited(false);
    }
  }

  function commitNotes(): void {
    const notes = notesDraft.trim();
    if (notes === (slide.notes ?? '')) {
      setNotesDraft(slide.notes ?? '');
      setBaseNotes(slide.notes ?? '');
      setNotesEdited(false);
      return;
    }
    if (onCommit(slide, notes.length === 0 ? { notes: null } : { notes })) {
      setBaseNotes(notes);
      setNotesEdited(false);
    }
  }

  function commitBackground(background: string): void {
    const color = background.toLowerCase();
    setPickedBackground(null);
    if (color === slide.background) {
      setBackgroundDraft(slide.background);
      setBaseBackground(slide.background);
      setBackgroundEdited(false);
      return;
    }
    if (onCommit(slide, { background: color })) {
      setBackgroundDraft(color);
      setBaseBackground(color);
      setBackgroundEdited(false);
    }
  }

  function commitPickedBackground(): void {
    if (pickedBackground) {
      commitBackground(pickedBackground);
    }
  }

  function commitBackgroundHex(): void {
    const color = backgroundDraft.trim();
    if (!HEX_COLOR_PATTERN.test(color)) {
      setBackgroundDraft(slide.background);
      return;
    }
    commitBackground(color);
  }

  return (
    <>
      <section className="inspector-section">
        <div className="isection-head">
          <span className="isection-label">Slide</span>
          <span className="isection-tag">props</span>
        </div>
        <div className="field-grid">
          <label className="field">
            <span className="field-label">Name</span>
            <input
              aria-label="Slide name"
              className="field-input"
              onBlur={commitName}
              onChange={(event) => {
                beginNameEdit();
                setNameDraft(event.currentTarget.value);
              }}
              onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitName();
                }
              }}
              value={nameDraft}
            />
          </label>
          <div className="field">
            <span className="field-label">Background</span>
            <div className="color-well-row">
              <input
                aria-label="Slide background color"
                className="color-well"
                // One draft; the picker commits once at blur, never per drag
                // step, so a drag cannot flood the change history.
                onBlur={commitPickedBackground}
                onChange={(event) => {
                  beginBackgroundEdit();
                  setPickedBackground(event.currentTarget.value);
                }}
                type="color"
                value={pickedBackground ?? (HEX_COLOR_PATTERN.test(slide.background) ? slide.background : BLACK_FALLBACK_HEX)}
              />
              <input
                aria-label="Slide background hex"
                className="field-input"
                onBlur={commitBackgroundHex}
                onChange={(event) => {
                  beginBackgroundEdit();
                  setBackgroundDraft(event.currentTarget.value);
                }}
                onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitBackgroundHex();
                  }
                }}
                spellCheck={false}
                type="text"
                value={backgroundDraft}
              />
            </div>
          </div>
        </div>
        <div className="field" style={{ marginTop: 8 }}>
          <span className="field-label">Notes</span>
          <textarea
            aria-label="Speaker notes"
            className="field-textarea"
            onBlur={commitNotes}
            onChange={(event) => {
              beginNotesEdit();
              setNotesDraft(event.currentTarget.value);
            }}
            placeholder="Speaker notes for this slide…"
            rows={3}
            value={notesDraft}
          />
        </div>
        {nameStale || notesStale || backgroundStale ? (
          <p className="multi-note" style={{ marginTop: 8 }}>
            <ReviewBar
              onUseLatest={() => {
                setNameDraft(slide.name);
                setNotesDraft(slide.notes ?? '');
                setBackgroundDraft(slide.background);
                setPickedBackground(null);
                setBaseName(slide.name);
                setBaseNotes(slide.notes ?? '');
                setBaseBackground(slide.background);
                setNameEdited(false);
                setNotesEdited(false);
                setBackgroundEdited(false);
              }}
            />
          </p>
        ) : null}
        <p className="multi-note" style={{ marginTop: 8 }}>
          Slide name, background, and notes each commit one guarded change.
        </p>
        <div className="field" style={{ marginTop: 10 }}>
          <span className="field-label">Size</span>
          <div className="field-text" style={{ padding: '6px 7px', marginTop: 3 }}>
            {env.snapshot.presentation.size.width} × {env.snapshot.presentation.size.height} · 16:9
          </div>
        </div>
      </section>
    </>
  );
}

// --- Text content ---------------------------------------------------------------------

function TextContentField({
  disabled,
  element,
  onCommit,
}: {
  disabled: boolean;
  element: TextElement;
  onCommit: (text: string) => boolean;
}) {
  const [draft, setDraft] = useState(element.text);
  const [dirty, setDirty] = useState(false);
  // The canonical value when editing began; review appears only when the
  // canonical text changed since then, never while the user is typing.
  const [baseText, setBaseText] = useState(element.text);
  const stale = dirty && element.text !== baseText;

  useEffect(() => {
    if (!dirty) {
      setDraft(element.text);
      setBaseText(element.text);
    }
  }, [dirty, element.text]);

  function commit(): void {
    if (onCommit(draft)) {
      setDirty(false);
      setBaseText(draft);
    }
  }

  return (
    <div className="field-grid">
      <label className="field" style={{ gridColumn: '1 / -1' }}>
        <span className="field-label">Content</span>
        <textarea
          className="field-textarea"
          disabled={disabled}
          onBlur={commit}
          onChange={(event) => {
            // Capture the canonical baseline once, when editing begins, so an
            // external change mid-edit still surfaces as review.
            if (!dirty) {
              setDirty(true);
              setBaseText(element.text);
            }
            setDraft(event.currentTarget.value);
          }}
          onKeyDown={(event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              commit();
            }
          }}
          rows={4}
          value={draft}
        />
      </label>
      {stale ? (
        <div style={{ gridColumn: '1 / -1' }}>
          <ReviewBar
            onUseLatest={() => {
              setDraft(element.text);
              setBaseText(element.text);
              setDirty(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

// --- Typography --------------------------------------------------------------------------

/** Field-exact style comparison; mirrors the canonical kernel's own check. */
function sameStyle(left: TextStyle, right: TextStyle): boolean {
  return (
    left.align === right.align &&
    left.color === right.color &&
    left.fontFamily === right.fontFamily &&
    left.fontSize === right.fontSize &&
    left.fontWeight === right.fontWeight &&
    left.letterSpacing === right.letterSpacing &&
    left.lineHeight === right.lineHeight &&
    left.textTransform === right.textTransform
  );
}

/**
 * Complete-style typography editor: number and color fields draft locally and
 * commit one atomic update_text_style (the full replacement style) on
 * blur/Enter. Each field captures the canonical baseline when its editing
 * begins; while a draft is dirty an external canonical style change surfaces
 * the review state instead of silently overwriting the draft, and untouched
 * fields keep following the canonical value.
 */
function TypographySection({
  element,
  onCommit,
}: {
  element: TextElement;
  onCommit: (style: TextStyle) => boolean;
}) {
  const { style } = element;
  const [sizeDraft, setSizeDraft] = useState(String(style.fontSize));
  const [lineHeightDraft, setLineHeightDraft] = useState(String(style.lineHeight ?? 1.4));
  const [letterSpacingDraft, setLetterSpacingDraft] = useState(String(style.letterSpacing ?? 0));
  const [hexDraft, setHexDraft] = useState(style.color);
  const [pickedColor, setPickedColor] = useState<string | null>(null);
  const [sizeEdited, setSizeEdited] = useState(false);
  const [lineHeightEdited, setLineHeightEdited] = useState(false);
  const [letterSpacingEdited, setLetterSpacingEdited] = useState(false);
  const [colorEdited, setColorEdited] = useState(false);
  const [baseStyle, setBaseStyle] = useState(style);
  const edited = sizeEdited || lineHeightEdited || letterSpacingEdited || colorEdited;
  const stale = edited && !sameStyle(style, baseStyle);

  // A dirty draft is the user's word; only untouched fields follow the canon.
  useEffect(() => {
    if (!sizeEdited) {
      setSizeDraft(String(style.fontSize));
    }
    if (!lineHeightEdited) {
      setLineHeightDraft(String(style.lineHeight ?? 1.4));
    }
    if (!letterSpacingEdited) {
      setLetterSpacingDraft(String(style.letterSpacing ?? 0));
    }
    if (!colorEdited) {
      setHexDraft(style.color);
      setPickedColor(null);
    }
  }, [colorEdited, letterSpacingEdited, lineHeightEdited, sizeEdited, style]);

  /** Commit the full canonical style with one patched field; record the new baseline on success. */
  function commit(patch: Partial<TextStyle>): boolean {
    const next = { ...style, ...patch };
    if (onCommit(next)) {
      setBaseStyle(next);
      return true;
    }
    return false;
  }

  function beginSizeEdit(): void {
    if (!edited) {
      setBaseStyle(style);
    }
    setSizeEdited(true);
  }

  function beginLineHeightEdit(): void {
    if (!edited) {
      setBaseStyle(style);
    }
    setLineHeightEdited(true);
  }

  function beginLetterSpacingEdit(): void {
    if (!edited) {
      setBaseStyle(style);
    }
    setLetterSpacingEdited(true);
  }

  function beginColorEdit(): void {
    if (!edited) {
      setBaseStyle(style);
    }
    setColorEdited(true);
  }

  function commitSize(): void {
    const fontSize = Number.parseFloat(sizeDraft);
    if (!Number.isFinite(fontSize) || fontSize <= 0) {
      setSizeDraft(String(style.fontSize));
      setSizeEdited(false);
      return;
    }
    setSizeDraft(String(fontSize));
    if (commit({ fontSize })) {
      setSizeEdited(false);
    }
  }

  function commitLineHeight(): void {
    const lineHeight = Number.parseFloat(lineHeightDraft);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
      setLineHeightDraft(String(style.lineHeight ?? 1.4));
      setLineHeightEdited(false);
      return;
    }
    setLineHeightDraft(String(lineHeight));
    if (commit({ lineHeight })) {
      setLineHeightEdited(false);
    }
  }

  function commitLetterSpacing(): void {
    const letterSpacing = Number.parseFloat(letterSpacingDraft);
    if (!Number.isFinite(letterSpacing)) {
      setLetterSpacingDraft(String(style.letterSpacing ?? 0));
      setLetterSpacingEdited(false);
      return;
    }
    setLetterSpacingDraft(String(letterSpacing));
    if (commit({ letterSpacing })) {
      setLetterSpacingEdited(false);
    }
  }

  function commitColor(): void {
    const color = hexDraft.trim().toLowerCase();
    if (!HEX_COLOR_PATTERN.test(color)) {
      setHexDraft(style.color);
      setColorEdited(false);
      return;
    }
    setHexDraft(color);
    if (commit({ color })) {
      setColorEdited(false);
    }
  }

  function commitPickedColor(): void {
    if (!pickedColor) {
      return;
    }
    const color = pickedColor.toLowerCase();
    setPickedColor(null);
    setHexDraft(color);
    if (commit({ color })) {
      setColorEdited(false);
    }
  }

  function useLatest(): void {
    setSizeDraft(String(style.fontSize));
    setLineHeightDraft(String(style.lineHeight ?? 1.4));
    setLetterSpacingDraft(String(style.letterSpacing ?? 0));
    setHexDraft(style.color);
    setPickedColor(null);
    setBaseStyle(style);
    setSizeEdited(false);
    setLineHeightEdited(false);
    setLetterSpacingEdited(false);
    setColorEdited(false);
  }


  return (
    <section className="inspector-section">
      <div className="isection-head">
        <span className="isection-label">Typography</span>
      </div>
      <div className="field-grid">
        <label className="field">
          <span className="field-label">Font</span>
          <select
            aria-label="Font family"
            className="field-select"
            onChange={(event) => commit({ fontFamily: event.currentTarget.value })}
            value={style.fontFamily}
          >
            {FONT_FAMILIES.map((family) => (
              <option key={family} value={family}>
                {family.split(',')[0]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Size</span>
          <input
            aria-label="Font size"
            className="field-input"
            min={1}
            onBlur={commitSize}
            onChange={(event) => {
              beginSizeEdit();
              setSizeDraft(event.currentTarget.value);
            }}
            onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitSize();
              }
            }}
            step={1}
            type="number"
            value={sizeDraft}
          />
        </label>
        <label className="field">
          <span className="field-label">Weight</span>
          <select
            aria-label="Font weight"
            className="field-select"
            onChange={(event) =>
              commit({ fontWeight: Number(event.currentTarget.value) as TextStyle['fontWeight'] })
            }
            value={style.fontWeight ?? 400}
          >
            {FONT_WEIGHTS.map((weight) => (
              <option key={weight} value={weight}>
                {weight}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Line height</span>
          <input
            aria-label="Line height"
            className="field-input"
            min={0.1}
            onBlur={commitLineHeight}
            onChange={(event) => {
              beginLineHeightEdit();
              setLineHeightDraft(event.currentTarget.value);
            }}
            onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitLineHeight();
              }
            }}
            step={0.1}
            type="number"
            value={lineHeightDraft}
          />
        </label>
        <label className="field">
          <span className="field-label">Letter sp.</span>
          <input
            aria-label="Letter spacing"
            className="field-input"
            onBlur={commitLetterSpacing}
            onChange={(event) => {
              beginLetterSpacingEdit();
              setLetterSpacingDraft(event.currentTarget.value);
            }}
            onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitLetterSpacing();
              }
            }}
            step={0.1}
            type="number"
            value={letterSpacingDraft}
          />
        </label>
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <span className="field-label">Text color</span>
          <div className="color-well-row">
            <input
              aria-label="Text color"
              className="color-well"
              // One draft; the picker commits once at blur, never per drag
              // step, so a drag cannot flood the change history.
              onBlur={commitPickedColor}
              onChange={(event) => {
                beginColorEdit();
                setPickedColor(event.currentTarget.value);
              }}
              type="color"
              value={pickedColor ?? (HEX_COLOR_PATTERN.test(style.color) ? style.color : BLACK_FALLBACK_HEX)}
            />
            <input
              aria-label="Text color hex"
              className="field-input"
              onBlur={commitColor}
              onChange={(event) => {
                beginColorEdit();
                setHexDraft(event.currentTarget.value);
              }}
              onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitColor();
                }
              }}
              spellCheck={false}
              value={hexDraft}
            />
          </div>
        </div>
      </div>
      <div className="field" style={{ marginTop: 8 }}>
        <span className="field-label">Align</span>
        <div className="seg-row">
          {(['left', 'center', 'right'] as const).map((align) => (
            <button
              aria-label={`Align ${align}`}
              aria-pressed={style.align === align}
              className="seg-btn"
              key={align}
              onClick={() => commit({ align })}
              type="button"
            >
              {align === 'left' ? '‹' : align === 'center' ? '≡' : '›'}
            </button>
          ))}
        </div>
      </div>
      <div className="field" style={{ marginTop: 8 }}>
        <span className="field-label">Transform</span>
        <div className="seg-row">
          {(['none', 'uppercase'] as const).map((transform) => (
            <button
              aria-label={`Text transform ${transform}`}
              aria-pressed={style.textTransform === transform}
              className="seg-btn"
              key={transform}
              onClick={() => commit({ textTransform: transform })}
              type="button"
            >
              {transform === 'none' ? 'Aa' : 'AA'}
            </button>
          ))}
        </div>
      </div>
      {stale ? (
        <div className="field" style={{ marginTop: 8 }}>
          <ReviewBar onUseLatest={useLatest} />
        </div>
      ) : null}
    </section>
  );
}

// --- Shape appearance ----------------------------------------------------------------------

function ShapeStyleFields({
  element,
  onCommit,
}: {
  element: ShapeElement;
  onCommit: (style: ShapeStyle) => boolean;
}) {
  const { style } = element;
  const [fillSolid, setFillSolid] = useState(style.fill.kind === 'solid');
  const [fillHex, setFillHex] = useState(style.fill.kind === 'solid' ? style.fill.color : '');
  const [fillOpacity, setFillOpacity] = useState(
    String(style.fill.kind === 'solid' ? opacityToPercent(style.fill.opacity) : 100),
  );
  const [strokeSolid, setStrokeSolid] = useState(style.stroke.kind === 'solid');
  const [strokeHex, setStrokeHex] = useState(style.stroke.kind === 'solid' ? style.stroke.color : '');
  const [strokeOpacity, setStrokeOpacity] = useState(
    String(style.stroke.kind === 'solid' ? opacityToPercent(style.stroke.opacity) : 100),
  );
  const [strokeWidth, setStrokeWidth] = useState(
    String(style.stroke.kind === 'solid' ? style.stroke.width : 1),
  );
  const [strokeDash, setStrokeDash] = useState<StrokeDash>(
    style.stroke.kind === 'solid' ? style.stroke.dash : 'solid',
  );
  const [radius, setRadius] = useState(
    String(style.geometry.kind === 'rectangle' ? style.geometry.cornerRadius : 0),
  );
  const [pickedFill, setPickedFill] = useState<string | null>(null);
  const [pickedStroke, setPickedStroke] = useState<string | null>(null);
  // One draft session over the complete style: the canonical baseline is
  // captured when the first field begins editing and stays fixed while any
  // draft is dirty, so an external canonical change surfaces as review
  // instead of silently overwriting the draft; a clean session keeps every
  // field following the canon.
  const [edited, setEdited] = useState(false);
  const [baseStyle, setBaseStyle] = useState(style);
  const stale = edited && !shapeStyleMatches(style, baseStyle);
  // The authored rectangle radius of this session, restored when the
  // geometry returns to the rectangle.
  const rememberedRadius = useRef(style.geometry.kind === 'rectangle' ? style.geometry.cornerRadius : 0);

  useEffect(() => {
    if (edited) {
      return;
    }
    setFillSolid(style.fill.kind === 'solid');
    setFillHex(style.fill.kind === 'solid' ? style.fill.color : '');
    setFillOpacity(String(style.fill.kind === 'solid' ? opacityToPercent(style.fill.opacity) : 100));
    setStrokeSolid(style.stroke.kind === 'solid');
    setStrokeHex(style.stroke.kind === 'solid' ? style.stroke.color : '');
    setStrokeOpacity(String(style.stroke.kind === 'solid' ? opacityToPercent(style.stroke.opacity) : 100));
    setStrokeWidth(String(style.stroke.kind === 'solid' ? style.stroke.width : 1));
    setStrokeDash(style.stroke.kind === 'solid' ? style.stroke.dash : 'solid');
    setRadius(String(style.geometry.kind === 'rectangle' ? style.geometry.cornerRadius : 0));
    setPickedFill(null);
    setPickedStroke(null);
  }, [edited, style]);

  function beginEdit(): void {
    if (!edited) {
      setBaseStyle(style);
    }
    setEdited(true);
  }

  /** Escape cancels the session: drafts revert to the canon without a commit. */
  function cancelEdit(): void {
    setEdited(false);
  }

  /** Escape on a numeric/color input: cancel the session, keep focus local. */
  function handleFieldKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit();
    }
  }

  // --- Complete-style assembly (the kernel owns validation) -----------------

  /**
   * Build the canonical fill paint from the drafts. The `solid` argument is
   * the target state of the toggle being committed, so turning a fill on
   * produces a solid paint from the drafts instead of reading the stale
   * pre-toggle state; the default follows the current toggle for commit
   * paths that leave the kind untouched. `colorOverride` seeds the commit
   * when the toggle reveals fields that were hidden while the fill was none.
   */
  function fillFromDrafts(solid = fillSolid, colorOverride?: string): ShapeFill | undefined {
    if (!solid) {
      return { kind: 'none' };
    }
    const color = (colorOverride ?? (pickedFill ?? fillHex)).trim().toLowerCase();
    const opacity = Number.parseFloat(fillOpacity);
    if (!HEX_COLOR_PATTERN.test(color) || !Number.isFinite(opacity) || opacity < 1 || opacity > 100) {
      return undefined;
    }
    return { kind: 'solid', color, opacity: percentToOpacity(opacity) };
  }

  /**
   * Build the canonical stroke paint from the drafts; the `solid` argument
   * follows the same target-state rule as {@link fillFromDrafts}. A solid
   * stroke is the only variant that carries width/dash, so the returned
   * solid always owns those fields and `none` owns none of them.
   * `colorOverride` seeds the commit when the toggle reveals fields that
   * were hidden while the stroke was none.
   */
  function strokeFromDrafts(solid = strokeSolid, colorOverride?: string): ShapeStroke | undefined {
    if (!solid) {
      return { kind: 'none' };
    }
    const color = (colorOverride ?? (pickedStroke ?? strokeHex)).trim().toLowerCase();
    const opacity = Number.parseFloat(strokeOpacity);
    const width = Number.parseFloat(strokeWidth);
    if (!HEX_COLOR_PATTERN.test(color) || !Number.isFinite(opacity) || opacity < 1 || opacity > 100) {
      return undefined;
    }
    if (!Number.isFinite(width) || width <= 0) {
      return undefined;
    }
    return { kind: 'solid', color, opacity: percentToOpacity(opacity), width, dash: strokeDash };
  }

  /** The authored radius as a finite non-negative number, with the canon as fallback. */
  function draftRadius(): number {
    const value = Number.parseFloat(radius);
    const rounded = Math.round(value * 100) / 100;
    // Only the rectangle geometry carries an authored radius; the other
    // variants have none by construction, so the fallback is the canon's
    // radius when this geometry is a rectangle and zero otherwise.
    const fallback = style.geometry.kind === 'rectangle' ? style.geometry.cornerRadius : 0;
    return Number.isFinite(value) && value >= 0 ? rounded : fallback;
  }

  function geometryFromDrafts(): ShapeGeometry {
    return style.geometry.kind === 'rectangle'
      ? { kind: 'rectangle', cornerRadius: draftRadius() }
      : style.geometry;
  }

  /** One commit path: a complete replacement style, guarded by the session baseline. */
  function commitStyle(next: ShapeStyle): boolean {
    if (shapeStyleMatches(style, next)) {
      setEdited(false);
      return true;
    }
    const ok = onCommit(next);
    if (ok) {
      setEdited(false);
      setBaseStyle(next);
    }
    return ok;
  }

  /** Blur/Enter commit; an invalid draft never dispatches and the session reverts. */
  function commit(): void {
    const fill = fillFromDrafts();
    const stroke = strokeFromDrafts();
    if (!fill || !stroke) {
      setEdited(false);
      return;
    }
    commitStyle({ fill, geometry: geometryFromDrafts(), stroke });
  }

  /** Switch geometry preserving the complete style; the rectangle radius is remembered per session. */
  function commitGeometry(kind: ShapeGeometry['kind']): void {
    if (kind === style.geometry.kind) {
      return;
    }
    const fill = fillFromDrafts();
    const stroke = strokeFromDrafts();
    if (!fill || !stroke) {
      setEdited(false);
      return;
    }
    if (style.geometry.kind === 'rectangle') {
      // Leaving the rectangle: remember the authored radius so a later
      // return to the rectangle restores the session value.
      rememberedRadius.current = draftRadius();
    }
    const next = switchGeometryTo({ ...style, fill, stroke }, kind, rememberedRadius.current);
    commitStyle(next);
  }

  /**
   * The color a solid paint starts from when its color fields were hidden
   * while the paint was none: the other paint's color when it has one, else
   * the canonical accent. The draft fields are seeded so the revealed
   * controls show exactly what this commit writes.
   */
  function seedSolidColor(draft: string, otherColor: string | undefined, setDraft: (value: string) => void): string {
    const candidate = draft.trim().toLowerCase();
    if (HEX_COLOR_PATTERN.test(candidate)) {
      return candidate;
    }
    const seeded = otherColor ?? DEFAULT_PAINT_HEX;
    setDraft(seeded);
    return seeded;
  }

  function commitFillKind(solid: boolean): void {
    if (solid === fillSolid) {
      return;
    }
    beginEdit();
    const stroke = strokeFromDrafts();
    if (!stroke) {
      setEdited(false);
      return;
    }
    if (!solid) {
      commitStyle({ fill: { kind: 'none' }, geometry: geometryFromDrafts(), stroke });
      return;
    }
    // Revealing a paint whose fields were hidden needs a valid seed color,
    // or the toggle could never leave `none`.
    const color = seedSolidColor(
      pickedFill ?? fillHex,
      style.stroke.kind === 'solid' ? style.stroke.color : undefined,
      setFillHex,
    );
    setPickedFill(null);
    const fill = fillFromDrafts(true, color);
    if (!fill) {
      setEdited(false);
      return;
    }
    commitStyle({ fill, geometry: geometryFromDrafts(), stroke });
  }

  function commitStrokeKind(solid: boolean): void {
    if (solid === strokeSolid) {
      return;
    }
    beginEdit();
    const fill = fillFromDrafts();
    if (!fill) {
      setEdited(false);
      return;
    }
    if (!solid) {
      commitStyle({ fill, geometry: geometryFromDrafts(), stroke: { kind: 'none' } });
      return;
    }
    const color = seedSolidColor(
      pickedStroke ?? strokeHex,
      style.fill.kind === 'solid' ? style.fill.color : undefined,
      setStrokeHex,
    );
    setPickedStroke(null);
    const stroke = strokeFromDrafts(true, color);
    if (!stroke) {
      setEdited(false);
      return;
    }
    commitStyle({ fill, geometry: geometryFromDrafts(), stroke });
  }

  function commitDash(dash: StrokeDash): void {
    beginEdit();
    // The dash control only exists for a solid stroke; a draft that cannot
    // name a solid stroke (invalid values, or a none toggle) cancels the
    // session instead of writing a dash onto a none variant.
    const stroke = strokeFromDrafts();
    if (!stroke || stroke.kind === 'none') {
      setEdited(false);
      return;
    }
    const fill = fillFromDrafts();
    if (!fill) {
      setEdited(false);
      return;
    }
    commitStyle({ fill, geometry: geometryFromDrafts(), stroke: { ...stroke, dash } });
  }

  function useLatest(): void {
    setEdited(false);
  }

  // The rendered bound of the authored radius, derived by the kernel helper
  // with an unbounded authored value — the only radius derivation in the
  // system, used here purely as the field's honest max hint.
  const maxRadiusHint = effectiveCornerRadius(element.frame, {
    kind: 'rectangle',
    cornerRadius: Number.POSITIVE_INFINITY,
  });

  return (
    <div className="field-grid">
      <div className="field" style={{ gridColumn: '1 / -1' }}>
        <span className="field-label">Geometry</span>
        <div className="seg-row">
          {SHAPE_GEOMETRY_OPTIONS.map(({ kind, label }) => (
            <button
              aria-label={`${label} geometry`}
              aria-pressed={style.geometry.kind === kind}
              className="seg-btn"
              key={kind}
              onClick={() => commitGeometry(kind)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="field" style={{ gridColumn: '1 / -1' }}>
        <span className="field-label">Fill</span>
        <div className="seg-row">
          <button
            aria-pressed={!fillSolid}
            className="seg-btn"
            onClick={() => commitFillKind(false)}
            type="button"
          >
            None
          </button>
          <button
            aria-pressed={fillSolid}
            className="seg-btn"
            onClick={() => commitFillKind(true)}
            type="button"
          >
            Solid
          </button>
        </div>
        {fillSolid ? (
          <div className="color-well-row shape-color-row">
            <input
              aria-label="Pick a fill color"
              className="color-well"
              onBlur={commit}
              onChange={(event) => {
                beginEdit();
                setPickedFill(event.currentTarget.value);
              }}
              type="color"
              value={pickedFill ?? (HEX_COLOR_PATTERN.test(fillHex) ? fillHex : BLACK_FALLBACK_HEX)}
            />
            <input
              aria-label="Fill hex"
              className="field-input"
              onBlur={commit}
              onChange={(event) => {
                beginEdit();
                setFillHex(event.currentTarget.value);
              }}
              onKeyDown={handleFieldKeyDown}
              spellCheck={false}
              value={fillHex}
            />
            <input
              aria-label="Fill opacity percent"
              className="field-input field-input-small"
              max={100}
              min={1}
              onBlur={commit}
              onChange={(event) => {
                beginEdit();
                setFillOpacity(event.currentTarget.value);
              }}
              onKeyDown={handleFieldKeyDown}
              step={1}
              title="Fill opacity, 1–100%"
              type="number"
              value={fillOpacity}
            />
          </div>
        ) : null}
      </div>

      <div className="field" style={{ gridColumn: '1 / -1' }}>
        <span className="field-label">Outline</span>
        <div className="seg-row">
          <button
            aria-pressed={!strokeSolid}
            className="seg-btn"
            onClick={() => commitStrokeKind(false)}
            type="button"
          >
            None
          </button>
          <button
            aria-pressed={strokeSolid}
            className="seg-btn"
            onClick={() => commitStrokeKind(true)}
            type="button"
          >
            Solid
          </button>
        </div>
        {strokeSolid ? (
          <>
            <div className="color-well-row shape-color-row">
              <input
                aria-label="Pick an outline color"
                className="color-well"
                onBlur={commit}
                onChange={(event) => {
                  beginEdit();
                  setPickedStroke(event.currentTarget.value);
                }}
                type="color"
                value={pickedStroke ?? (HEX_COLOR_PATTERN.test(strokeHex) ? strokeHex : BLACK_FALLBACK_HEX)}
              />
              <input
                aria-label="Outline hex"
                className="field-input"
                onBlur={commit}
                onChange={(event) => {
                  beginEdit();
                  setStrokeHex(event.currentTarget.value);
                }}
                onKeyDown={handleFieldKeyDown}
                spellCheck={false}
                value={strokeHex}
              />
              <input
                aria-label="Outline opacity percent"
                className="field-input field-input-small"
                max={100}
                min={1}
                onBlur={commit}
                onChange={(event) => {
                  beginEdit();
                  setStrokeOpacity(event.currentTarget.value);
                }}
                onKeyDown={handleFieldKeyDown}
                step={1}
                title="Outline opacity, 1–100%"
                type="number"
                value={strokeOpacity}
              />
            </div>
            <div className="shape-numeric-row">
              <label className="field">
                <span className="field-label">Width</span>
                <input
                  aria-label="Outline width"
                  className="field-input"
                  min={0.25}
                  onBlur={commit}
                  onChange={(event) => {
                    beginEdit();
                    setStrokeWidth(event.currentTarget.value);
                  }}
                  onKeyDown={handleFieldKeyDown}
                  step={0.25}
                  title="Outline width in slide points"
                  type="number"
                  value={strokeWidth}
                />
              </label>
            </div>
            <div className="seg-row">
              {STROKE_DASH_OPTIONS.map(({ dash, label }) => (
                <button
                  aria-label={`Outline dash ${label}`}
                  aria-pressed={strokeDash === dash}
                  className="seg-btn"
                  key={dash}
                  onClick={() => commitDash(dash)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>

      {style.geometry.kind === 'rectangle' ? (
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <span className="field-label">Corner radius</span>
          <input
            aria-label="Corner radius"
            className="field-input"
            max={maxRadiusHint}
            min={0}
            onBlur={commit}
            onChange={(event) => {
              beginEdit();
              setRadius(event.currentTarget.value);
            }}
            onKeyDown={handleFieldKeyDown}
            step={1}
            title={`Rendered maximum is ${maxRadiusHint} (half the shorter side)`}
            type="number"
            value={radius}
          />
        </div>
      ) : null}

      {stale ? (
        <div style={{ gridColumn: '1 / -1' }}>
          <ReviewBar onUseLatest={useLatest} />
        </div>
      ) : null}
    </div>
  );
}

// --- Position & size ----------------------------------------------------------------------

type FrameDraft = Record<keyof Frame, string>;

const FRAME_FIELDS: ReadonlyArray<{ field: keyof Frame; label: string }> = [
  { field: 'x', label: 'X' },
  { field: 'y', label: 'Y' },
  { field: 'width', label: 'W' },
  { field: 'height', label: 'H' },
];

function frameToDraft(frame: Frame): FrameDraft {
  return {
    x: String(frame.x),
    y: String(frame.y),
    width: String(frame.width),
    height: String(frame.height),
  };
}

function FrameFields({
  disabled,
  element,
  onCommit,
}: {
  disabled: boolean;
  element: PresentationElement;
  onCommit: (frame: Frame) => boolean;
}) {
  const [draft, setDraft] = useState<FrameDraft>(() => frameToDraft(element.frame));
  const [touched, setTouched] = useState<Set<keyof Frame>>(new Set());
  // Canonical frame when the first touched field began editing.
  const baseRef = useRef<FrameDraft>(frameToDraft(element.frame));
  const canonical = frameToDraft(element.frame);
  const stale =
    touched.size > 0 &&
    FRAME_FIELDS.some(({ field }) => touched.has(field) && canonical[field] !== baseRef.current[field]);

  useEffect(() => {
    if (touched.size === 0) {
      setDraft(canonical);
      baseRef.current = canonical;
    }
  }, [element.frame]);

  function commitField(field: keyof Frame): void {
    const parsed = Number.parseFloat(draft[field]);
    const [min, max] = frameFieldBounds(element.frame)[field];
    const value = Number.isFinite(parsed) ? Math.round(clamp(parsed, min, max)) : element.frame[field];
    const nextDraft = { ...draft, [field]: String(value) };
    setDraft(nextDraft);
    if (onCommit({ ...element.frame, [field]: value })) {
      // End only this field's session; other dirty drafts stay untouched.
      setTouched((current) => {
        const next = new Set(current);
        next.delete(field);
        return next;
      });
    } else {
      setTouched((current) => new Set(current).add(field));
    }
  }

  const bounds = frameFieldBounds(element.frame);

  return (
    <div>
      <div className="field-grid cols-4">
        {FRAME_FIELDS.map(({ field, label }) => (
          <label className="field" key={field}>
            <span className="field-label">{label}</span>
            <input
              aria-label={`${label} position`}
              className="field-input"
              disabled={disabled}
              max={bounds[field][1]}
              min={bounds[field][0]}
              onBlur={() => commitField(field)}
              onChange={(event) => {
                // Capture the value synchronously: React nulls
                // currentTarget after the handler, and the draft updater runs
                // later.
                const value = event.currentTarget.value;
                // Capture the canonical baseline once, when the first field of
                // an edit session is touched, so an external frame change
                // mid-edit still surfaces as review.
                if (touched.size === 0) {
                  baseRef.current = canonical;
                }
                setTouched((current) => new Set(current).add(field));
                setDraft((current) => ({ ...current, [field]: value }));
              }}
              onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitField(field);
                }
              }}
              step={1}
              type="number"
              value={draft[field]}
            />
          </label>
        ))}
      </div>
      {stale ? (
        <div style={{ marginTop: 8 }}>
          <ReviewBar
            onUseLatest={() => {
              setDraft(canonical);
              setTouched(new Set());
              baseRef.current = canonical;
            }}
          />
        </div>
      ) : null}
    </div>
  );
}