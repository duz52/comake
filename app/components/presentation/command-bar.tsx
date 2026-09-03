import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Menu } from '@base-ui/react/menu';
import { Tooltip } from '../ui/tooltip';
import type { ShapeGeometry } from '../../types/presentation';
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
import { shapeGeometryForKind } from './commands';
import { SHAPE_GEOMETRY_OPTIONS } from './shape-style-utils';

export type { ToolMode } from './command-registry';

/**
 * The session command bar: history, canvas tools (Select / Text / Shape with
 * a geometry menu), zoom, and inspector. Object commands live on the
 * selection action bar. The deterministic planner (`planToolbarLayout`) sheds
 * the inspector toggle to overflow below the inline-column viewport.
 */

const CLUSTER_SEQUENCE: ReadonlyArray<{ cluster: BarCluster; dividerBefore?: boolean }> = [
  { cluster: 'history' },
  { cluster: 'tools', dividerBefore: true },
];

export function CommandBar({
  ctx,
  menuEpoch,
  onPendingShapeGeometryChange,
  pendingShapeGeometry,
}: {
  ctx: CommandContext;
  menuEpoch: number;
  onPendingShapeGeometryChange: (geometry: ShapeGeometry) => void;
  pendingShapeGeometry: ShapeGeometry;
}) {
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
            menuEpoch={menuEpoch}
            onPendingShapeGeometryChange={onPendingShapeGeometryChange}
            pendingShapeGeometry={pendingShapeGeometry}
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
        <OverflowMenu commands={plan.overflow} ctx={ctx} menuEpoch={menuEpoch} platform={platform} />
      ) : null}
    </div>
  );
}

function BarClusterGroup({
  cluster,
  commands,
  ctx,
  dividerBefore,
  menuEpoch,
  onPendingShapeGeometryChange,
  pendingShapeGeometry,
  platform,
}: {
  cluster: BarCluster;
  commands: readonly CommandListItem[];
  ctx: CommandContext;
  dividerBefore?: boolean;
  menuEpoch: number;
  onPendingShapeGeometryChange: (geometry: ShapeGeometry) => void;
  pendingShapeGeometry: ShapeGeometry;
  platform: 'mac' | 'other';
}) {
  return (
    <>
      {dividerBefore ? <div className="cmd-divider" aria-hidden="true" /> : null}
      {cluster === 'tools' ? (
        <div aria-label="Canvas tool" className="cmd-group" role="radiogroup">
          {commands.map((command) =>
            command.id === 'tool.shape' ? (
              <ShapeSplitTool
                command={command}
                ctx={ctx}
                key={command.id}
                menuEpoch={menuEpoch}
                onPendingShapeGeometryChange={onPendingShapeGeometryChange}
                pendingShapeGeometry={pendingShapeGeometry}
                platform={platform}
              />
            ) : (
              <ToolRadio command={command} ctx={ctx} key={command.id} platform={platform} />
            ),
          )}
        </div>
      ) : (
        <div className="cmd-group">
          {commands.map((command) => (
            <BarCommandButton command={command} ctx={ctx} key={command.id} platform={platform} />
          ))}
        </div>
      )}
    </>
  );
}

function ToolRadio({
  command,
  ctx,
  platform,
}: {
  command: CommandListItem;
  ctx: CommandContext;
  platform: 'mac' | 'other';
}) {
  const tooltip = commandTooltip(command, ctx, command.state, platform);
  return (
    <Tooltip content={tooltip}>
      <button
        aria-checked={command.isChecked?.(ctx) ?? false}
        className="tool-seg"
        onClick={() => command.run(ctx)}
        role="radio"
        type="button"
      >
        <CommandIcon icon={command.icon} />
        {command.label}
      </button>
    </Tooltip>
  );
}

function ShapeSplitTool({
  command,
  ctx,
  menuEpoch,
  onPendingShapeGeometryChange,
  pendingShapeGeometry,
  platform,
}: {
  command: CommandListItem;
  ctx: CommandContext;
  menuEpoch: number;
  onPendingShapeGeometryChange: (geometry: ShapeGeometry) => void;
  pendingShapeGeometry: ShapeGeometry;
  platform: 'mac' | 'other';
}) {
  const tooltip = commandTooltip(command, ctx, command.state, platform);
  const [shapeMenuOpen, setShapeMenuOpen] = useDismissableMenuOpen(menuEpoch);
  return (
    <div className="tool-split">
      <Tooltip content={tooltip}>
        <button
          aria-checked={command.isChecked?.(ctx) ?? false}
          className="tool-seg"
          onClick={() => command.run(ctx)}
          role="radio"
          type="button"
        >
          <CommandIcon icon={command.icon} />
          {command.label}
        </button>
      </Tooltip>
      <Menu.Root onOpenChange={setShapeMenuOpen} open={shapeMenuOpen}>
        <Tooltip content="Shape geometry">
          <Menu.Trigger
            aria-label="Shape geometry"
            className="tool-seg-chevron"
            render={<button type="button" />}
          >
            <span aria-hidden="true">▾</span>
          </Menu.Trigger>
        </Tooltip>
        <Menu.Portal>
          <Menu.Positioner className="popup-positioner" align="start" sideOffset={4}>
            <Menu.Popup className="bar-menu">
              <Menu.RadioGroup value={pendingShapeGeometry.kind}>
                {SHAPE_GEOMETRY_OPTIONS.map((option) => (
                  <Menu.RadioItem
                    className="bar-menu-item"
                    closeOnClick
                    key={option.kind}
                    label={option.label}
                    onClick={() => {
                      onPendingShapeGeometryChange(shapeGeometryForKind(option.kind));
                      ctx.actions.setToolMode('shape');
                    }}
                    value={option.kind}
                  >
                    <span>{option.label}</span>
                    <Menu.RadioItemIndicator className="bar-menu-key">
                      ✓
                    </Menu.RadioItemIndicator>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
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
  const disabled = command.state === 'disabled';
  const tooltip = commandTooltip(command, ctx, command.state, platform);
  const label = command.labelText ? command.labelText(ctx) : command.label;
  const classes = ['cmd-button'];
  if (checked) {
    classes.push('is-active');
  }
  if (command.dangerous) {
    classes.push('is-danger');
  }
  return (
    <>
      {dividerBefore ? <div className="cmd-divider" aria-hidden="true" /> : null}
      <Tooltip content={tooltip} wrapDisabled={disabled}>
        <button
          aria-label={disabled ? tooltip : undefined}
          aria-pressed={checked || undefined}
          className={classes.join(' ')}
          disabled={disabled}
          onClick={() => command.run(ctx)}
          type="button"
        >
          <CommandIcon icon={command.icon} />
          <span>{label}</span>
        </button>
      </Tooltip>
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
  const disabled = command?.state === 'disabled';
  const tooltip = command ? commandTooltip(command, ctx, command.state, platform) : label;
  return (
    <Tooltip content={tooltip} wrapDisabled={disabled}>
      <button
        aria-label={disabled ? tooltip : label}
        className="zoom-button"
        disabled={disabled}
        onClick={() => command?.run(ctx)}
        type="button"
      >
        {children}
      </button>
    </Tooltip>
  );
}

/**
 * Occupying a right-side overlay increments `menuEpoch`. Resetting `open`
 * during that render closes the popup in the same commit without remounting
 * the trigger, so overlay focus restore still has a connected opener.
 */
function useDismissableMenuOpen(epoch: number): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  const [seenEpoch, setSeenEpoch] = useState(epoch);
  if (seenEpoch !== epoch) {
    setSeenEpoch(epoch);
    setOpen(false);
  }
  return [open, setOpen];
}

function OverflowMenu({
  commands,
  ctx,
  menuEpoch,
  platform,
}: {
  commands: readonly CommandListItem[];
  ctx: CommandContext;
  menuEpoch: number;
  platform: 'mac' | 'other';
}) {
  const [open, setOpen] = useDismissableMenuOpen(menuEpoch);
  return (
    <Menu.Root onOpenChange={setOpen} open={open}>
      <Tooltip content="More commands">
        <Menu.Trigger
          aria-label="More commands"
          className="toolbar-more"
          render={<button type="button" />}
        >
          <CommandIcon icon="ellipsis" />
        </Menu.Trigger>
      </Tooltip>
      <Menu.Portal>
        <Menu.Positioner className="popup-positioner" align="end" sideOffset={4}>
          <Menu.Popup className="bar-menu">
            {commands.map((command) => {
              const label = command.labelText ? command.labelText(ctx) : command.label;
              if (command.labelText) {
                const checked = command.isChecked?.(ctx) ?? false;
                return (
                  <Menu.CheckboxItem
                    checked={checked}
                    className={`bar-menu-item${checked ? ' is-active' : ''}${command.dangerous ? ' is-danger' : ''}`}
                    closeOnClick
                    disabled={command.state === 'disabled'}
                    key={command.id}
                    label={label}
                    onCheckedChange={() => command.run(ctx)}
                  >
                    <CommandIcon className="bar-menu-icon" icon={command.icon} />
                    <span>{label}</span>
                    {command.shortcut ? (
                      <span aria-label="Shortcut" className="bar-menu-key">
                        {formatShortcut(command.shortcut, platform)}
                      </span>
                    ) : null}
                  </Menu.CheckboxItem>
                );
              }
              return (
                <Menu.Item
                  className={`bar-menu-item${command.dangerous ? ' is-danger' : ''}`}
                  disabled={command.state === 'disabled'}
                  key={command.id}
                  onClick={() => command.run(ctx)}
                >
                  <CommandIcon className="bar-menu-icon" icon={command.icon} />
                  <span>{label}</span>
                  {command.shortcut ? (
                    <span aria-label="Shortcut" className="bar-menu-key">
                      {formatShortcut(command.shortcut, platform)}
                    </span>
                  ) : null}
                </Menu.Item>
              );
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
