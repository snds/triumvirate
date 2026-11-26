import { useEffect, type ReactNode } from 'react';
import { Dialog, Modal, ModalOverlay } from 'react-aria-components';

/**
 * The item dialog's shell: a large centered card with a mouse, the full screen on a phone.
 *
 * Normally it's a React Aria modal (focus stays inside, the page doesn't scroll, Escape and a click
 * on the scrim close it, focus returns to the tile). While the chat is open beside it ("Ask about
 * this item"), it becomes non-modal instead, so you can type in the chat: the scrim still closes it,
 * and Escape closes it unless you're in the chat (the chat has its own Escape).
 *
 * Anatomy: overlay (.dialog-scrim) › frame (.dialog-frame, layout only) › dialog (.dialog.item-dialog)
 */
export function ItemDialog({ label, onClose, modal, children }: {
  label: string; onClose: () => void; modal: boolean; children: ReactNode;
}) {
  useEffect(() => {
    if (modal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (e.target instanceof Element && e.target.closest('.agent'))) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, onClose]);
  const dialog = <Dialog className="dialog item-dialog" aria-label={label}>{children}</Dialog>;
  if (!modal) {
    return <div className="dialog-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>{dialog}</div>;
  }
  return (
    <ModalOverlay className="dialog-scrim" isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal className="dialog-frame">{dialog}</Modal>
    </ModalOverlay>
  );
}
