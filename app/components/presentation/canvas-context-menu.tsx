import { ContextMenu } from '@base-ui/react/context-menu';
import type { ReactElement, ReactNode, MouseEvent } from 'react';
import {
  commandsForSurface,
  detectPlatform,
  formatShortcut,
  type CommandContext,
  type CommandListItem,
  type MenuTarget,
} from './command-registry';
import { CommandIcon } from './command-icons';

declare module 'react' {
  interface SyntheticEvent {
    /**
     * Base UI injects this escape hatch on the merged synthetic event of a
     * composite handler: calling it prevents that component's own handler
     * from running after ours.
     */
    preventBaseUIHandler?: () => void;
  }
}

export type CanvasMenuTarget = MenuTarget;

interface CanvasContextMenuProps {
  /**
   * The registry context of the open menu, including the transient
   * `menuTarget`. Items, labels, shortcuts, and separators all come from
   * `commandsForSurface(ctx, 'menu')`.
   */
  ctx: CommandContext;
  /** The trigger surface (the slide frame); {ContextMenu.Trigger} borrows it via its render prop. */
  render: ReactElement;
  /** Runs before the menu opens: selection policy plus the target capture. */
  onContextMenu: (event: MouseEvent) => void;
  onOpenChange: (open: boolean) => void;
  /** Resolves where focus returns when the menu closes; false leaves focus alone. */
  finalFocus?: () => HTMLElement | false;
}

/**
 * The canvas right-click menu, built on Base UI's ContextMenu primitive and
 * driven entirely by the command registry: the open target decides the
 * element vs background menu, items filter by `visibleWhen`, and the align
 * commands form one submenu. Selection-before-open and focus restoration
 * stay with CanvasStage.
 */
export function CanvasContextMenu({ ctx, finalFocus, onContextMenu, onOpenChange, render }: CanvasContextMenuProps) {
  const commands = commandsForSurface(ctx, 'menu');
  const platform = detectPlatform();
  return (
    <ContextMenu.Root onOpenChange={onOpenChange}>
      <ContextMenu.Trigger onContextMenu={onContextMenu} render={render} />
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="popup-positioner" alignOffset={-4} sideOffset={-4}>
          <ContextMenu.Popup className="ctx-menu" finalFocus={finalFocus}>
            <MenuCommandItems commands={commands} ctx={ctx} platform={platform} />
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/** Renders the item list, grouping submenu commands under their titled submenu. */
function MenuCommandItems({
  commands,
  ctx,
  platform,
  inSubmenu = false,
}: {
  commands: readonly CommandListItem[];
  ctx: CommandContext;
  platform: 'mac' | 'other';
  inSubmenu?: boolean;
}) {
  const nodes: ReactNode[] = [];
  let submenu: { commands: CommandListItem[]; title: string } | null = null;
  for (const command of commands) {
    if (command.menuSubmenu) {
      if (!submenu) {
        if (!inSubmenu && command.menuSeparatorBefore) {
          nodes.push(<ContextMenu.Separator className="ctx-separator" key={`sep-${command.id}`} />);
        }
        submenu = { title: command.menuSubmenu.title, commands: [] };
        nodes.push(
          <ContextMenu.SubmenuRoot key={`submenu-${command.menuSubmenu.title}`}>
            <ContextMenu.SubmenuTrigger className="ctx-item">
              <span>{command.menuSubmenu.title}</span>
              <span aria-hidden="true" className="ctx-caret">
                ›
              </span>
            </ContextMenu.SubmenuTrigger>
            <ContextMenu.Portal>
              <ContextMenu.Positioner className="popup-positioner" alignOffset={-4} sideOffset={-4}>
                <ContextMenu.Popup className="ctx-menu">
                  <MenuCommandItems commands={submenu.commands} ctx={ctx} inSubmenu platform={platform} />
                </ContextMenu.Popup>
              </ContextMenu.Positioner>
            </ContextMenu.Portal>
          </ContextMenu.SubmenuRoot>,
        );
      }
      submenu.commands.push(command);
      continue;
    }
    submenu = null;
    if (!inSubmenu && command.menuSeparatorBefore) {
      nodes.push(<ContextMenu.Separator className="ctx-separator" key={`sep-${command.id}`} />);
    }
    nodes.push(
      <ContextMenu.Item
        className={`ctx-item${command.dangerous ? ' is-danger' : ''}`}
        disabled={command.state === 'disabled'}
        key={command.id}
        onClick={() => command.run(ctx)}
      >
        <span className="ctx-item-label">
          <CommandIcon className="ctx-item-icon" icon={command.icon} />
          {command.label}
        </span>
        {command.shortcut ? (
          <span aria-hidden="true" className="ctx-shortcut">
            {formatShortcut(command.shortcut, platform)}
          </span>
        ) : null}
      </ContextMenu.Item>,
    );
  }
  return <>{nodes}</>;
}