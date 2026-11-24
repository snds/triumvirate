import { useHover } from '../hover.ts';
import { memo } from 'react';
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

// Memoized: a vault can hold over a thousand tiles, and drags re-render the columns around them.
export const ItemTile = memo(function ItemTile({
  item, size = 'md', onSelect,
}: { item: AppraisedItem; size?: 'md' | 'lg'; onSelect?: (i: AppraisedItem) => void }) {
  const hover = useHover();
  const drag = useDragActions();
  const { moving } = useInventory();
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
      onPointerDown={draggable ? (e) => drag.press(e, item) : undefined}
      onPointerMove={hover ? tilt : undefined}
      onClick={onSelect ? () => { hover?.leave(); onSelect(item); } : undefined}
      onPointerEnter={hover ? (e) => hover.enter(item, e.currentTarget.getBoundingClientRect()) : undefined}
      onPointerLeave={(e) => { hover?.leave(); e.currentTarget.style.removeProperty('--mx'); e.currentTarget.style.removeProperty('--my'); }}
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
