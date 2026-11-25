import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon.tsx';

/**
 * A small modal for a question or a short form: a centered card with a mouse, a bottom sheet on a
 * phone (rounded top, grab handle, clear of the home indicator), so the answer sits under the thumb.
 * Escape or a tap on the scrim closes it; focus moves in and returns when it closes.
 */
export function Sheet({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    // Fields focus themselves; otherwise land on the sheet so Tab starts inside it.
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); back?.focus?.(); };
  }, [onClose]);
  return (
    <div className="sheet-layer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`sheet${wide ? ' sheet--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <span className="sheet__handle" aria-hidden />
        <header className="sheet__header">
          <h2 className="sheet__title">{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close" title="Close"><Icon name="close" /></button>
        </header>
        <div className="sheet__content">{children}</div>
      </div>
    </div>
  );
}
