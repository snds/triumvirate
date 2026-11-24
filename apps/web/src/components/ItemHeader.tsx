import type { AppraisedItem } from '@triumvirate/core/browser';
import { AmmoIcon } from './AmmoIcon.tsx';
import { ElementIcon } from './ElementIcon.tsx';
import { TierDiamonds } from './ItemParts.tsx';

/**
 * The item's identity band, shared by the hovercard and the item dialog: tier diamonds and name,
 * art with tier diamonds, name, rarity and type, then power with element, champion stun, and ammo. Tier color fills it;
 * masterworked items get the gold banner.
 */
export function ItemHeader({ item, size, children }: {
  item: AppraisedItem;
  size: 'card' | 'dialog';
  /** Extra content for the dialog, such as the close button. */
  children?: React.ReactNode;
}) {
  const tier = item.tier.toLowerCase() || 'common';
  return (
    <header className={`item-header item-header--${size} tier-${tier}${item.masterworked ? ' is-masterworked' : ''}`}>
      {/* The art, dressed like the inventory tile: watermark, masterwork shimmer, and the
          tier diamonds standing in a column under the release icon. */}
      {item.icon && (
        <span className="item-header__art">
          <img src={item.icon} alt="" />
          {item.watermark && <img src={item.watermark} alt="" />}
          {item.masterworked && <span className="tile__holofoil" aria-hidden />}
          <TierDiamonds item={item} className="tile__tier" />
        </span>
      )}
      <div className="item-header__id">
        <h2 className="item-header__name">
          {item.name}
        </h2>
        {/* Each part stays whole when the line wraps; the dot stays at the end of a line. */}
        <p className="item-header__kind">
          {item.tier && <span>{item.tier}</span>}
          {item.type && <span>{item.type}</span>}
          {item.gearTier ? <span>Tier {item.gearTier}</span> : null}
          {item.masterworked ? <span className="item-header__mw">Masterworked</span> : null}
        </p>
        {size === 'dialog' && item.flavorText && <p className="item-header__flavor">{item.flavorText}</p>}
      </div>
      <div className="item-header__stats">
        {item.power !== undefined && <span className="item-header__power">{item.power}</span>}
        <span className="item-header__icons">
          {item.damageIcon && <ElementIcon className="item-header__icon" damage={item.damage} icon={item.damageIcon} />}
          {item.breaker?.icon && <img className="item-header__icon" src={item.breaker.icon} alt={item.breaker.name} title={item.breaker.name} />}
          <AmmoIcon ammo={item.ammo} className="item-header__ammo" />
        </span>
      </div>
      {children}
    </header>
  );
}
