import type { ReactNode } from 'react';
import type { CommandIconId } from './command-registry';

/**
 * The one semantic 16px stroke icon set of the command vocabulary. Every
 * surface (toolbar, menus, palette) renders command icons through this
 * module; the id union is owned by the registry, which is the only place
 * that names commands. Icons are pure SVG paths — no icon dependency, no
 * glyph text, currentColor so every surface tints them with its tokens.
 */

const PATHS: Record<CommandIconId, ReactNode> = {
  cursor: <path d="M4 2.2 12.8 9 8.6 9.4 6.2 13.8 4 2.2Z" />,
  text: <path d="M4.5 3.5h7M8 3.5v9M5.2 12.5h5.6" />,
  shape: <rect height="7.5" rx="1.5" width="10" x="3" y="4.4" />,
  undo: <path d="M8.8 4.2 5.3 7l3.5 2.8" />,
  redo: <path d="M7.2 4.2l3.5 2.8-3.5 2.8" />,
  copy: (
    <>
      <rect height="7" rx="1.2" width="7" x="6.2" y="6.2" />
      <path d="M9.8 3.2h3a.8.8 0 0 1 .8.8v3" />
    </>
  ),
  trash: (
    <>
      <path d="M4 4.6h8" />
      <path d="M6.4 4.6V3.3a1 1 0 0 1 1-1h1.2a1 1 0 0 1 1 1v1.3" />
      <path d="M4.5 4.6h7l-.6 8.3a1.5 1.5 0 0 1-1.5 1.6H6.6a1.5 1.5 0 0 1-1.5-1.6L4.5 4.6Z" />
    </>
  ),
  'select-all': (
    <>
      <path d="M8 2.2 13.4 5 8 7.8 2.6 5 8 2.2Z" />
      <path d="M2.6 8 8 10.8l5.4-2.8" />
      <path d="M2.6 11 8 13.8l5.4-2.8" />
    </>
  ),
  edit: (
    <>
      <path d="m11.6 2.4 2 2L6.2 11.8l-3.4.8.9-3.5 7.9-6.7Z" />
      <path d="m10.2 3.8 2 2" />
    </>
  ),
  'order-front': <path d="M8 2.2v6.6M11.6 5.6 8 2.2 4.4 5.6M2.8 13.8h10.4" />,
  'order-forward': <path d="M8 13.6V4.4M11.6 7.6 8 4.4 4.4 7.6" />,
  'order-backward': <path d="M8 2.4v9.2M11.6 8.4 8 11.6 4.4 8.4" />,
  'order-back': <path d="M8 13.8V7.2M11.6 10.4 8 13.8 4.4 10.4M2.8 2.2h10.4" />,
  'align-left': <path d="M3 4h10M3 8h6.5M3 12h8.5" />,
  'align-centerh': <path d="M3 4h10M4.8 8h6.4M3 12h10" />,
  'align-right': <path d="M3 4h10M6.5 8H13M4.5 12H13" />,
  'align-top': <path d="M4 3h8M4 3v10M8 3v6.5M12 3v10" />,
  'align-centerv': <path d="M4 3h8M4 3v6M8 3v10M12 3v6" />,
  'align-bottom': <path d="M4 13h8M4 3v10M8 6.5v6.5M12 3v10" />,
  bold: (
    <>
      <path d="M6 2.8h3.4a2.7 2.7 0 0 1 0 5.4H6Z" />
      <path d="M6 8.2h4.3a2.7 2.7 0 0 1 0 5.4H6Z" />
    </>
  ),
  'text-align-left': <path d="M3 4h10M3 8h6M3 12h8" />,
  'text-align-center': <path d="M3 4h10M5 8h6M4.2 12h7.6" />,
  'text-align-right': <path d="M3 4h10M7 8h6M5 12h8" />,
  'zoom-in': (
    <>
      <circle cx="6.9" cy="6.9" r="4.1" />
      <path d="M10 10l3.6 3.6M6.9 5v3.8M5 6.9h3.8" />
    </>
  ),
  'zoom-out': (
    <>
      <circle cx="6.9" cy="6.9" r="4.1" />
      <path d="M10 10l3.6 3.6M5 6.9h3.8" />
    </>
  ),
  'zoom-fit': <path d="M5.2 3H3v2.2M10.8 3H13v2.2M5.2 13H3v-2.2M10.8 13H13v-2.2" />,
  inspector: (
    <>
      <rect height="10.4" rx="1.4" width="11.6" x="2.2" y="3" />
      <path d="M6.4 3v10.4" />
    </>
  ),
  agent: (
    <>
      <path d="M8 2.6 9 6l3.4 1-3.4 1-1 3.4-1-3.4-3.4-1L7 6l1-3.4Z" />
      <path d="M5.4 12.2a6 6 0 0 0 5.2 0" />
    </>
  ),
  comment: (
    <>
      <path d="M3 2.8h10a1.3 1.3 0 0 1 1.3 1.3v5.2A1.3 1.3 0 0 1 13 10.6H8L5.6 13l.3-1.6H3A1.3 1.3 0 0 1 1.7 10V4.1A1.3 1.3 0 0 1 3 2.8Z" />
    </>
  ),
  activity: <path d="M2 8.4h3l2-4.2 3 8.4 2-4.2h2" />,
  play: <path d="M5 3.6 12.8 8 5 12.4V3.6Z" />,
  download: <path d="M8 2.8v6.8M5.2 6.8 8 9.8l2.8-3M3 13.2h10" />,
  plus: <path d="M8 3v10M3 8h10" />,
  ellipsis: <path d="M3.8 8h.1M8 8h.1M12.2 8h.1" />,
};

/**
 * One shared command icon. Renders 16px stroke paths in currentColor;
 * `aria-hidden` because every icon-only control carries a text label or
 * aria-label from the registry.
 */
export function CommandIcon({
  className,
  icon,
  size = 16,
}: {
  className?: string;
  icon: CommandIconId;
  size?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      focusable="false"
      height={size}
      viewBox="0 0 16 16"
      width={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
    >
      {PATHS[icon]}
    </svg>
  );
}