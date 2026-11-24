import { useEffect, useRef } from 'react';
import type { AppraisedItem } from '@triumvirate/core/browser';
import { Icon } from './Icon.tsx';
import { ItemFacts, itemSummary, PerkGrid, StatBars, TierDiamonds, VerdictLine } from './ItemParts.tsx';
import { ItemTile } from './ItemTile.tsx';
import { useInventory } from '../inventory-context.ts';

interface Props {
  item: AppraisedItem;
  onClose: () => void;
  /** Sends a question about this item to the chat panel. */
  onAsk: (question: string) => void;
  /** Other copies of the same item you own. */
  copies: AppraisedItem[];
  onSelect: (item: AppraisedItem) => void;
}

/** Peek panel: everything about one item, docked over the right side. */
export function ItemDetail({ item, onClose, onAsk, copies, onSelect }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  // Escape closes the panel, like any dialog; focus moves in so keyboard users land here.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onClose]);

  const a = item.appraisal;
  const tier = item.tier.toLowerCase() || 'common';
  const details: [string, string | number | undefined][] = [
    ['Location', `${item.location}${item.equipped ? ' (equipped)' : ''}`],
    ['Power', item.power],
    ['Element', item.damage],
    ['Champion stun', item.breaker?.name],
    ['Gear tier', item.gearTier],
    ['Masterworked', item.itemType === 2 || item.itemType === 3 ? (item.masterworked ? 'Yes' : 'No') : undefined],
    ['Locked', item.locked ? 'Yes' : 'No'],
  ];
  return (
    <aside className="drawer" role="dialog" aria-label={item.name}>
      <header className={`drawer__header tier-${tier}${item.masterworked ? ' is-masterworked' : ''}`}>
        {item.icon && <img className="drawer__icon" src={item.icon} alt="" />}
        <div className="drawer__heading">
          <h2 className="drawer__title"><TierDiamonds item={item} className="tier-diamonds--inline" />{item.name}</h2>
          <p className="drawer__meta">{itemSummary(item)}</p>
          {item.flavorText && <p className="drawer__flavor">{item.flavorText}</p>}
        </div>
        <button ref={closeRef} className="icon-button drawer__close" onClick={onClose} aria-label="Close" title="Close">
          <Icon name="close" />
        </button>
      </header>

      <div className="drawer__body">
        <div className="drawer__actions">
          <button className="button" onClick={() => onAsk(`Tell me about my ${item.name}${item.power ? ` (${item.power})` : ''}. Is it worth keeping, and what would I use it for?`)}>
            <Icon name="chat" /> Ask about this item
          </button>
          <a className="button button--quiet" href={`https://www.light.gg/db/items/${item.itemHash}/`} target="_blank" rel="noreferrer">
            Open on light.gg <Icon name="openExternal" />
          </a>
        </div>

        <MoveButtons item={item} />

        <ItemFacts item={item} copies={copies.length} />

        {a && (
          <section className={`verdict verdict--${a.verdict}`}>
            <VerdictLine item={item} />
            {a.rollCount > 0 && <p className="verdict__notes">{a.rollCount} curated rolls exist for this weapon.</p>}
            {a.notes && <p className="verdict__notes">{a.notes}</p>}
          </section>
        )}

        {item.perks && item.perks.length > 0 && (
          <section>
            <h3 className="drawer__section">Perks</h3>
            <PerkGrid item={item} showNames />
            {(a?.wishedPerks?.length ?? 0) > 0 && (
              <p className="drawer__legend"><span className="perk-cell__wish perk-cell__wish--inline"><Icon name="check" /></span> In a recommended roll</p>
            )}
          </section>
        )}

        {item.stats && Object.keys(item.stats).length > 0 && (
          <section>
            <h3 className="drawer__section">Stats</h3>
            <StatBars item={item} />
          </section>
        )}

        {copies.length > 0 && (
          <section>
            <h3 className="drawer__section">Other copies you own</h3>
            <ul className="copies">
              {copies.map((c, n) => (
                <li key={c.instanceId ?? n} className="copy">
                  <ItemTile item={c} onSelect={onSelect} />
                  <div className="copy__body">
                    <span className="copy__where">
                      {c.power !== undefined && <strong>{c.power}</strong>} {c.location}{c.equipped ? ' (equipped)' : ''}
                    </span>
                    <VerdictLine item={c} />
                    <PerkGrid item={c} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3 className="drawer__section">Details</h3>
          <dl className="details">
            {details.filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => (
              <div className="details__row" key={k}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        </section>
      </div>
    </aside>
  );
}

/** The keyboard-friendly way to move an item: one button per place it could go. */
function MoveButtons({ item }: { item: AppraisedItem }) {
  const inv = useInventory();
  if (!item.movable || item.equipped) return null;
  const busy = !!item.instanceId && inv.moving.has(item.instanceId);
  const places = [...inv.characters.map((c) => ({ id: c.id, label: c.className })), { id: 'vault', label: 'Vault' }];
  const options = places
    .map((p) => ({ ...p, check: inv.check(item, p.id) }))
    .filter((p) => p.check.ok || !p.check.quiet);
  if (options.length === 0) return null;
  return (
    <div className="move-to" role="group" aria-label="Move to">
      <span className="move-to__label">Move to</span>
      {options.map((p) => (
        <button
          key={p.id}
          className="button button--quiet"
          disabled={busy || !p.check.ok}
          title={p.check.ok ? `Move to ${p.label}` : p.check.reason}
          onClick={() => inv.move(item, p.id)}
        >
          {p.label}
        </button>
      ))}
      {busy && <span className="spinner" aria-label="Moving" />}
    </div>
  );
}
