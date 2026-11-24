// Dragging items between columns, built on pointer events rather than the browser's native
// drag and drop. Native drag hands control to the operating system, and on Windows Chrome that
// hand-off could hang the whole page. Here the page stays in charge: a ghost tile follows the
// pointer, the column under it lights up, and Escape always cancels.
import { createContext, createElement, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AppraisedItem } from '@triumvirate/core/browser';
import { useInventory } from './inventory-context.ts';

/** How far the pointer must travel before a press becomes a drag (so clicks still open the panel). */
const DRAG_THRESHOLD = 6;
/** Distance from the scroll area's top or bottom edge where dragging scrolls it. */
const EDGE = 64;

export interface DragState {
  item: AppraisedItem;
  /** The drop zone under the pointer: a character id, 'vault', or null. */
  zone: string | null;
}

export interface DragActions {
  /** Call from a tile's pointerdown; the drag only starts once the pointer moves. */
  press: (e: React.PointerEvent<HTMLElement>, item: AppraisedItem) => void;
}

export const DragActionsContext = createContext<DragActions>({ press: () => {} });
export const DragContext = createContext<DragState | null>(null);
export const useDrag = () => useContext(DragContext);
export const useDragActions = () => useContext(DragActionsContext);

/**
 * Owns the one drag that can happen at a time. `onDrop` gets the item and the zone it was
 * released over; the caller decides whether that move is allowed.
 */
export function useItemDrag(onDrop: (item: AppraisedItem, zone: string) => void) {
  const [state, setState] = useState<DragState | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const ghost = useRef<{ icon?: string; tier: string; size: number } | null>(null);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  const cleanup = useRef<() => void>(() => {});
  /** Last pointer position, so a freshly mounted ghost starts under the pointer. */
  const pos = useRef({ x: 0, y: 0 });

  const press = useCallback((e: React.PointerEvent<HTMLElement>, item: AppraisedItem) => {
    if (e.button !== 0 || e.pointerType === 'touch') return; // touch keeps scrolling; it can use Move to buttons
    const tile = e.currentTarget;
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    let zone: string | null = null;
    let x = startX;
    let y = startY;
    let frame = 0;
    const scroller = tile.closest<HTMLElement>('.main');

    const place = () => {
      pos.current = { x, y };
      const g = ghostRef.current;
      if (g) g.style.transform = ghostTransform(x, y);
    };
    // Scrolls the inventory while the pointer rests near its top or bottom edge.
    const tick = () => {
      frame = 0;
      if (!dragging || !scroller) return;
      const r = scroller.getBoundingClientRect();
      const dy = y < r.top + EDGE ? -(r.top + EDGE - y) : y > r.bottom - EDGE ? y - (r.bottom - EDGE) : 0;
      if (dy) {
        scroller.scrollTop += Math.max(-24, Math.min(24, dy / 3));
        updateZone();
        frame = requestAnimationFrame(tick);
      }
    };
    const updateZone = () => {
      // The ghost ignores the pointer, so this finds what's underneath it.
      const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-zone]');
      const next = el?.dataset.dropZone ?? null;
      if (next !== zone) {
        zone = next;
        setState((s) => (s ? { ...s, zone } : s));
      }
    };
    const begin = () => {
      dragging = true;
      const rect = tile.getBoundingClientRect();
      ghost.current = { icon: item.icon, tier: item.tier.toLowerCase() || 'common', size: rect.width };
      document.body.classList.add('is-dragging-item');
      tile.classList.add('is-drag-source');
      window.getSelection()?.removeAllRanges();
      setState({ item, zone: null });
    };
    const move = (ev: PointerEvent) => {
      x = ev.clientX;
      y = ev.clientY;
      if (!dragging) {
        if (Math.hypot(x - startX, y - startY) < DRAG_THRESHOLD) return;
        place();
        begin();
      }
      ev.preventDefault();
      place();
      updateZone();
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const finish = (drop: boolean) => {
      cleanup.current();
      if (!dragging) return;
      document.body.classList.remove('is-dragging-item');
      tile.classList.remove('is-drag-source');
      setState(null);
      ghost.current = null;
      if (drop && zone) onDropRef.current(item, zone);
      // The release would also count as a click on whatever is under it; swallow that one click.
      const swallow = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') cancel(); };

    cleanup.current();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', cancel);
    cleanup.current = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', cancel);
      cleanup.current = () => {};
    };
  }, []);

  useEffect(() => () => cleanup.current(), []);
  // Position the ghost as soon as it mounts, before the browser paints it.
  const active = !!state;
  useLayoutEffect(() => {
    if (active && ghostRef.current) ghostRef.current.style.transform = ghostTransform(pos.current.x, pos.current.y);
  }, [active]);

  const actions = useMemo<DragActions>(() => ({ press }), [press]);
  const g = ghost.current;
  const ghostEl = state && g
    ? createElement('div', {
      ref: ghostRef,
      className: `drag-ghost tile tier-${g.tier}`,
      style: { width: g.size, height: g.size },
      'aria-hidden': true,
    }, g.icon ? createElement('img', { className: 'tile__icon', src: g.icon, alt: '' }) : null)
    : null;
  return { state, actions, ghost: ghostEl };
}

const ghostTransform = (x: number, y: number) => `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(-4deg) scale(1.08)`;

/** Props and state for one drop target: a character column or the vault. */
export function useDropZone(to: string) {
  const drag = useDrag();
  const inv = useInventory();
  const check = drag ? inv.check(drag.item, to) : undefined;
  const over = drag?.zone === to;
  const state = !check ? undefined : check.ok ? 'ok' : check.quiet ? undefined : 'blocked';
  return {
    props: { 'data-drop-zone': to },
    className: state && over ? ` is-drop-${state}` : state === 'ok' ? ' is-drop-candidate' : '',
    /** Why the item can't land here, shown while it's over this zone. */
    note: over && check && !check.ok && !check.quiet ? check.reason : undefined,
  };
}
