import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Dialog, Heading, OverlayArrow, Popover } from 'react-aria-components';
import { TOUCH_QUERY, useMediaQuery } from '../media.ts';
import { Sheet } from './Sheet.tsx';

/** Delays so sweeping the mouse past a trigger doesn't flash a card, and crossing the gap to it doesn't close it. */
const OPEN_MS = 200;
const CLOSE_MS = 150;

/**
 * A small summary that opens from a trigger: power breakdown, set bonuses, material counts.
 *
 * With a mouse it opens on hover as a card under the trigger (flipped above when there's no room),
 * and a click pins it. A hovered card is non-modal, so passing over it doesn't hide the page from
 * screen readers; a pinned one is a React Aria popover dialog (focus inside, Escape and a click
 * outside close it, focus returns). Without hover (phones, tablets) a tap opens it as a bottom sheet.
 *
 * Anatomy: trigger (.info-trigger) › card (.info-card) › arrow · title · body
 */
export function InfoCard({ title, trigger, triggerClassName, label, children, width }: {
  /** Heading in the card and the sheet. */
  title: ReactNode;
  /** Plain-text name for the sheet and screen readers, when `title` isn't a string. */
  label?: string;
  trigger: ReactNode;
  triggerClassName?: string;
  children: ReactNode;
  /** Card width in px with a mouse; the sheet always fits the screen. */
  width?: number;
}) {
  const touch = useMediaQuery(TOUCH_QUERY);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The trigger is named by `label` (it says what opens); the card and sheet by their heading.
  const name = label ?? (typeof title === 'string' ? title : '');
  const heading = typeof title === 'string' ? title : name;

  const close = useCallback(() => { clearTimeout(timer.current); setOpen(false); setPinned(false); }, []);
  const later = (fn: () => void, ms: number) => { clearTimeout(timer.current); timer.current = setTimeout(fn, ms); };
  useEffect(() => () => clearTimeout(timer.current), []);

  const hover = touch ? {} : {
    onPointerEnter: (e: React.PointerEvent) => { if (e.pointerType === 'mouse') later(() => setOpen(true), OPEN_MS); },
    onPointerLeave: (e: React.PointerEvent) => { if (e.pointerType === 'mouse' && !pinned) later(() => setOpen(false), CLOSE_MS); },
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`info-trigger${triggerClassName ? ` ${triggerClassName}` : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={name || undefined}
        onClick={() => {
          clearTimeout(timer.current);
          // A click pins a hover-opened card; a second click closes it.
          if (open && pinned) close();
          else { setOpen(true); setPinned(true); }
        }}
        {...hover}
      >
        {trigger}
      </button>
      {open && touch && <Sheet title={heading} onClose={close} className="info-sheet">{children}</Sheet>}
      {!touch && (
        <Popover
          key={pinned ? 'pinned' : 'hover'}
          triggerRef={btn}
          isOpen={open}
          onOpenChange={(o) => { if (!o) close(); }}
          isNonModal={!pinned}
          placement="bottom"
          offset={10}
          containerPadding={8}
          className="info-card"
          style={{ width }}
          {...hover}
        >
          <OverlayArrow className="info-card__arrow"><span /></OverlayArrow>
          <Dialog className="info-card__dialog" aria-label={heading}>
            <Heading slot="title" level={3} className="info-card__title">{title}</Heading>
            <div className="info-card__body">{children}</div>
          </Dialog>
        </Popover>
      )}
    </>
  );
}
