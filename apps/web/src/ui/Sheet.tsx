import type { ReactNode } from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { Icon } from '../components/Icon.tsx';

/**
 * A modal for a question, a short form, or an editor. With a mouse it's a centered card; on a phone
 * it rises from the bottom edge (rounded top, grab handle, clear of the home indicator), and `full`
 * makes it fill the screen for longer work. `footer` stays pinned under scrolling content.
 *
 * Behavior comes from React Aria: focus moves in and stays in (Tab can't escape), the page behind
 * doesn't scroll, Escape closes only the sheet on top (a picker over an editor), a tap on the scrim
 * closes it, and focus goes back to the control that opened it. Looks come from app.css.
 *
 * Anatomy: overlay (.sheet-layer, the scrim) › frame (.sheet-frame, layout only) › dialog (.sheet)
 *   › handle · header (title + close) · content · footer
 */
export function Sheet({ title, onClose, wide, full, footer, className, children }: {
  title: string; onClose: () => void; wide?: boolean; full?: boolean; footer?: ReactNode; className?: string; children: ReactNode;
}) {
  return (
    <ModalOverlay className="sheet-layer" isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal className="sheet-frame">
        <Dialog className={`sheet${wide ? ' sheet--wide' : ''}${full ? ' sheet--full' : ''}${className ? ` ${className}` : ''}`}>
          <span className="sheet__handle" aria-hidden />
          <header className="sheet__header">
            <Heading slot="title" className="sheet__title">{title}</Heading>
            <button className="icon-button" onClick={onClose} aria-label="Close" title="Close"><Icon name="close" /></button>
          </header>
          <div className="sheet__content">{children}</div>
          {footer && <footer className="sheet__footer">{footer}</footer>}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
