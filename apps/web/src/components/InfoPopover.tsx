import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { TOUCH_QUERY, useMediaQuery } from '../media.ts';
import { Sheet } from '../ui/Sheet.tsx';

const GAP = 8;
/** Delays so sweeping the mouse past a trigger doesn't flash a card, and crossing the gap to it doesn't close it. */
const OPEN_MS = 200;
const CLOSE_MS = 150;

/**
 * A small summary that opens from a trigger: power breakdown, set bonuses, material counts.
 * With a mouse it opens on hover (or click, which pins it) as a card under the trigger, flipped
 * above when there's no room. Without hover (phones, tablets) a tap opens the same content in a
 * bottom sheet. Escape, a click outside, or scrolling the page closes it.
 */
export function InfoPopover({ title, trigger, triggerClassName, label, children, width }: {
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
  const card = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean; arrow: number } | null>(null);
  const id = useId();
  // The trigger is named by `label` (it says what opens); the card and sheet by their heading.
  const name = label ?? (typeof title === 'string' ? title : '');
  const heading = typeof title === 'string' ? title : name;

  const close = useCallback(() => { clearTimeout(timer.current); setOpen(false); setPinned(false); }, []);
  const later = (fn: () => void, ms: number) => { clearTimeout(timer.current); timer.current = setTimeout(fn, ms); };
  useEffect(() => () => clearTimeout(timer.current), []);

  // Place the card under the trigger, centered, kept on screen; above it when there's no room below.
  useLayoutEffect(() => {
    if (!open || touch || !btn.current || !card.current) { setPos(null); return; }
    const a = btn.current.getBoundingClientRect();
    const { width: w, height: h } = card.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const center = a.left + a.width / 2;
    const left = Math.min(Math.max(GAP, center - w / 2), vw - w - GAP);
    const above = a.bottom + GAP + h > vh - GAP && a.top - GAP - h > GAP;
    setPos({ left, top: above ? a.top - GAP - h : a.bottom + GAP, above, arrow: center - left });
  }, [open, touch]);

  // While open: Escape, a click elsewhere, or a scroll closes it.
  useEffect(() => {
    if (!open || touch) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); btn.current?.focus(); } };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !card.current?.contains(t)) close();
    };
    const onScroll = (e: Event) => { if (!card.current?.contains(e.target as Node)) close(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, touch, close]);

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
        aria-controls={open && !touch ? id : undefined}
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
      {open && !touch && (
        <div
          ref={card}
          id={id}
          role="dialog"
          aria-label={heading}
          className={`info-card${pos?.above ? ' info-card--above' : ''}`}
          style={{
            width,
            ...(pos ? { left: pos.left, top: pos.top, '--arrow-x': `${pos.arrow}px` } : { left: 0, top: 0, visibility: 'hidden' }),
          } as React.CSSProperties}
          {...hover}
        >
          <h3 className="info-card__title">{title}</h3>
          <div className="info-card__body">{children}</div>
        </div>
      )}
    </>
  );
}
