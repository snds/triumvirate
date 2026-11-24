import type { AppraisedItem } from '@triumvirate/core/browser';
import { AmmoIcon } from './AmmoIcon.tsx';
import { ElementIcon } from './ElementIcon.tsx';
import { TierDiamonds } from './ItemParts.tsx';

/**
 * The item's identity band, shared by the hovercard and the item dialog: tier diamonds and name,
 * rarity and type, then power with element, champion stun, and ammo. Tier color fills it;
 * masterworked items get the gold banner.
 */
export function ItemHeader({ item, size, children }: {
  item: AppraisedItem;
  size: 'card' | 'dialog';
  /** Extra content for the dialog, such as the close button. */
  children?: React.ReactNode;
}) {
  const tier = item.tier.toLowerCase() || 'common';
  const kind = [item.tier, item.type].filter(Boolean).join(' · ');
  return (
    <header className={`item-header item-header--${size} tier-${tier}${item.masterworked ? ' is-masterworked' : ''}`}>
      {size === 'dialog' && item.icon && (
        <span className="item-header__art">
          <img src={item.icon} alt="" />
          {item.watermark && <img src={item.watermark} alt="" />}
        </span>
      )}
      <div className="item-header__id">
        <h2 className="item-header__name">
          <TierDiamonds item={item} className="tier-diamonds--inline" />
          {item.name}
        </h2>
        <p className="item-header__kind">
          {kind}
          {item.gearTier ? <span className="item-header__tier"> · Tier {item.gearTier}</span> : null}
          {item.masterworked ? <span className="item-header__mw"> · Masterworked</span> : null}
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
