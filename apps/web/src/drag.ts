// The item being dragged, shared so every drop zone can light up (or say why not) while it's
// over them. Browsers hide drag data until the drop, so the item itself lives here.
import { createContext, useContext, useEffect, useRef, useState, type DragEvent } from 'react';
import type { AppraisedItem } from '@triumvirate/core/browser';
import { useInventory } from './inventory-context.ts';

export interface DragApi {
  item: AppraisedItem | null;
  start: (item: AppraisedItem) => void;
  end: () => void;
}

export const DragContext = createContext<DragApi>({ item: null, start: () => {}, end: () => {} });
export const useDrag = () => useContext(DragContext);

/** Props and state for one drop target: a character column or the vault. */
export function useDropZone(to: string) {
  const drag = useDrag();
  const inv = useInventory();
  const [over, setOver] = useState(false);
  // dragenter/dragleave fire for every child element; count them so the highlight doesn't flicker.
  const depth = useRef(0);
  const check = drag.item ? inv.check(drag.item, to) : undefined;
  const state = !drag.item || !check ? undefined : check.ok ? 'ok' : check.quiet ? undefined : 'blocked';
  const reset = () => { depth.current = 0; setOver(false); };
  const props = {
    onDragEnter: (e: DragEvent) => {
      if (!drag.item) return;
      e.preventDefault();
      depth.current += 1;
      setOver(true);
    },
    onDragLeave: () => {
      if (!drag.item) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    },
    onDragOver: (e: DragEvent) => {
      if (!drag.item) return;
      // Calling preventDefault is what marks this as a valid drop target.
      if (check?.ok) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
      else e.dataTransfer.dropEffect = 'none';
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const item = drag.item;
      reset();
      drag.end();
      if (item && check?.ok) inv.move(item, to);
    },
  };
  // A drag that ends anywhere (Escape, a drop elsewhere) clears this zone too.
  useEffect(() => { if (!drag.item) { depth.current = 0; setOver(false); } }, [drag.item]);
  return {
    props,
    className: state && over ? ` is-drop-${state}` : state === 'ok' ? ' is-drop-candidate' : '',
    /** Why the item can't land here, shown while it's over this zone. */
    note: over && check && !check.ok && !check.quiet ? check.reason : undefined,
  };
}
