import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import type { ReactElement, ReactNode } from 'react';

/** Shared delay so adjacent chrome tooltips open instantly after the first. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <TooltipPrimitive.Provider delay={400}>{children}</TooltipPrimitive.Provider>;
}

export function Tooltip({
  content,
  children,
  wrapDisabled,
}: {
  content: string;
  children: ReactElement;
  /**
   * Native disabled buttons do not fire hover or focus. Wrap them so the
   * tooltip still explains why the control is unavailable.
   */
  wrapDisabled?: boolean;
}) {
  const trigger = wrapDisabled ? <span className="tooltip-hit-area">{children}</span> : children;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger render={trigger} />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner className="popup-positioner" sideOffset={8}>
          <TooltipPrimitive.Popup className="chrome-tooltip">
            {content}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
