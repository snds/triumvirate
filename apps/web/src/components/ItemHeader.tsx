import { useState } from 'react';
import type { AppraisedItem } from '@triumvirate/core/browser';
import { AmmoIcon } from './AmmoIcon.tsx';
import { ElementIcon } from './ElementIcon.tsx';
import { TierDiamonds } from './ItemParts.tsx';

/**
 * The item's identity band, shared by the hovercard and the item dialog: tier diamonds and name,
 * art with tier diamonds, name, rarity and type, then power with element, champion stun, and ammo. Tier color fills it;
 * masterworked items get the gold banner.
 */
export function ItemHeader({ item, size, preview, children }: {
  item: AppraisedItem;
  size: 'card' | 'dialog';
  /** An ornament previewed from the dialog's strip: its render and name stand in for the applied look. */
  preview?: { name: string; screenshot?: string; isDefault?: boolean };
  /** Extra content for the dialog, such as the close button. */
  children?: React.ReactNode;
}) {
  const tier = item.tier.toLowerCase() || 'common';
  // The dialog shows Bungie's large render behind the header. It fades in over the tier color once
  // loaded; if it fails (a few old weapons 404), the header falls back to the icon layout.
  const [art, setArt] = useState<{ src: string; state: 'loading' | 'loaded' | 'failed' }>();
  // (api.ts already points bungie.net URLs at the app's image proxy.)
  const shot = size === 'dialog' ? (preview ? preview.screenshot : item.screenshot) : undefined;
  const artState = shot && art?.src === shot ? art.state : 'loading';
  const hasArt = !!shot && artState !== 'failed';
  return (
    <header className={`item-header item-header--${size} tier-${tier}${item.itemType === 2 ? ' is-armor' : ''}${item.masterworked ? ' is-masterworked' : ''}${hasArt ? ' has-art' : ''}${hasArt && artState === 'loaded' ? ' is-art-loaded' : ''}`}>
      {hasArt && (
        <>
          <img
            key={shot}
            className="item-header__backdrop"
            src={shot}
            alt=""
            onLoad={() => setArt({ src: shot, state: 'loaded' })}
            onError={() => setArt({ src: shot, state: 'failed' })}
          />
          <span className="item-header__scrim" aria-hidden />
          {preview
            ? <span className="item-header__tag is-preview">{preview.isDefault ? 'Default look' : preview.name}</span>
            : item.ornament && <span className="item-header__tag">{item.ornament.name}</span>}
        </>
      )}
      {/* The art, dressed like the inventory tile: watermark, masterwork shimmer, and the
          tier diamonds standing in a column under the release icon. */}
      {item.icon && !hasArt && (
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
