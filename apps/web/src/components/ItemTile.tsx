import type { ItemRow } from '@triumvirate/core';

// Maps the item's rarity and element to semantic token names.
const tierClass = (tier: string) => `tier-${tier.toLowerCase() || 'common'}`;
const elementVar = (damage?: string) => (damage ? `var(--element-${damage.toLowerCase()})` : undefined);

export function ItemTile({ item, size = 'md' }: { item: ItemRow; size?: 'md' | 'lg' }) {
  const label = [item.name, item.type, item.damage, item.power && `${item.power} power`, item.locked && 'locked']
    .filter(Boolean)
    .join(' · ');
  return (
    <div className={`tile tile--${size} ${tierClass(item.tier)}`} title={label} aria-label={label} role="img">
      {item.icon && <img className="tile__icon" src={item.icon} alt="" loading="lazy" />}
      {item.watermark && <img className="tile__watermark" src={item.watermark} alt="" loading="lazy" />}
      {item.power !== undefined && (
        <span className="tile__power">
          {item.damage && <span className="tile__element" style={{ background: elementVar(item.damage) }} />}
          {item.power}
        </span>
      )}
      {item.locked && <span className="tile__lock" aria-hidden>🔒</span>}
    </div>
  );
}
