import { useEffect, useRef } from 'react';
import type { AppraisedItem } from '@triumvirate/core/browser';
import { Icon } from './Icon.tsx';
import { itemSummary, PerkGrid, StatBars, VerdictLine } from './ItemParts.tsx';

interface Props {
  item: AppraisedItem;
  onClose: () => void;
  /** Sends a question about this item to the chat panel. */
  onAsk: (question: string) => void;
}

/** Peek panel: everything about one item, docked over the right side. */
export function ItemDetail({ item, onClose, onAsk }: Props) {
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
    ['Gear tier', item.gearTier],
    ['Locked', item.locked ? 'Yes' : 'No'],
  ];
  return (
    <aside className="drawer" role="dialog" aria-label={item.name}>
      <header className={`drawer__header tier-${tier}`}>
        {item.icon && <img className="drawer__icon" src={item.icon} alt="" />}
        <div className="drawer__heading">
          <h2 className="drawer__title">{item.name}</h2>
          <p className="drawer__meta">{itemSummary(item)}</p>
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
