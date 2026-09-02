import { MAX_SESSION_ZOOM, MIN_SESSION_ZOOM } from '../../lib/presentation/store';
import type { PresentationSnapshot, PresentationStore } from '../../lib/presentation/store';
import type { PresentationElement, ShapeElement, Slide, TextElement, TextStyle } from '../../types/presentation';
import type { Alignment, ElementOrderDirection } from './commands';

/**
 * The single command vocabulary of the editor: command ids, labels,
 * keywords, groups, icons, shortcuts, surfaces, visibility, enablement,
 * checked state, danger state, and execution all live here and nowhere else.
 * The command bar, the canvas context menu, the slide-rail menus, the
 * command palette, and the global keyboard bindings read the same
 * descriptors through `commandsForSurface`.
 *
 * The module is pure TypeScript (no React, no DOM) so the registry truth
 * tables, shortcut formatting, and the overflow planner are unit-testable
 * with the project's isolated node:test harness.
 */

// --- Shared UI vocabulary owned here so every consumer reads one name --------

/** Ephemeral canvas tool; never enters the canonical model. */
export type ToolMode = 'select' | 'text' | 'shape';

/** The right-hand drawer kinds; the header and palette toggle them. */
export type DrawerKind = 'agent' | 'comments' | 'activity';

/** The transient canvas-menu target: a right-clicked element or the canvas. */
export type MenuTarget =
  | { kind: 'element'; elementId: string }
  | { kind: 'background'; point: { x: number; y: number } };

/** The fixed 16px semantic icon set; implemented in `command-icons.tsx`. */
export type CommandIconId =
  | 'cursor'
  | 'text'
  | 'shape'
  | 'undo'
  | 'redo'
  | 'copy'
  | 'trash'
  | 'select-all'
  | 'edit'
  | 'order-front'
  | 'order-forward'
  | 'order-backward'
  | 'order-back'
  | 'align-left'
  | 'align-centerh'
  | 'align-right'
  | 'align-top'
  | 'align-centerv'
  | 'align-bottom'
  | 'bold'
  | 'text-align-left'
  | 'text-align-center'
  | 'text-align-right'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-fit'
  | 'inspector'
  | 'agent'
  | 'comment'
  | 'activity'
  | 'play'
  | 'download'
  | 'plus'
  | 'ellipsis';

export type CommandGroup =
  | 'tools'
  | 'edit'
  | 'arrange'
  | 'text'
  | 'slide'
  | 'view'
  | 'file'
  | 'panels';

/** The surfaces a command may appear on. */
export type CommandSurface = 'bar' | 'selection' | 'menu' | 'slide-menu' | 'palette' | 'keys';

/**
 * Visual clusters shared by the session bar and the selection action bar.
 * Session bar: history, tools, zoom, inspector. Selection bar: edit, order, align, text.
 */
export type BarCluster = 'history' | 'tools' | 'edit' | 'order' | 'align' | 'text' | 'zoom' | 'inspector';

export type ShortcutKey =
  | 'mod'
  | 'shift'
  | 'alt'
  | 'a'
  | 'b'
  | 'd'
  | 'k'
  | 't'
  | 'v'
  | 's'
  | 'y'
  | 'z'
  | '0'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | '+'
  | '-'
  | '='
  | '['
  | ']'
  | '/'
  | 'delete'
  | 'escape'
  | 'enter'
  | 'f2'
  | 'f5'
  | 'arrowup'
  | 'arrowdown'
  | 'arrowleft'
  | 'arrowright';

export interface Shortcut {
  /** Canonical, OS-neutral combination, e.g. ['mod', 'd']. */
  keys: readonly ShortcutKey[];
  /** OS-alternative binding (e.g. Ctrl+Y for redo away from macOS). */
  alias?: Shortcut;
}

/** Selection facts derived once per render; the only way surfaces read the registry. */
export interface SelectionFlags {
  selectedCount: number;
  unlockedCount: number;
  /** At least one unlocked element is selected. */
  hasUnlocked: boolean;
  /** At least two unlocked elements are selected (alignable). */
  canAlign: boolean;
  /** The active slide holds at least one unlocked element. */
  canSelectAll: boolean;
  /** The single selected unlocked text element, when exactly one exists. */
  singleUnlockedText: TextElement | undefined;
  /** The single selected unlocked shape element, when exactly one exists. */
  singleUnlockedShape: ShapeElement | undefined;
}

export interface CommandActions {
  setToolMode: (mode: ToolMode) => void;
  undo: () => void;
  redo: () => void;
  addSlide: () => void;
  addSlideAfter: (slideId: string) => void;
  duplicateSlide: (slideId?: string) => void;
  deleteSlide: (slideId?: string) => void;
  duplicateSelection: () => void;
  deleteSelection: () => void;
  selectAll: () => void;
  align: (alignment: Alignment) => void;
  reorder: (direction: ElementOrderDirection) => void;
  textStyle: (style: TextStyle) => void;
  /**
   * Create a text element and open the canvas inline editor on it. Owned by
   * the canvas stage (which owns the editing session) and provided only on
   * the canvas menu context; the Text tool reaches the same flow directly.
   */
  addText?: (point?: { x: number; y: number }) => void;
  addShape: (point?: { x: number; y: number }) => void;
  /**
   * Enter the inline canvas text editor. Only provided by the canvas stage,
   * which owns the editing session; the edit-text command is menu-only.
   */
  editText?: (elementId: string) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomFit: () => void;
  toggleInspector: () => void;
  toggleDrawer: (kind: DrawerKind) => void;
  startPresent: () => void;
  exportPptx: () => void;
}

export interface CommandContext {
  snapshot: PresentationSnapshot;
  store: PresentationStore;
  activeSlideId: string;
  selectedIds: readonly string[];
  primaryElement: PresentationElement | undefined;
  selection: SelectionFlags;
  toolMode: ToolMode;
  inspectorOpen: boolean;
  /** The rendered zoom readout: fit scale times the session zoom, in percent. */
  zoomPercent: number;
  /** Whether the inspector panel can render at the current viewport width. */
  inspectorSupported: boolean;
  undoAvailable: boolean;
  redoAvailable: boolean;
  notify: (message: string) => void;
  /** The transient canvas-menu target; set only while the menu builds its items. */
  menuTarget: MenuTarget | null;
  /** The transient slide-rail target; set only while a thumbnail menu builds its items. */
  menuSlideId: string | undefined;
  actions: CommandActions;
}

export interface CommandDescriptor {
  /** Stable kebab id, e.g. 'arrange.send-backward'. */
  id: string;
  /** The one human label for all surfaces. */
  label: string;
  /** Optional context-dependent label (used by the inspector toggle). */
  labelText?: (ctx: CommandContext) => string;
  group: CommandGroup;
  /** Palette search terms. */
  keywords: string;
  /** 16px stroke icon id from command-icons.tsx (currentColor). */
  icon: CommandIconId;
  /** The surfaces this command may appear on. */
  surfaces: readonly CommandSurface[];
  /** Cluster for the session bar or the selection action bar. */
  barCluster?: BarCluster;
  shortcut?: Shortcut;
  /** Destructive styling everywhere (toolbar, menus, palette). */
  dangerous?: boolean;
  /** Which canvas menu the command belongs to; menus filter by the open target. */
  menuTarget?: 'element' | 'background';
  /** Render a separator before this item in menu surfaces. */
  menuSeparatorBefore?: boolean;
  /** Group this command under a titled submenu in the canvas menu. */
  menuSubmenu?: { title: string };
  /** Visibility gates: hiding surfaces (bar, menus) drop invisible commands entirely. */
  visibleWhen: (ctx: CommandContext) => boolean;
  /** Enablement gates: palette affordance + disabled style where hiding is wrong. */
  enabledWhen: (ctx: CommandContext) => boolean;
  /** For radio/toggle commands: checked state (tool modes, bold, inspector, drawers). */
  isChecked?: (ctx: CommandContext) => boolean;
  /** Reason line for disabled tooltips (the policy set only). */
  disabledReason?: (ctx: CommandContext) => string | undefined;
  run: (ctx: CommandContext) => void;
}

export type CommandState = 'enabled' | 'disabled';

export type CommandListItem = CommandDescriptor & { state: CommandState };

// --- Selection flags -----------------------------------------------------------

/** Pure selection derivation; the single way surfaces learn what applies. */
export function deriveSelectionFlags(slide: Slide | undefined, selectedIds: readonly string[]): SelectionFlags {
  const selected = selectedIds
    .map((id) => slide?.elements[id])
    .filter((element): element is PresentationElement => element !== undefined);
  const unlocked = selected.filter((element) => element.locked !== true);
  const unlockedText = unlocked.filter((element): element is TextElement => element.kind === 'text');
  const unlockedShape = unlocked.filter((element): element is ShapeElement => element.kind === 'shape');
  return {
    selectedCount: selected.length,
    unlockedCount: unlocked.length,
    hasUnlocked: unlocked.length > 0,
    canAlign: unlocked.length >= 2,
    canSelectAll: slide !== undefined && Object.values(slide.elements).some((element) => element.locked !== true),
    singleUnlockedText: unlockedText.length === 1 ? unlockedText[0] : undefined,
    singleUnlockedShape: unlockedShape.length === 1 ? unlockedShape[0] : undefined,
  };
}

// --- Shortcut data --------------------------------------------------------------

/**
 * Canonical, OS-neutral rendering: ⌘⇧Z on macOS, Ctrl+Shift+Z elsewhere.
 * The single renderer for tooltips, palette hints, and menu shortcut columns.
 */
export function formatShortcut(shortcut: Shortcut, platform: 'mac' | 'other'): string {
  return formatCombo(shortcut.keys, platform);
}

function formatCombo(keys: readonly ShortcutKey[], platform: 'mac' | 'other'): string {
  if (platform === 'mac') {
    return keys.map((key) => MAC_LABELS[key]).join('');
  }
  return keys.map((key) => OTHER_LABELS[key]).join('+');
}

const MAC_LABELS: Record<ShortcutKey, string> = {
  mod: '⌘',
  shift: '⇧',
  alt: '⌥',
  a: 'A',
  b: 'B',
  d: 'D',
  k: 'K',
  t: 'T',
  v: 'V',
  s: 'S',
  y: 'Y',
  z: 'Z',
  '0': '0',
  '1': '1',
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
  '6': '6',
  '7': '7',
  '8': '8',
  '9': '9',
  '+': '+',
  '-': '−',
  '=': '=',
  '[': '[',
  ']': ']',
  '/': '/',
  delete: 'Del',
  escape: 'Esc',
  enter: 'Enter',
  f2: 'F2',
  f5: 'F5',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
};

const OTHER_LABELS: Record<ShortcutKey, string> = {
  mod: 'Ctrl',
  shift: 'Shift',
  alt: 'Alt',
  a: 'A',
  b: 'B',
  d: 'D',
  k: 'K',
  t: 'T',
  v: 'V',
  s: 'S',
  y: 'Y',
  z: 'Z',
  '0': '0',
  '1': '1',
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
  '6': '6',
  '7': '7',
  '8': '8',
  '9': '9',
  '+': 'Plus',
  '-': 'Minus',
  '=': '=',
  '[': '[',
  ']': ']',
  '/': '/',
  delete: 'Del',
  escape: 'Esc',
  enter: 'Enter',
  f2: 'F2',
  f5: 'F5',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
};

/** Best-effort platform detection; the formatters themselves stay pure. */
export function detectPlatform(): 'mac' | 'other' {
  if (typeof navigator === 'undefined') {
    return 'other';
  }
  return /mac|iphone|ipad/i.test(navigator.platform) || /Mac/i.test(navigator.userAgent) ? 'mac' : 'other';
}

/** Whether a raw key (with modifiers) matches one of the shortcut's combos. */
export function shortcutMatchesKey(
  shortcut: Shortcut,
  modifiers: { alt: boolean; mod: boolean; shift: boolean },
  key: string,
): boolean {
  return comboMatches(shortcut.keys, modifiers, key) || (shortcut.alias ? comboMatches(shortcut.alias.keys, modifiers, key) : false);
}

function comboMatches(
  keys: readonly ShortcutKey[],
  modifiers: { alt: boolean; mod: boolean; shift: boolean },
  key: string,
): boolean {
  const comboKey = keys.find((entry) => entry !== 'mod' && entry !== 'shift' && entry !== 'alt');
  if (comboKey === undefined) {
    return false;
  }
  // The plus key is the shifted '=' on common layouts, so the shortcut `mod +`
  // is reached as mod+shift+'=' there and as mod+'=' on dedicated plus keys;
  // the shift bit is carried by the key itself and must not veto the match.
  const shiftOk = comboKey === '+' || modifiers.shift === keys.includes('shift');
  if (modifiers.mod !== keys.includes('mod') || !shiftOk || modifiers.alt !== keys.includes('alt')) {
    return false;
  }
  return rawKeyMatches(comboKey, key);
}

function rawKeyMatches(comboKey: ShortcutKey, key: string): boolean {
  switch (comboKey) {
    case 'delete':
      // Backspace is the Delete-key convention of PC keyboards.
      return key === 'Delete' || key === 'Backspace';
    case 'escape':
      return key === 'Escape';
    case 'enter':
      return key === 'Enter';
    case 'f2':
      return key === 'F2';
    case 'f5':
      return key === 'F5';
    case 'arrowup':
      return key === 'ArrowUp';
    case 'arrowdown':
      return key === 'ArrowDown';
    case 'arrowleft':
      return key === 'ArrowLeft';
    case 'arrowright':
      return key === 'ArrowRight';
    case '+':
      // The plus key is the shifted = on the common layouts.
      return key === '+' || key === '=';
    case '-':
      return key === '-';
    default:
      return key.toLowerCase() === comboKey;
  }
}

// --- Toolbar overflow planner -----------------------------------------------------

export interface ToolbarPlan {
  inline: readonly CommandListItem[];
  overflow: readonly CommandListItem[];
  /** Narrow widths drop the "Fit ·" prefix from the zoom readout. */
  compactZoom: boolean;
}

/**
 * Deterministic width-tier layout for the session bar. History, tools, and
 * zoom stay inline at every width. The inspector toggle sheds below
 * `INSPECTOR_MIN_VIEWPORT` (the same threshold that decides whether the
 * panel can render). Object clusters (edit/order/align/text) belong on the
 * selection surface, not this planner.
 */
export function planToolbarLayout(width: number, visible: readonly CommandListItem[]): ToolbarPlan {
  const inline: CommandListItem[] = [];
  const overflow: CommandListItem[] = [];
  for (const command of visible) {
    const keepInline = clusterStaysInline(command.barCluster, width);
    (keepInline ? inline : overflow).push(command);
  }
  return { inline, overflow, compactZoom: width < 1120 };
}

/**
 * The one viewport fact that owns the inspector toggle: the panel physically
 * renders only at or above this width, so the planner sheds the toggle below
 * it and the workspace collapses the panel below it — one threshold, two
 * consumers, no disabled inline toggle between 1120 and 1199.
 */
export const INSPECTOR_MIN_VIEWPORT = 1200;

function clusterStaysInline(cluster: BarCluster | undefined, width: number): boolean {
  return cluster === 'inspector' ? width >= INSPECTOR_MIN_VIEWPORT : true;
}

// --- Tooltip text ------------------------------------------------------------------

/** `Label (⌘D)` for enabled commands, `Label (⌘Z) - reason` for the policy set. */
export function commandTooltip(command: CommandDescriptor, ctx: CommandContext, state: CommandState, platform: 'mac' | 'other'): string {
  const shortcut = command.shortcut ? ` (${formatShortcut(command.shortcut, platform)})` : '';
  const reason = state === 'disabled' ? command.disabledReason?.(ctx) : undefined;
  return reason !== undefined ? `${command.label}${shortcut} - ${reason}` : `${command.label}${shortcut}`;
}

// --- Surface projection ---------------------------------------------------------------

/**
 * The one way surfaces read the registry. `bar` and `selection` return
 * visible commands only (inapplicable commands vanish instead of forming a
 * disabled wall); `menu`/`slide-menu` do the same with the open target
 * applied; `palette` returns every palette command regardless of visibility
 * (a search surface) and expresses inapplicability as the disabled state.
 */
export function commandsForSurface(ctx: CommandContext, surface: CommandSurface): readonly CommandListItem[] {
  let commands: readonly CommandDescriptor[];
  switch (surface) {
    case 'bar':
      commands = COMMANDS.filter((command) => command.surfaces.includes('bar') && command.visibleWhen(ctx));
      break;
    case 'selection':
      commands = COMMANDS.filter((command) => command.surfaces.includes('selection') && command.visibleWhen(ctx));
      break;
    case 'menu':
      commands = COMMANDS.filter(
        (command) => command.surfaces.includes('menu') && commandInMenu(command, ctx) && command.visibleWhen(ctx),
      );
      break;
    case 'slide-menu':
      commands = COMMANDS.filter((command) => command.surfaces.includes('slide-menu') && command.visibleWhen(ctx));
      break;
    case 'palette':
      commands = COMMANDS.filter((command) => command.surfaces.includes('palette'));
      break;
    case 'keys':
      // Only commands that currently apply fire at all: the active command
      // set, never a shadow list behind a modal or an editable surface.
      commands = COMMANDS.filter((command) => command.surfaces.includes('keys') && command.visibleWhen(ctx));
      break;
  }
  return commands.map((command) => ({ ...command, state: command.enabledWhen(ctx) ? 'enabled' : 'disabled' }));
}

function commandInMenu(command: CommandDescriptor, ctx: CommandContext): boolean {
  return command.menuTarget === undefined || ctx.menuTarget?.kind === command.menuTarget;
}

// --- The command table ---------------------------------------------------------------

const ZOOM_EPSILON = 1e-9;

const TOOL_COMMANDS: readonly CommandDescriptor[] = [
  {
    id: 'tool.select',
    label: 'Select',
    keywords: 'cursor move tool',
    group: 'tools',
    icon: 'cursor',
    surfaces: ['bar', 'palette', 'keys'],
    barCluster: 'tools',
    shortcut: { keys: ['v'] },
    visibleWhen: () => true,
    enabledWhen: () => true,
    isChecked: (ctx) => ctx.toolMode === 'select',
    run: (ctx) => ctx.actions.setToolMode('select'),
  },
  {
    id: 'tool.text',
    label: 'Text tool',
    keywords: 'type add',
    group: 'tools',
    icon: 'text',
    surfaces: ['bar', 'palette', 'keys'],
    barCluster: 'tools',
    shortcut: { keys: ['t'] },
    visibleWhen: () => true,
    enabledWhen: () => true,
    isChecked: (ctx) => ctx.toolMode === 'text',
    run: (ctx) => ctx.actions.setToolMode('text'),
  },
  {
    id: 'tool.shape',
    label: 'Shape tool',
    keywords: 'rectangle ellipse triangle diamond box add',
    group: 'tools',
    icon: 'shape',
    surfaces: ['bar', 'palette', 'keys'],
    barCluster: 'tools',
    shortcut: { keys: ['s'] },
    visibleWhen: () => true,
    enabledWhen: () => true,
    isChecked: (ctx) => ctx.toolMode === 'shape',
    run: (ctx) => ctx.actions.setToolMode('shape'),
  },
];

const EDIT_COMMANDS: readonly CommandDescriptor[] = [
  {
    id: 'edit.undo',
    label: 'Undo',
    keywords: 'revert back',
    group: 'edit',
    icon: 'undo',
    surfaces: ['bar', 'palette', 'keys'],
    barCluster: 'history',
    shortcut: { keys: ['mod', 'z'] },
    visibleWhen: () => true,
    enabledWhen: (ctx) => ctx.undoAvailable,
    disabledReason: () => 'nothing to undo yet',
    run: (ctx) => ctx.actions.undo(),
  },
  {
    id: 'edit.redo',
    label: 'Redo',
    keywords: 'reapply forward',
    group: 'edit',
    icon: 'redo',
    surfaces: ['bar', 'palette', 'keys'],
    barCluster: 'history',
    shortcut: { keys: ['mod', 'shift', 'z'], alias: { keys: ['mod', 'y'] } },
    visibleWhen: () => true,
    enabledWhen: (ctx) => ctx.redoAvailable,
    disabledReason: () => 'nothing to redo yet',
    run: (ctx) => ctx.actions.redo(),
  },
  {
    id: 'edit.duplicate',
    label: 'Duplicate',
    keywords: 'copy',
    group: 'edit',
    icon: 'copy',
    surfaces: ['selection', 'menu', 'palette', 'keys'],
    barCluster: 'edit',
    menuTarget: 'element',
    shortcut: { keys: ['mod', 'd'] },
    visibleWhen: (ctx) => ctx.selection.hasUnlocked,
    enabledWhen: (ctx) => ctx.selection.hasUnlocked,
    run: (ctx) => ctx.actions.duplicateSelection(),
  },
  {
    id: 'edit.delete',
    label: 'Delete',
    keywords: 'remove trash',
    group: 'edit',
    icon: 'trash',
    surfaces: ['selection', 'menu', 'palette', 'keys'],
    barCluster: 'edit',
    menuTarget: 'element',
    dangerous: true,
    shortcut: { keys: ['delete'] },
    visibleWhen: (ctx) => ctx.selection.hasUnlocked,
    enabledWhen: (ctx) => ctx.selection.hasUnlocked,
    run: (ctx) => ctx.actions.deleteSelection(),
  },
  {
    id: 'edit.select-all',
    label: 'Select all',
    keywords: 'select everything',
    group: 'edit',
    icon: 'select-all',
    surfaces: ['menu', 'palette', 'keys'],
    menuTarget: 'background',
    shortcut: { keys: ['mod', 'a'] },
    visibleWhen: () => true,
    enabledWhen: (ctx) => ctx.selection.canSelectAll,
    disabledReason: (ctx) => (ctx.selection.canSelectAll ? undefined : 'there are no elements to select'),
    run: (ctx) => ctx.actions.selectAll(),
  },
  {
    id: 'edit.edit-text',
    label: 'Edit text',
    keywords: 'edit text',
    group: 'edit',
    icon: 'edit',
    surfaces: ['menu'],
    menuTarget: 'element',
    shortcut: { keys: ['enter'] },
    visibleWhen: (ctx) => ctx.menuTarget?.kind === 'element' && ctx.snapshot.presentation.slides[ctx.activeSlideId].elements[ctx.menuTarget.elementId]?.kind === 'text',
    enabledWhen: (ctx) => {
      if (ctx.menuTarget?.kind !== 'element') {
        return false;
      }
      const element = ctx.snapshot.presentation.slides[ctx.activeSlideId].elements[ctx.menuTarget.elementId];
      return element?.kind === 'text' && element.locked !== true;
    },
    disabledReason: () => 'this text element is locked',
    run: (ctx) => {
      if (ctx.menuTarget?.kind === 'element') {
        ctx.actions.editText?.(ctx.menuTarget.elementId);
      }
    },
  },
  {
    id: 'edit.add-text',
    label: 'Add text',
    keywords: 'add text block',
    group: 'edit',
    icon: 'text',
    surfaces: ['menu'],
    menuTarget: 'background',
    visibleWhen: () => true,
    enabledWhen: () => true,
    run: (ctx) => ctx.actions.addText?.(ctx.menuTarget?.kind === 'background' ? ctx.menuTarget.point : undefined),
  },
  {
    id: 'edit.add-shape',
    label: 'Add shape',
    keywords: 'add shape rectangle',
    group: 'edit',
    icon: 'shape',
    surfaces: ['menu'],
    menuTarget: 'background',
    visibleWhen: () => true,
    enabledWhen: () => true,
    run: (ctx) => ctx.actions.addShape(ctx.menuTarget?.kind === 'background' ? ctx.menuTarget.point : undefined),
  },
];

const ARRANGE_ORDER_COMMANDS: readonly CommandDescriptor[] = [
  {
    id: 'arrange.order-front',
    label: 'Bring to front',
    keywords: 'order front z',
    group: 'arrange',
    icon: 'order-front',
    surfaces: ['selection', 'menu', 'palette', 'keys'],
    barCluster: 'order',
    menuTarget: 'element',
    menuSeparatorBefore: true,
    shortcut: { keys: ['mod', 'shift', ']'] },
    visibleWhen: (ctx) => ctx.selection.hasUnlocked,
    enabledWhen: (ctx) => ctx.selection.hasUnlocked,
    run: (ctx) => ctx.actions.reorder('front'),
  },
  {
    id: 'arrange.order-forward',
    label: 'Bring forward',
    keywords: 'order forward z',
    group: 'arrange',
    icon: 'order-forward',
    surfaces: ['selection', 'menu', 'palette', 'keys'],
    barCluster: 'order',
    menuTarget: 'element',
    shortcut: { keys: ['mod', ']'] },
    visibleWhen: (ctx) => ctx.selection.hasUnlocked,
    enabledWhen: (ctx) => ctx.selection.hasUnlocked,
    run: (ctx) => ctx.actions.reorder('forward'),
  },
  {
    id: 'arrange.order-backward',
    label: 'Send backward',
    keywords: 'order backward z',
    group: 'arrange',
    icon: 'order-backward',
    surfaces: ['selection', 'menu', 'palette', 'keys'],
    barCluster: 'order',
    menuTarget: 'element',
    shortcut: { keys: ['mod', '['] },
    visibleWhen: (ctx) => ctx.selection.hasUnlocked,
    enabledWhen: (ctx) => ctx.selection.hasUnlocked,
    run: (ctx) => ctx.actions.reorder('backward'),
  },
  {
    id: 'arrange.order-back',
    label: 'Send to back',
    keywords: 'order back z',
    group: 'arrange',
    icon: 'order-back',
    surfaces: ['selection', 'menu', 'palette', 'keys'],
    barCluster: 'order',
    menuTarget: 'element',
    shortcut: { keys: ['mod', 'shift', '['] },
    visibleWhen: (ctx) => ctx.selection.hasUnlocked,
    enabledWhen: (ctx) => ctx.selection.hasUnlocked,
    run: (ctx) => ctx.actions.reorder('back'),
  },
];

const ARRANGE_ALIGN_COMMANDS: readonly CommandDescriptor[] = [
  {
    id: 'arrange.align-left',
    label: 'Align left',
    keywords: 'align left edge',
    group: 'arrange',
    icon: 'align-left',
    surfaces: ['selection', 'menu', 'palette'],
    barCluster: 'align',
    menuTarget: 'element',
    menuSeparatorBefore: true,
    menuSubmenu: { title: 'Align' },
    visibleWhen: (ctx) => ctx.selection.canAlign,
    enabledWhen: (ctx) => ctx.selection.canAlign,
    run: (ctx) => ctx.actions.align('left'),
  },
  {
    id: 'arrange.align-centerh',
    menuSubmenu: { title: 'Align' },
    label: 'Center horizontally',
    keywords: 'align center horizontal',
    group: 'arrange',
    icon: 'align-centerh',
    surfaces: ['selection', 'menu', 'palette'],
    barCluster: 'align',
    menuTarget: 'element',
    visibleWhen: (ctx) => ctx.selection.canAlign,
    enabledWhen: (ctx) => ctx.selection.canAlign,
    run: (ctx) => ctx.actions.align('centerX'),
  },
  {
    id: 'arrange.align-right',
    menuSubmenu: { title: 'Align' },
    label: 'Align right',
    keywords: 'align right edge',
    group: 'arrange',
    icon: 'align-right',
    surfaces: ['selection', 'menu', 'palette'],
    barCluster: 'align',
    menuTarget: 'element',
    visibleWhen: (ctx) => ctx.selection.canAlign,
    enabledWhen: (ctx) => ctx.selection.canAlign,
    run: (ctx) => ctx.actions.align('right'),
  },
  {
    id: 'arrange.align-top',
    menuSubmenu: { title: 'Align' },
    label: 'Align top',
    keywords: 'align top edge',
    group: 'arrange',
    icon: 'align-top',
    surfaces: ['selection', 'menu', 'palette'],
    barCluster: 'align',
    menuTarget: 'element',
    visibleWhen: (ctx) => ctx.selection.canAlign,
    enabledWhen: (ctx) => ctx.selection.canAlign,
    run: (ctx) => ctx.actions.align('top'),
  },
  {
    id: 'arrange.align-centerv',
    menuSubmenu: { title: 'Align' },
    label: 'Center vertically',
    keywords: 'align center vertical',
    group: 'arrange',
    icon: 'align-centerv',
    surfaces: ['selection', 'menu', 'palette'],
    barCluster: 'align',
    menuTarget: 'element',
    visibleWhen: (ctx) => ctx.selection.canAlign,
    enabledWhen: (ctx) => ctx.selection.canAlign,
    run: (ctx) => ctx.actions.align('centerY'),
  },
  {
    id: 'arrange.align-bottom',
    menuSubmenu: { title: 'Align' },
    label: 'Align bottom',
    keywords: 'align bottom edge',
    group: 'arrange',
    icon: 'align-bottom',
    surfaces: ['selection', 'menu', 'palette'],
    barCluster: 'align',
    menuTarget: 'element',
    visibleWhen: (ctx) => ctx.selection.canAlign,
    enabledWhen: (ctx) => ctx.selection.canAlign,
    run: (ctx) => ctx.actions.align('bottom'),
  },
];

const TEXT_COMMANDS: readonly CommandDescriptor[] = [
  {
    id: 'text.bold',
    label: 'Bold',
    keywords: 'bold weight',
    group: 'text',
    icon: 'bold',
    surfaces: ['selection', 'palette', 'keys'],
    barCluster: 'text',
    shortcut: { keys: ['mod', 'b'] },
    visibleWhen: (ctx) => ctx.selection.singleUnlockedText !== undefined,
    enabledWhen: (ctx) => ctx.selection.singleUnlockedText !== undefined,
    isChecked: (ctx) => ctx.selection.singleUnlockedText?.style.fontWeight === 700,
    run: (ctx) => {
      const element = ctx.selection.singleUnlockedText;
      if (!element) {
        return;
      }
      ctx.actions.textStyle({
        ...element.style,
        fontWeight: element.style.fontWeight === 700 ? 400 : 700,
      });
    },
  },
  {
    id: 'text.align-left',
    label: 'Align text left',
    keywords: 'text align left',
    group: 'text',
    icon: 'text-align-left',
    surfaces: ['selection', 'palette'],
    barCluster: 'text',
    visibleWhen: (ctx) => ctx.selection.singleUnlockedText !== undefined,
    enabledWhen: (ctx) => ctx.selection.singleUnlockedText !== undefined,
    isChecked: (ctx) => ctx.selection.singleUnlockedText?.style.align === 'left',
    run: (ctx) => {
      const element = ctx.selection.singleUnlockedText;
      if (!element) {
        return;
      }
      ctx.actions.textStyle({ ...element.style, align: 'left' });
    },
  },
  {
    id: 'text.align-center',
    label: 'Align text center',
    keywords: 'text align center',
    group: 'text',
    icon: 'text-align-center',
    surfaces: ['selection', 'palette'],
    barCluster: 'text',
    visibleWhen: (ctx) => ctx.selection.singleUnlockedText !== undefined,
    enabledWhen: (ctx) => ctx.selection.singleUnlockedText !== undefined,
    isChecked: (ctx) => ctx.selection.singleUnlockedText?.style.align === 'center',
    run: (ctx) => {
      const element = ctx.selection.singleUnlockedText;
      if (!element) {
        return;
      }
      ctx.actions.textStyle({ ...element.style, align: 'center' });
    },
  },
  {
    id: 'text.align-right',
    label: 'Align text right',
    keywords: 'text align right',
    group: 'text',
    icon: 'text-align-right',
    surfaces: ['selection', 'palette'],
    barCluster: 'text',
    visibleWhen: (ctx) => ctx.selection.singleUnlockedText !== undefined,
    enabledWhen: (ctx) => ctx.selection.singleUnlockedText !== undefined,
    isChecked: (ctx) => ctx.selection.singleUnlockedText?.style.align === 'right',
    run: (ctx) => {
      const element = ctx.selection.singleUnlockedText;
      if (!element) {
        return;
      }
      ctx.actions.textStyle({ ...element.style, align: 'right' });
    },
  },
];

const SLIDE_COMMANDS: readonly CommandDescriptor[] = [
  {
    id: 'slide.add',
    label: 'Add slide',
    keywords: 'slide new append',
    group: 'slide',
    icon: 'plus',
    surfaces: ['palette'],
    visibleWhen: () => true,
    enabledWhen: () => true,
    run: (ctx) => ctx.actions.addSlide(),
  },
  {
    id: 'slide.add-after',
    label: 'Add slide after',
    keywords: 'slide new insert after',
    group: 'slide',
    icon: 'plus',
    surfaces: ['slide-menu'],
    visibleWhen: () => true,
    enabledWhen: () => true,
    run: (ctx) => (ctx.menuSlideId ? ctx.actions.addSlideAfter(ctx.menuSlideId) : ctx.actions.addSlide()),
  },
  {
    id: 'slide.duplicate',
    label: 'Duplicate slide',
    keywords: 'slide copy',
    group: 'slide',
    icon: 'copy',
    surfaces: ['slide-menu', 'palette'],
    visibleWhen: () => true,
    enabledWhen: () => true,
    run: (ctx) => ctx.actions.duplicateSlide(ctx.menuSlideId),
  },
  {
    id: 'slide.delete',
    label: 'Delete slide',
    keywords: 'slide remove',
    group: 'slide',
    icon: 'trash',
    surfaces: ['slide-menu', 'palette'],
    dangerous: true,
    menuSeparatorBefore: true,
    visibleWhen: () => true,
    enabledWhen: (ctx) => ctx.snapshot.presentation.slideOrder.length > 1,
    disabledReason: () => 'the final slide cannot be deleted',
    run: (ctx) => ctx.actions.deleteSlide(ctx.menuSlideId),
  },
];

const VIEW_COMMANDS: readonly CommandDescriptor[] = [
  {
    id: 'view.zoomin',
    label: 'Zoom in',
    keywords: 'zoom in larger',
    group: 'view',
    icon: 'zoom-in',
    surfaces: ['bar', 'palette', 'keys'],
    barCluster: 'zoom',
    shortcut: { keys: ['mod', '+'] },
    visibleWhen: () => true,
    enabledWhen: (ctx) => ctx.snapshot.session.zoom < MAX_SESSION_ZOOM - ZOOM_EPSILON,
    disabledReason: () => 'already at maximum zoom',
    run: (ctx) => ctx.actions.zoomIn(),
  },
  {
    id: 'view.zoomout',
    label: 'Zoom out',
    keywords: 'zoom out smaller',
    group: 'view',
    icon: 'zoom-out',
    surfaces: ['bar', 'palette', 'keys'],
    barCluster: 'zoom',
    shortcut: { keys: ['mod', '-'] },
    visibleWhen: () => true,
    enabledWhen: (ctx) => ctx.snapshot.session.zoom > MIN_SESSION_ZOOM + ZOOM_EPSILON,
    disabledReason: () => 'already at minimum zoom',
    run: (ctx) => ctx.actions.zoomOut(),
  },
  {
    id: 'view.zoomfit',
    label: 'Fit slide to window',
    keywords: 'zoom fit reset 100',
    group: 'view',
    icon: 'zoom-fit',
    surfaces: ['bar', 'palette', 'keys'],
    barCluster: 'zoom',
    shortcut: { keys: ['mod', '0'] },
    visibleWhen: () => true,
    enabledWhen: () => true,
    run: (ctx) => ctx.actions.zoomFit(),
  },
  {
    id: 'view.inspector',
    label: 'Inspector',
    keywords: 'inspector panel toggle',
    group: 'view',
    icon: 'inspector',
    surfaces: ['bar', 'palette'],
    barCluster: 'inspector',
    visibleWhen: () => true,
    // The panel physically collapses below the wide-viewport breakpoint, so
    // the toggle is honestly disabled there instead of opening nothing.
    enabledWhen: (ctx) => ctx.inspectorSupported,
    disabledReason: () => 'the inspector needs a wider window',
    isChecked: (ctx) => ctx.inspectorOpen,
    labelText: (ctx) => (ctx.inspectorOpen ? 'Hide inspector' : 'Show inspector'),
    run: (ctx) => ctx.actions.toggleInspector(),
  },
];

const PANEL_COMMANDS: readonly CommandDescriptor[] = [
  {
    id: 'panels.agent',
    label: 'Agent review',
    keywords: 'webmcp agent changes',
    group: 'panels',
    icon: 'agent',
    surfaces: ['palette'],
    visibleWhen: () => true,
    enabledWhen: () => true,
    run: (ctx) => ctx.actions.toggleDrawer('agent'),
  },
  {
    id: 'panels.comments',
    label: 'Comments',
    keywords: 'comments notes',
    group: 'panels',
    icon: 'comment',
    surfaces: ['palette'],
    visibleWhen: () => true,
    enabledWhen: () => true,
    run: (ctx) => ctx.actions.toggleDrawer('comments'),
  },
  {
    id: 'panels.activity',
    label: 'Activity',
    keywords: 'history changesets',
    group: 'panels',
    icon: 'activity',
    surfaces: ['palette'],
    visibleWhen: () => true,
    enabledWhen: () => true,
    run: (ctx) => ctx.actions.toggleDrawer('activity'),
  },
];

const FILE_COMMANDS: readonly CommandDescriptor[] = [
  {
    id: 'file.present',
    label: 'Present',
    keywords: 'slideshow fullscreen present',
    group: 'file',
    icon: 'play',
    surfaces: ['palette', 'keys'],
    shortcut: { keys: ['f5'] },
    visibleWhen: () => true,
    enabledWhen: () => true,
    run: (ctx) => ctx.actions.startPresent(),
  },
  {
    id: 'file.export',
    label: 'Export PowerPoint (.pptx)',
    keywords: 'export powerpoint download pptx',
    group: 'file',
    icon: 'download',
    surfaces: ['palette'],
    visibleWhen: () => true,
    enabledWhen: () => true,
    run: (ctx) => ctx.actions.exportPptx(),
  },
];

/** The one command table, in registration order (bar layout + palette sections). */
export const COMMANDS: readonly CommandDescriptor[] = [
  ...TOOL_COMMANDS,
  ...EDIT_COMMANDS,
  ...ARRANGE_ORDER_COMMANDS,
  ...ARRANGE_ALIGN_COMMANDS,
  ...TEXT_COMMANDS,
  ...SLIDE_COMMANDS,
  ...VIEW_COMMANDS,
  ...PANEL_COMMANDS,
  ...FILE_COMMANDS,
];