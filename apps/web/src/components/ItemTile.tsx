import { useHover } from '../hover.ts';
import { memo, useRef } from 'react';
import { useDragActions } from '../drag.ts';
import { useInventory } from '../inventory-context.ts';
import { Icon } from './Icon.tsx';
import { ElementIcon } from './ElementIcon.tsx';
import { TierDiamonds } from './ItemParts.tsx';
import type { AppraisedItem, Verdict } from '@triumvirate/core';

// Maps the item's rarity and element to semantic token names.
const tierClass = (tier: string) => `tier-${tier.toLowerCase() || 'common'}`;
const elementVar = (damage?: string) => (damage ? `var(--element-${damage.toLowerCase()})` : undefined);

export const VERDICT_LABEL: Record<Verdict, string> = {
  god: 'God roll',
  good: 'Recommended roll',
  meh: 'No recommended roll matches',
  trash: 'Marked as trash',
  unrated: 'No wish list data',
};

/** Hover lift: nudges the tile toward the pointer. Written straight to CSS variables, so no re-render. */
function tilt(e: React.PointerEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--mx', (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(2));
  e.currentTarget.style.setProperty('--my', (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(2));
}

/** How long a finger rests on a tile before the quick-move sheet opens. */
const LONG_PRESS_MS = 450;
/** A finger that travels further than this is scrolling, not pressing. */
const LONG_PRESS_SLOP = 8;

/**
 * Long-press for touch: drag is mouse-only, so holding a tile opens the quick-move sheet instead.
 * The tap that ends a long-press is swallowed, so it doesn't also open the item panel.
 */
function useLongPress(fire: () => void) {
  const timer = useRef(0);
  const start = useRef({ x: 0, y: 0 });
  const fired = useRef(false);
  const stop = () => { clearTimeout(timer.current); timer.current = 0; };
  return {
    fired,
    down: (e: React.PointerEvent) => {
      fired.current = false;
      if (e.pointerType !== 'touch') return;
      start.current = { x: e.clientX, y: e.clientY };
      stop();
      timer.current = window.setTimeout(() => {
        timer.current = 0;
        fired.current = true;
        navigator.vibrate?.(10);
        fire();
      }, LONG_PRESS_MS);
    },
    move: (e: React.PointerEvent) => {
      if (timer.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > LONG_PRESS_SLOP) stop();
    },
    stop,
  };
}

// Memoized: a vault can hold over a thousand tiles, and drags re-render the columns around them.
export const ItemTile = memo(function ItemTile({
  item, size = 'md', onSelect,
}: { item: AppraisedItem; size?: 'md' | 'lg'; onSelect?: (i: AppraisedItem) => void }) {
  const hover = useHover();
  const drag = useDragActions();
  const { moving, quick } = useInventory();
  const press = useLongPress(() => quick(item));
  const isMoving = !!item.instanceId && moving.has(item.instanceId);
  const draggable = !!item.movable && !item.equipped && !isMoving;
  const verdict = item.appraisal?.verdict;
  const label = [item.name, item.type, item.damage, item.power && `${item.power} power`,
    verdict && VERDICT_LABEL[verdict], item.gearTier && `tier ${item.gearTier}`, item.masterworked && 'masterworked', item.locked && 'locked'].filter(Boolean).join(' · ');
  return (
    <button
      type="button"
      className={`tile tile--${size} ${tierClass(item.tier)}${isMoving ? ' is-moving' : ''}${item.masterworked ? ' is-masterworked' : ''}`}
      aria-label={label}
      aria-busy={isMoving || undefined}
      data-movable={draggable || undefined}
      data-instance={item.instanceId}
      onPointerDown={(e) => { press.down(e); if (draggable) drag.press(e, item); }}
      onPointerMove={(e) => { press.move(e); if (hover && e.pointerType === 'mouse') tilt(e); }}
      onPointerUp={press.stop}
      onPointerCancel={press.stop}
      // Right-click (and Android's own long-press) opens the same sheet, instead of the browser menu.
      onContextMenu={onSelect ? (e) => { e.preventDefault(); press.stop(); hover?.leave(); quick(item); } : undefined}
      onClick={onSelect ? () => { if (press.fired.current) { press.fired.current = false; return; } hover?.leave(); onSelect(item); } : undefined}
      // Hovercards are for a mouse; a tap on a phone goes straight to the item dialog.
      onPointerEnter={hover ? (e) => { if (e.pointerType === 'mouse') hover.enter(item, e.currentTarget.getBoundingClientRect()); } : undefined}
      onPointerLeave={(e) => { press.stop(); hover?.leave(); e.currentTarget.style.removeProperty('--mx'); e.currentTarget.style.removeProperty('--my'); }}
    >
      {item.icon && <img className="tile__icon" src={item.icon} alt="" decoding="async" draggable={false} />}
      {item.watermark && <img className="tile__watermark" src={item.watermark} alt="" decoding="async" draggable={false} />}
      {item.masterworked && <span className="tile__holofoil" aria-hidden />}
      <TierDiamonds item={item} className="tile__tier" />
      {item.power !== undefined && (
        <span className="tile__power">
          {/* Champion stun sits just before the element, like the game's tooltip. */}
          {item.breaker?.icon && <img className="tile__breaker" src={item.breaker.icon} alt={item.breaker.name} title={item.breaker.name} draggable={false} />}
          {item.damageIcon
            ? <ElementIcon className="tile__element-icon" damage={item.damage} icon={item.damageIcon} />
            : item.damage && <span className="tile__element" style={{ background: elementVar(item.damage) }} />}
          {item.power}
        </span>
      )}
      {item.locked && <span className="tile__lock"><Icon name="lock" filled /></span>}
      {isMoving && <span className="tile__moving"><span className="spinner" /></span>}
    </button>
  );
});
