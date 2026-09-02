import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent, Ref } from 'react';
import { Tooltip } from '../ui/tooltip';
import {
  commandsForSurface,
  commandTooltip,
  detectPlatform,
  type BarCluster,
  type CommandContext,
  type CommandListItem,
} from './command-registry';
import { CommandIcon } from './command-icons';
import type { SelectionBarBox } from './selection-bar-placement';

export type { SelectionBarBox } from './selection-bar-placement';

const CLUSTER_SEQUENCE: ReadonlyArray<{ cluster: BarCluster; dividerBefore?: boolean }> = [
  { cluster: 'edit' },
  { cluster: 'order', dividerBefore: true },
  { cluster: 'align', dividerBefore: true },
  { cluster: 'text', dividerBefore: true },
];

/**
 * Selection-anchored action bar: a projection of the registry `selection`
 * surface. Placement (CSS box) is owned by the canvas; this component never
 * dispatches except by calling `command.run(ctx)`.
 */
export function SelectionActionBar({
  box,
  ctx,
  ref,
}: {
  box: SelectionBarBox;
  ctx: CommandContext;
  ref?: Ref<HTMLDivElement>;
}) {
  const platform = detectPlatform();
  const commands = commandsForSurface(ctx, 'selection');
  if (commands.length === 0) {
    return null;
  }

  const byCluster = new Map<BarCluster, CommandListItem[]>();
  for (const command of commands) {
    const cluster = command.barCluster ?? 'edit';
    const list = byCluster.get(cluster) ?? [];
    list.push(command);
    byCluster.set(cluster, list);
  }

  return (
    <div
      aria-label="Selection"
      className="selection-bar"
      onClick={stopCanvasEvent}
      onContextMenu={stopCanvasEvent}
      onDoubleClick={stopCanvasEvent}
      onPointerDown={stopCanvasEvent}
      ref={ref}
      role="toolbar"
      style={{ left: box.left, top: box.top }}
    >
      {CLUSTER_SEQUENCE.map(({ cluster, dividerBefore }) => {
        const clusterCommands = byCluster.get(cluster);
        if (!clusterCommands || clusterCommands.length === 0) {
          return null;
        }
        return (
          <div className="cmd-group" key={cluster}>
            {dividerBefore ? <div aria-hidden="true" className="cmd-divider" /> : null}
            {clusterCommands.map((command, index) => (
              <SelectionCommandButton
                command={command}
                ctx={ctx}
                dividerBefore={cluster === 'edit' && index > 0}
                key={command.id}
                platform={platform}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function SelectionCommandButton({
  command,
  ctx,
  dividerBefore,
  platform,
}: {
  command: CommandListItem;
  ctx: CommandContext;
  dividerBefore?: boolean;
  platform: 'mac' | 'other';
}) {
  const checked = command.isChecked?.(ctx) ?? false;
  const disabled = command.state === 'disabled';
  const tooltip = commandTooltip(command, ctx, command.state, platform);
  const classes = ['cmd-button', 'cmd-icon-button'];
  if (checked) {
    classes.push('is-active');
  }
  if (command.dangerous) {
    classes.push('is-danger');
  }
  return (
    <>
      {dividerBefore ? <div aria-hidden="true" className="cmd-divider" /> : null}
      <Tooltip content={tooltip} wrapDisabled={disabled}>
        <button
          aria-label={command.label}
          aria-pressed={checked || undefined}
          className={classes.join(' ')}
          disabled={disabled}
          onClick={() => command.run(ctx)}
          type="button"
        >
          <CommandIcon icon={command.icon} />
        </button>
      </Tooltip>
    </>
  );
}

function stopCanvasEvent(event: ReactPointerEvent | ReactMouseEvent): void {
  event.stopPropagation();
}
