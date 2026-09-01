import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Menu } from '@base-ui/react/menu';
import {
  commandsForSurface,
  commandTooltip,
  detectPlatform,
  formatShortcut,
  planToolbarLayout,
  type BarCluster,
  type CommandContext,
  type CommandListItem,
  type ToolMode,
} from './command-registry';
import { CommandIcon } from './command-icons';

export type { ToolMode } from './command-registry';

/**
 * The command bar, rebuilt from the single registry. Persistent clusters
 * (history, tools, Duplicate/Delete, zoom, Inspector) plus contextual
 * clusters that appear only when they apply; the deterministic width-tier
 * planner (`planToolbarLayout`) moves the contextual clusters into the ⋯
 * overflow menu below 1280/1160/1120 px instead of clipping or scrolling.
 * No local command arrays, no duplicated labels or shortcut strings.
 */

const CLUSTER_SEQUENCE: ReadonlyArray<{ cluster: BarCluster; dividerBefore?: boolean }> = [
  { cluster: 'history' },
  { cluster: 'tools', dividerBefore: true },
  { cluster: 'edit', dividerBefore: true },
  { cluster: 'order', dividerBefore: true },
  { cluster: 'align', dividerBefore: true },
  { cluster: 'text', dividerBefore: true },
];

/** Clusters whose buttons are icon-only 28px controls (tooltip + aria-label). */
const ICON_ONLY_CLUSTERS: ReadonlySet<BarCluster> = new Set(['order', 'align', 'text']);

export function CommandBar({ ctx }: { ctx: CommandContext }) {
  const barRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const platform = detectPlatform();

  // The bar measures itself; the pure planner decides the layout from the
  // available width, never from measuring item widths.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) {
      return;
    }
    const measure = (): void => {
      setWidth((current) => (current === bar.clientWidth ? current : bar.clientWidth));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  const visible = commandsForSurface(ctx, 'bar');
  const plan = planToolbarLayout(width, visible);

  const inlineByCluster = new Map<BarCluster, CommandListItem[]>();
  for (const command of plan.inline) {
    const cluster = command.barCluster ?? 'tools';
    const list = inlineByCluster.get(cluster) ?? [];
    list.push(command);
    inlineByCluster.set(cluster, list);
  }

  return (
    <div aria-label="Editor commands" className="command-bar" ref={barRef} role="toolbar">
      {CLUSTER_SEQUENCE.map(({ cluster, dividerBefore }) => {
        const commands = inlineByCluster.get(cluster);
        if (!commands || commands.length === 0) {
          return null;
        }
        return (
          <BarClusterGroup
            cluster={cluster}
            commands={commands}
            ctx={ctx}
            dividerBefore={dividerBefore}
            key={cluster}
            platform={platform}
          />
        );
      })}

      <div className="spacer" aria-hidden="true" />

      <ZoomGroup
        compact={plan.compactZoom}
        commands={visible}
        ctx={ctx}
        platform={platform}
        zoomPercent={ctx.zoomPercent}
      />

      {(inlineByCluster.get('inspector') ?? []).map((command) => (
        <BarCommandButton
          command={command}
          ctx={ctx}
          dividerBefore
          key={command.id}
          platform={platform}
        />
      ))}

      {plan.overflow.length > 0 ? (
        <OverflowMenu commands={plan.overflow} ctx={ctx} platform={platform} />
      ) : null}
    </div>
  );
}

function BarClusterGroup({
  cluster,
  commands,
  ctx,
  dividerBefore,
  platform,
}: {
  cluster: BarCluster;
  commands: readonly CommandListItem[];
  ctx: CommandContext;
  dividerBefore?: boolean;
  platform: 'mac' | 'other';
}) {
  return (
    <>
      {dividerBefore ? <div className="cmd-divider" aria-hidden="true" /> : null}
      {cluster === 'tools' ? (
        <div aria-label="Canvas tool" className="cmd-group" role="radiogroup">
          {commands.map((command) => (
            <button
              aria-checked={command.isChecked?.(ctx) ?? false}
              className="tool-seg"
              key={command.id}
              onClick={() => command.run(ctx)}
              role="radio"
              title={commandTooltip(command, ctx, command.state, platform)}
              type="button"
            >
              <CommandIcon icon={command.icon} />
              {command.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="cmd-group">
          {commands.map((command, index) => (
            <BarCommandButton
              command={command}
              ctx={ctx}
              // Duplicate and Delete sit in one cluster with a divider between.
              dividerBefore={cluster === 'edit' && index > 0}
              key={command.id}
              platform={platform}
            />
          ))}
        </div>
      )}
    </>
  );
}

function BarCommandButton({
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
  const iconOnly = ICON_ONLY_CLUSTERS.has(command.barCluster ?? 'tools');
  const classes = ['cmd-button'];
  if (checked) {
    classes.push('is-active');
  }
  if (command.dangerous) {
    classes.push('is-danger');
  }
  if (iconOnly) {
    classes.push('cmd-icon-button');
  }
  return (
    <>
      {dividerBefore ? <div className="cmd-divider" aria-hidden="true" /> : null}
      <button
        aria-label={iconOnly ? command.label : undefined}
        aria-pressed={checked || undefined}
        className={classes.join(' ')}
        disabled={command.state === 'disabled'}
        onClick={() => command.run(ctx)}
        title={commandTooltip(command, ctx, command.state, platform)}
        type="button"
      >
        <CommandIcon icon={command.icon} />
        {iconOnly ? null : <span>{command.label}</span>}
      </button>
    </>
  );
}

function ZoomGroup({
  compact,
  commands,
  ctx,
  platform,
  zoomPercent,
}: {
  compact: boolean;
  /** The bar's visible commands, computed once by the caller. */
  commands: readonly CommandListItem[];
  ctx: CommandContext;
  platform: 'mac' | 'other';
  zoomPercent: number;
}) {
  const zoomOut = commands.find((command) => command.id === 'view.zoomout');
  const zoomFit = commands.find((command) => command.id === 'view.zoomfit');
  const zoomIn = commands.find((command) => command.id === 'view.zoomin');
  const readout =
    !compact && ctx.snapshot.session.zoom === 1 ? `Fit · ${zoomPercent}%` : `${zoomPercent}%`;

  return (
    <div className="zoom-group">
      <ZoomButton command={zoomOut} ctx={ctx} label="Zoom out" platform={platform}>
        −
      </ZoomButton>
      <ZoomButton command={zoomFit} ctx={ctx} label="Reset zoom to fit" platform={platform}>
        <span className="zoom-value">{readout}</span>
      </ZoomButton>
      <ZoomButton command={zoomIn} ctx={ctx} label="Zoom in" platform={platform}>
        +
      </ZoomButton>
    </div>
  );
}

function ZoomButton({
  children,
  command,
  ctx,
  label,
  platform,
}: {
  children: ReactNode;
  command: CommandListItem | undefined;
  ctx: CommandContext;
  label: string;
  platform: 'mac' | 'other';
}) {
  return (
    <button
      aria-label={label}
      className="zoom-button"
      disabled={command?.state === 'disabled'}
      onClick={() => command?.run(ctx)}
      title={command ? commandTooltip(command, ctx, command.state, platform) : label}
      type="button"
    >
      {children}
    </button>
  );
}

function OverflowMenu({
  commands,
  ctx,
  platform,
}: {
  commands: readonly CommandListItem[];
  ctx: CommandContext;
  platform: 'mac' | 'other';
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="More commands"
        className="toolbar-more"
        render={<button type="button" />}
        title="More commands"
      >
        <CommandIcon icon="ellipsis" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="popup-positioner" align="end" sideOffset={4}>
          <Menu.Popup className="bar-menu">
            {commands.map((command) => (
              <Menu.Item
                className={`bar-menu-item${command.dangerous ? ' is-danger' : ''}`}
                disabled={command.state === 'disabled'}
                key={command.id}
                onClick={() => command.run(ctx)}
              >
                <CommandIcon className="bar-menu-icon" icon={command.icon} />
                <span>{command.label}</span>
                {command.shortcut ? (
                  <span aria-label="Shortcut" className="bar-menu-key">
                    {formatShortcut(command.shortcut, platform)}
                  </span>
                ) : null}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}