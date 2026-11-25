import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon.tsx';

/** Open sheets, newest last, so Escape closes only the one on top (a picker over an editor). */
const stack: symbol[] = [];

/**
 * A modal for a question, a short form, or an editor. With a mouse it's a centered card; on a phone
 * it rises from the bottom edge (rounded top, grab handle, clear of the home indicator), and `full`
 * makes it fill the screen for longer work. Escape or a tap on the scrim closes it; focus moves in
 * and goes back where it was when it closes. `footer` stays pinned under scrolling content.
 */
export function Sheet({ title, onClose, wide, full, footer, children }: {
  title: string; onClose: () => void; wide?: boolean; full?: boolean; footer?: ReactNode; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const id = Symbol('sheet');
    stack.push(id);
    const back = document.activeElement as HTMLElement | null;
    // Fields focus themselves; otherwise land on the sheet so Tab starts inside it.
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || stack.at(-1) !== id) return;
      e.stopPropagation();
      close.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      stack.splice(stack.indexOf(id), 1);
      back?.focus?.();
    };
  }, []);
  return (
    <div className="sheet-layer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`sheet${wide ? ' sheet--wide' : ''}${full ? ' sheet--full' : ''}`}
        role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
      >
        <span className="sheet__handle" aria-hidden />
        <header className="sheet__header">
          <h2 className="sheet__title">{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close" title="Close"><Icon name="close" /></button>
        </header>
        <div className="sheet__content">{children}</div>
        {footer && <footer className="sheet__footer">{footer}</footer>}
      </div>
    </div>
  );
}
