import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  commandsForSurface,
  detectPlatform,
  formatShortcut,
  type CommandContext,
  type CommandGroup,
  type CommandListItem,
} from './command-registry';
import { CommandIcon } from './command-icons';

const LIST_ID = 'command-palette-list';

function optionId(commandId: string): string {
  return `command-palette-option-${commandId}`;
}

/**
 * The compact command palette (⌘K). Every item, icon, section, and shortcut
 * comes from the single registry (`commandsForSurface(ctx, 'palette')`); the
 * palette is a search surface, so inapplicable commands stay visible and are
 * honestly disabled. Keyboard navigation, focus return, and the Tab trap are
 * unchanged.
 */
export function CommandPalette({
  ctx,
  onClose,
  open,
}: {
  ctx: CommandContext;
  onClose: () => void;
  open: boolean;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // The element that owned focus before the palette opened; restored on close.
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const platform = detectPlatform();

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const commands = commandsForSurface(ctx, 'palette');
    if (!needle) {
      return commands;
    }
    return commands.filter((command) => `${command.label} ${command.keywords}`.toLowerCase().includes(needle));
  }, [ctx, query]);

  // The active option is always derived against the current result list, so
  // a list that shrinks (typing, or agent/system writes while open) never
  // leaves navigation or aria-activedescendant pointing at a vanished option.
  const activeIndex = filtered.length === 0 ? -1 : Math.min(active, filtered.length - 1);
  const activeOption = activeIndex === -1 ? undefined : filtered[activeIndex];

  useEffect(() => {
    if (open) {
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setQuery('');
      setActive(0);
      inputRef.current?.focus();
      return;
    }
    // Restore focus to the opening element when it still exists; the
    // document otherwise falls back to body, which is honest.
    const previous = previousFocusRef.current;
    previousFocusRef.current = null;
    if (previous && previous.isConnected) {
      previous.focus();
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  // Keep the active command visible while navigating with the keyboard.
  useEffect(() => {
    if (activeIndex === -1) {
      return;
    }
    const item = listRef.current?.querySelector<HTMLElement>(`[data-palette-index="${activeIndex}"]`);
    item?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open) {
    return null;
  }

  function runCommand(command: CommandListItem): void {
    if (command.state === 'disabled') {
      return;
    }
    command.run(ctx);
    onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      if (filtered.length > 0) {
        event.preventDefault();
        setActive((current) => Math.min(current + 1, filtered.length - 1));
      }
      return;
    }
    if (event.key === 'ArrowUp') {
      if (filtered.length > 0) {
        event.preventDefault();
        setActive((current) => Math.max(current - 1, 0));
      }
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (activeOption) {
        runCommand(activeOption);
      }
    }
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'Tab') {
      return;
    }
    // Trap Tab/Shift+Tab inside the palette: input first, options after,
    // wrapping back instead of escaping into the editor behind the scrim.
    const focusables = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('input:not([disabled]), button:not([disabled])'),
    ).filter((element) => element.getClientRects().length > 0);
    if (focusables.length === 0) {
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const activeElement = document.activeElement;
    if (event.shiftKey) {
      if (activeElement === first || !event.currentTarget.contains(activeElement)) {
        event.preventDefault();
        last.focus();
      }
    } else if (activeElement === last || !event.currentTarget.contains(activeElement)) {
      event.preventDefault();
      first.focus();
    }
  }

  const renderSection = (position: number, command: CommandListItem): boolean => {
    if (position === 0) {
      return true;
    }
    const previous = filtered[position - 1];
    return command.group !== previous.group;
  };

  return (
    <>
      <div className="palette-scrim" onClick={onClose} />
      <div
        aria-label="Command palette"
        aria-modal="true"
        className="command-palette"
        onKeyDown={handleDialogKeyDown}
        role="dialog"
      >
        <input
          aria-activedescendant={activeOption ? optionId(activeOption.id) : undefined}
          aria-autocomplete="list"
          aria-controls={LIST_ID}
          aria-expanded="true"
          aria-label="Filter commands"
          className="palette-input"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a command…"
          ref={inputRef}
          role="combobox"
          value={query}
        />
        <div aria-label="Commands" className="palette-list" id={LIST_ID} ref={listRef} role="listbox">
          {filtered.length === 0 ? (
            <p className="palette-empty">No matching command.</p>
          ) : (
            filtered.map((command, position) => (
              <div key={`${command.id}-${position}`}>
                {renderSection(position, command) ? (
                  <div className="palette-section" style={{ marginTop: position > 0 ? 6 : 0 }}>
                    {SECTION_LABELS[command.group]}
                  </div>
                ) : null}
                <button
                  aria-selected={activeIndex === position}
                  className={`palette-item${activeIndex === position ? ' is-active' : ''}${command.state === 'disabled' ? ' is-disabled' : ''}${command.dangerous ? ' is-danger' : ''}`}
                  data-palette-index={position}
                  id={optionId(command.id)}
                  onClick={() => runCommand(command)}
                  onMouseEnter={() => setActive(position)}
                  role="option"
                  type="button"
                >
                  <CommandIcon
                    className={`palette-icon${command.state === 'disabled' ? ' is-disabled' : ''}`}
                    icon={command.icon}
                  />
                  <span>{command.labelText ? command.labelText(ctx) : command.label}</span>
                  {command.shortcut ? (
                    <span className="palette-key">{formatShortcut(command.shortcut, platform)}</span>
                  ) : null}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

/** Palette section headings, in the registry's group order. */
const SECTION_LABELS: Record<CommandGroup, string> = {
  tools: 'Tools',
  edit: 'Edit',
  arrange: 'Arrange',
  text: 'Text',
  slide: 'Slide',
  view: 'View',
  panels: 'Panels',
  file: 'File',
};