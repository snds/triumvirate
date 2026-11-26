// Farming targets: weapons with a god roll you don't have yet, grouped by where they drop, with
// vendors selling them right now on top. The roll to chase is spelled out perk by perk.
import { useEffect, useMemo, useState } from 'react';
import { sourceGroup, type AppraisedItem, type FarmTarget } from '@triumvirate/core/browser';
import { fetchFarming, type FarmingResponse } from '../api.ts';
import { timeAgo } from '../inventory.ts';
import { Icon } from './Icon.tsx';
import { ItemTile } from './ItemTile.tsx';
import { Sheet } from '../ui/Sheet.tsx';

type Show = 'all' | 'sale' | 'owned';
const SHOW_LABEL: Record<Show, string> = { all: 'All', sale: 'On sale now', owned: 'You own one' };
const USE_LABEL = { pve: 'PvE', pvp: 'PvP', both: 'PvE + PvP' } as const;
const USE_ICON = { pve: 'pve', pvp: 'pvp', both: 'both' } as const;

/** A target dressed as an item, so it gets the same tile (rarity border, watermark, hovercard). */
const asItem = (t: FarmTarget): AppraisedItem => ({
  name: t.name, type: t.type, tier: t.tier, itemHash: t.itemHash, icon: t.icon, watermark: t.watermark, damage: t.damage,
  itemType: 3, classType: 3, location: t.source ?? '', owner: 'none', bucket: '', equipped: false, locked: false,
});

export function FarmingSheet({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<FarmingResponse>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState<Show>('all');
  const load = (refresh = false) => {
    setBusy(true);
    return fetchFarming(refresh).then((d) => { setData(d); setError(''); }, (e: Error) => setError(e.message)).finally(() => setBusy(false));
  };
  useEffect(() => { void load(); }, []);

  const shown = (data?.targets ?? []).filter((t) => show === 'all' || (show === 'sale' ? !!t.vendor : t.owned.copies > 0));
  // On sale now gets its own group on top; the rest group by where they drop, biggest groups first.
  const groups = useMemo(() => {
    const sale = shown.filter((t) => t.vendor);
    const by = new Map<string, FarmTarget[]>();
    for (const t of shown.filter((t) => !t.vendor)) {
      const k = sourceGroup(t.source);
      by.set(k, [...(by.get(k) ?? []), t]);
    }
    // Biggest groups first; weapons with no known source go last.
    const rest = [...by].sort((a, b) => Number(a[0] === 'Other') - Number(b[0] === 'Other') || b[1].length - a[1].length || a[0].localeCompare(b[0]));
    return [...(sale.length ? [['On sale now', sale] as [string, FarmTarget[]]] : []), ...rest];
  }, [shown]);

  return (
    <Sheet
      title="Farming targets"
      onClose={onClose}
      full
      footer={(
        <div className="sheet__actions">
          <p className="muted farming__note">
            {data?.vendorError ? `Vendors aren't available: ${data.vendorError}`
              : data?.vendorsAt ? `Vendors checked ${timeAgo(data.vendorsAt)}.` : ''}
          </p>
          <button className="button" disabled={busy} onClick={() => void load(true)}>
            <Icon name={busy ? 'autorenew' : 'refresh'} /> Check vendors
          </button>
        </div>
      )}
    >
      <p className="sheet__body">
        God rolls from your wish list that you don't have yet: weapons you already chase, weapons players use most, and what vendors sell today.
      </p>
      <div className="farming__filters" role="group" aria-label="Show">
        {(Object.keys(SHOW_LABEL) as Show[]).map((s) => (
          <button key={s} className={`chip${show === s ? ' is-selected' : ''}`} aria-pressed={show === s} onClick={() => setShow(s)}>
            {s === 'sale' && <Icon name="sale" />}{SHOW_LABEL[s]}
            {data && <span className="muted">{s === 'all' ? data.targets.length : data.targets.filter((t) => (s === 'sale' ? !!t.vendor : t.owned.copies > 0)).length}</span>}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">Finding targets…</p>}
      {data && shown.length === 0 && <p className="empty">{show === 'sale' ? 'No vendor sells a target right now.' : 'Nothing to chase here. Nice.'}</p>}
      {data && !data.sourcesKnown && <p className="muted">Drop locations show up after the next item table update.</p>}
      {groups.map(([name, list]) => (
        <section key={name} className="farming__group">
          <h3 className="farming__group-head">
            {name === 'On sale now' ? <Icon name="sale" /> : <Icon name="target" />} {name} <span className="muted">{list.length}</span>
          </h3>
          <ul className="farming__list">
            {list.map((t) => (
              <li key={t.itemHash} className="farming__row">
                <ItemTile item={asItem(t)} />
                <div className="farming__body">
                  <div className="farming__title">
                    <strong>{t.name}</strong> <span className="muted">· {t.type}</span>
                    <span className={`use-pill use-pill--${t.roll.use}`} title={`God roll for ${USE_LABEL[t.roll.use]}`}>
                      <Icon name={USE_ICON[t.roll.use]} filled /> {USE_LABEL[t.roll.use]}
                    </span>
                  </div>
                  <ul className="farming__perks" aria-label="God roll perks">
                    {t.roll.perks.map((p) => <li key={p}>{p}</li>)}
                  </ul>
                  <p className="farming__why">
                    {t.vendor && <span className={`pill ${t.vendor.god ? 'pill--wish-god' : 'pill--neutral'}`}>{t.vendor.god ? 'God roll on sale' : `At ${t.vendor.name}`}</span>}
                    {' '}{t.why}{t.source && name === 'On sale now' ? ` Also drops from ${sourceGroup(t.source)}.` : ''}
                    {t.godRolls > 1 && <span className="muted"> {t.godRolls} god rolls listed.</span>}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Sheet>
  );
}
