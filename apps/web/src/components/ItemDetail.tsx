import { useEffect } from 'react';
import type { AppraisedItem } from '@triumvirate/core';
import { VERDICT_LABEL } from './ItemTile.tsx';

export function ItemDetail({ item, onClose }: { item: AppraisedItem; onClose: () => void }) {
  // Escape closes the panel, like any dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const a = item.appraisal;
  const stats = item.stats ? Object.entries(item.stats) : [];
  const total = stats.reduce((sum, [, v]) => sum + v, 0);
  return (
    <aside className="drawer" role="dialog" aria-label={item.name}>
      <header className="drawer__header">
        {item.icon && <img className="drawer__icon" src={item.icon} alt="" />}
        <div>
          <h2 className="drawer__title">{item.name}</h2>
          <p className="muted">
            {[item.tier, item.type, item.damage, item.power && `${item.power} power`,
              item.gearTier && `Tier ${item.gearTier}`].filter(Boolean).join(' · ')}
          </p>
          <p className="muted">{item.location}{item.equipped ? ' · equipped' : ''}{item.locked ? ' · locked' : ''}</p>
        </div>
        <button className="button button--quiet drawer__close" onClick={onClose} aria-label="Close">✕</button>
      </header>

      {a && (
        <section className={`verdict verdict--${a.verdict}`}>
          <strong>{VERDICT_LABEL[a.verdict]}</strong>
          {(a.pve || a.pvp) && <span className="muted"> · {[a.pve && 'PvE', a.pvp && 'PvP'].filter(Boolean).join(' and ')}</span>}
          {a.rollCount > 0 && <span className="muted"> · {a.rollCount} curated rolls for this weapon</span>}
          {a.notes && <p className="verdict__notes">{a.notes}</p>}
        </section>
      )}

      {item.perks && item.perks.length > 0 && (
        <section>
          <h3 className="drawer__section">Perks</h3>
          <div className="perks">
            {item.perks.map((col, c) => (
              <ul className="perks__column" key={c}>
                {col.map((p) => (
                  <li key={p.name} className={`perk${p.active ? ' perk--active' : ''}`}>
                    {p.icon && <img src={p.icon} alt="" />}
                    <span>{p.name}</span>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </section>
      )}

      {stats.length > 0 && (
        <section>
          <h3 className="drawer__section">Stats <span className="muted">· total {total}</span></h3>
          <dl className="stats">
            {stats.map(([name, v]) => (
              <div className="stats__row" key={name}>
                <dt>{name}</dt>
                <dd>
                  <span className="stats__bar" style={{ width: `${Math.min(100, (v / 45) * 100)}%` }} />
                  {v}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </aside>
  );
}
