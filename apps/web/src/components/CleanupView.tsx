import { useState } from 'react';
import { dimSearch, type AppraisedItem, type CleanupCandidate } from '@triumvirate/core/browser';
import { ItemTile } from './ItemTile.tsx';

export function CleanupView({ cleanup, onSelect }: { cleanup: CleanupCandidate[]; onSelect: (i: AppraisedItem) => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(dimSearch(cleanup));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const high = cleanup.filter((c) => c.confidence === 'high').length;
  return (
    <section className="cleanup">
      <header className="cleanup__header">
        <div>
          <h2 className="vault__title">Cleanup <span className="vault__count">{cleanup.length}</span></h2>
          <p className="muted">
            {high} safe picks and {cleanup.length - high} worth a look. Locked and equipped items are never listed.
            Dismantle in game, or paste the search into DIM to select them all there.
          </p>
        </div>
        <button className="button" onClick={copy} disabled={cleanup.length === 0}>
          {copied ? 'Copied' : 'Copy DIM search'}
        </button>
      </header>
      {cleanup.length === 0 && <p className="empty">Nothing to clean up. Nice.</p>}
      <ul className="cleanup__list">
        {cleanup.map((c, n) => (
          <li className="cleanup__row" key={c.item.instanceId ?? n}>
            <ItemTile item={c.item} onSelect={onSelect} />
            <div>
              <strong>{c.item.name}</strong> <span className="muted">· {c.item.type} · {c.item.location}</span>
              <p className="cleanup__reason">{c.reason}</p>
            </div>
            <span className={`pill pill--${c.confidence}`}>{c.confidence === 'high' ? 'Safe' : 'Check'}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
