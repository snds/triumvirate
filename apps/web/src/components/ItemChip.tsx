import type { AppraisedItem } from '@triumvirate/core/browser';
import { useHover } from '../hover.ts';
import { useInventory } from '../inventory-context.ts';

/**
 * An owned item inline in text: tiny icon plus name, rarity colored.
 * Hover shows the usual hovercard; click opens the item panel.
 */
export function ItemChip({ id, label }: { id: string; label?: string }) {
  const { byId, select } = useInventory();
  const hover = useHover();
  const item = byId.get(id);
  // An id the player doesn't own (or a stale one): plain text, nothing to open.
  if (!item) return <span className="item-chip item-chip--missing">{label ?? 'Unknown item'}</span>;
  return (
    <button
      type="button"
      className={`item-chip tier-${item.tier.toLowerCase() || 'common'}`}
      onClick={() => { hover?.leave(); select(item); }}
      onPointerEnter={hover ? (e) => hover.enter(item, e.currentTarget.getBoundingClientRect()) : undefined}
      onPointerLeave={hover ? () => hover.leave() : undefined}
    >
      {item.icon && <img className="item-chip__icon" src={item.icon} alt="" />}
      <span className="item-chip__name">{label || item.name}</span>
    </button>
  );
}

