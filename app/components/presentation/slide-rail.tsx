import { ContextMenu } from '@base-ui/react/context-menu';
import { Menu } from '@base-ui/react/menu';
import {
  commandsForSurface,
  detectPlatform,
  formatShortcut,
  type CommandContext,
  type CommandListItem,
} from './command-registry';
import { CommandIcon } from './command-icons';
import { SlideArtwork } from './slide-artwork';
import { slideDisplayName } from './slide-label';

/**
 * The dense slide rail: numbered thumbnails with the active slide marked, a
 * single truthful ⋯ menu per thumbnail (and the same menu on right-click),
 * and the primary Add slide button at the bottom. Every action is a registry
 * command; no hover glyph pairs.
 */
export function SlideRail({
  ctx,
  onOpenSlide,
}: {
  ctx: CommandContext;
  onOpenSlide: (slideId: string) => void;
}) {
  const slideOrder = ctx.snapshot.presentation.slideOrder;
  const platform = detectPlatform();

  return (
    <aside aria-label="Slides" className="slide-rail">
      <div className="rail-head">
        <span className="rail-head-label">Slides</span>
        <span className="rail-head-count">{slideOrder.length}</span>
      </div>
      <div className="rail-scroll">
        {slideOrder.map((slideId, index) => (
          <SlideThumbnail
            ctx={ctx}
            index={index}
            key={slideId}
            onOpenSlide={onOpenSlide}
            platform={platform}
            slideId={slideId}
          />
        ))}
      </div>
      <button
        aria-label="Add slide"
        className="rail-add"
        onClick={() => ctx.actions.addSlide()}
        title="Append a slide at the end"
        type="button"
      >
        + Add slide
      </button>
    </aside>
  );
}

function SlideThumbnail({
  ctx,
  index,
  onOpenSlide,
  platform,
  slideId,
}: {
  ctx: CommandContext;
  index: number;
  onOpenSlide: (slideId: string) => void;
  platform: 'mac' | 'other';
  slideId: string;
}) {
  const slide = ctx.snapshot.presentation.slides[slideId];
  const active = slideId === ctx.activeSlideId;
  const displayName = slideDisplayName(slide);
  // The registry context of this thumbnail: its own slide is the menu target.
  const menuCtx: CommandContext = { ...ctx, menuSlideId: slideId };
  const commands = commandsForSurface(menuCtx, 'slide-menu');

  const thumbnail = (
    <div
      aria-current={active ? 'true' : undefined}
      aria-label={`Slide ${index + 1}: ${displayName}`}
      className={`slide-item${active ? ' is-active' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onOpenSlide(slideId)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          // The ⋯ trigger owns its own keys: activation must open the slide
          // menu, never navigate the thumbnail from the same keypress.
          if (event.target instanceof HTMLElement && event.target.closest('.slide-item-more')) {
            return;
          }
          event.preventDefault();
          onOpenSlide(slideId);
        }
      }}
    >
      <span className="thumb-num">{String(index + 1).padStart(2, '0')}</span>
      <div className="thumb-preview">
        <SlideArtwork slideId={slideId} snapshot={ctx.snapshot} />
      </div>
      <span className="thumb-name">{displayName}</span>
      <Menu.Root>
        <Menu.Trigger
          aria-label={`Menu for slide ${index + 1}`}
          className="slide-item-more"
          onClick={(event) => event.stopPropagation()}
          render={<button type="button" />}
          title={`Actions for ${displayName}`}
        >
          <CommandIcon icon="ellipsis" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner className="popup-positioner" align="end" side="bottom" sideOffset={2}>
            <Menu.Popup className="ctx-menu" finalFocus={() => false}>
              <SlideMenuItems commands={commands} ctx={menuCtx} platform={platform} />
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger render={thumbnail} />
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="popup-positioner" alignOffset={-4} sideOffset={-4}>
          <ContextMenu.Popup className="ctx-menu">
            <SlideMenuItems commands={commands} ctx={menuCtx} platform={platform} />
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/** The shared item list of the per-thumbnail ⋯ and right-click menus. */
function SlideMenuItems({
  commands,
  ctx,
  platform,
}: {
  commands: readonly CommandListItem[];
  ctx: CommandContext;
  platform: 'mac' | 'other';
}) {
  return (
    <>
      {commands.map((command) => (
        <span key={command.id}>
          {command.menuSeparatorBefore ? <Menu.Separator className="ctx-separator" /> : null}
          <Menu.Item
            className={`ctx-item${command.dangerous ? ' is-danger' : ''}`}
            disabled={command.state === 'disabled'}
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
          </Menu.Item>
        </span>
      ))}
    </>
  );
}