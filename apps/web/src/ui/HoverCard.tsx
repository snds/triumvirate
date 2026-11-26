import type { ReactNode, RefObject } from 'react';
import { Tooltip, TooltipTriggerStateContext, type TooltipTriggerState } from 'react-aria-components';

// The app owns when the card shows (hover delay, mouse only), so the card is always "open" while
// mounted. A standalone Tooltip still reads its open state from this context, so we hand it a
// fixed, always-open state instead of wrapping it in a TooltipTrigger.
const ALWAYS_OPEN: TooltipTriggerState = { isOpen: true, shouldSkipAnimation: false, open: () => {}, close: () => {} };

/**
 * A quick look beside a target: the item hover card. One card serves the whole grid: the app
 * decides what's hovered (after a short delay, mouse only, never on touch) and points this at the
 * hovered element. React Aria places it beside the target, flips it to the other side when it
 * would leave the screen, and keeps it inside the window.
 *
 * Anatomy: card (`className`) › whatever the caller renders
 */
export function HoverCard({ target, className, children }: {
  target: RefObject<Element | null>;
  className?: string;
  children: ReactNode;
}) {
  return (
    <TooltipTriggerStateContext.Provider value={ALWAYS_OPEN}>
      <Tooltip triggerRef={target} isOpen placement="end top" offset={8} containerPadding={8} className={className}>
        {children}
      </Tooltip>
    </TooltipTriggerStateContext.Provider>
  );
}
