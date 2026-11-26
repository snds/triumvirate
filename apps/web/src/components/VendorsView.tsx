// The Vendors screen: every vendor your character can visit, in the game's groups, with what each
// sells, what it costs against what you hold, and whether you already own it. Rolled weapons and
// armor open the item dialog with grades, like anything in your inventory.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { filterVendors } from '@triumvirate/core/browser';
import type { AppraisedItem, CharacterRow, VendorCard, VendorSale } from '@triumvirate/core';
import { fetchVendors, type VendorsResponse } from '../api.ts';
import { timeAgo, type Kind } from '../inventory.ts';
import { usePref } from '../prefs.ts';
import { CharacterPicker } from './CharacterPicker.tsx';
import { Icon } from './Icon.tsx';
import { ItemTile, artLoaded, artReady } from './ItemTile.tsx';
import { Reveal, Sk } from './Skeleton.tsx';

const tierClass = (tier?: string) => `tier-${(tier || 'common').toLowerCase()}`;

/** "3d 4h", "5h 20m", "12m": how long until a vendor's stock changes. */
function untilText(iso: string, now: number): string | undefined {
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  const m = Math.floor(ms / 60_000);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), min = m % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${min}m` : `${Math.max(1, min)}m`;
}

const compactNumber = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString());

export function VendorsView({ characters, characterId, onCharacter, compact, query, kind, onSelect }: {
  characters: CharacterRow[];
  /** The app's search and item kind, so one search box works on every screen. */
  query: string;
  kind: Kind;
  characterId: string;
  onCharacter: (id: string) => void;
  compact: boolean;
  onSelect: (i: AppraisedItem) => void;
}) {
  const [data, setData] = useState<VendorsResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [unowned, setUnowned] = usePref('vendors.unowned', false);
  const [noSilver, setNoSilver] = usePref('vendors.noSilver', true);
  // Ticks once a minute so reset countdowns stay true while the screen is open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);

  const load = useCallback(async (refresh = false) => {
    setBusy(true);
    try {
      setData(await fetchVendors(characterId || undefined, refresh));
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [characterId]);
  useEffect(() => { void load(); }, [load]);

  const groups = useMemo(() => (data ? filterVendors(data.groups, { unowned, noSilver, query, itemTypes: kind === 'weapons' ? [3] : kind === 'armor' ? [2] : undefined }) : []), [data, unowned, noSilver, query, kind]);
  const filtering = unowned || noSilver || query.trim() !== '' || kind !== 'all';
  const shownFor = data && data.characterId === characterId;
  const character = characters.find((c) => c.id === (data?.characterId ?? characterId));

  return (
    <section className="vendors" aria-label="Vendors">
      <header className="vendors__header">
        <div>
          <h2 className="vendors__title">Vendors</h2>
          <p className="muted vendors__lede">
            {data ? `Prices against what your ${character?.className ?? 'character'} holds. Checked ${timeAgo(data.fetchedAt)}.` : 'What every vendor sells today, and what you can afford.'}
          </p>
        </div>
        {characters.length > 1 && (
          <CharacterPicker className="vendors__picker" characters={characters} value={characterId ?? ''} onChange={onCharacter} />
        )}
      </header>

      <div className="vendors__tools">
        <button className={`chip${unowned ? ' is-selected' : ''}`} aria-pressed={unowned} onClick={() => setUnowned((v) => !v)}>
          <Icon name="filter" /> Not owned
        </button>
        <button className={`chip${noSilver ? ' is-selected' : ''}`} aria-pressed={noSilver} onClick={() => setNoSilver((v) => !v)}>
          <Icon name="sale" /> Hide silver
        </button>
        <button className={`icon-button${busy ? ' is-busy' : ''}`} onClick={() => void load(true)} disabled={busy} aria-label="Check vendors again" title="Check vendors again">
          <Icon name="refresh" />
        </button>
      </div>

      {error && <p className="vendors__error" role="alert"><Icon name="warning" /> {error}</p>}

      <Reveal loading={!shownFor && !error} skeleton={<VendorsSkeleton />} label="Loading vendors">
        {data && groups.length === 0 && (
          <p className="empty">{filtering ? 'Nothing on sale matches. Try turning a filter off.' : 'No vendor has anything to show right now.'}</p>
        )}
        {data && groups.length > 0 && (
          <div className="vendors__layout">
            {/* A jump list of every vendor, for a long desktop page. */}
            {!compact && (
              <nav className="vendors__rail" aria-label="Jump to vendor">
                {groups.map((g) => (
                  <div key={g.hash} className="vendors__rail-group">
                    <span className="vendors__rail-title">{g.name}</span>
                    {g.vendors.map((v) => (
                      <a key={v.hash} href={`#vendor-${v.hash}`} className="vendors__rail-link" onClick={(e) => { e.preventDefault(); document.getElementById(`vendor-${v.hash}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }}>
                        {v.icon && <img src={v.icon} alt="" />}
                        <span>{v.name}</span>
                      </a>
                    ))}
                  </div>
                ))}
              </nav>
            )}
            <div className="vendors__groups">
              {groups.map((g) => (
                <section key={g.hash} className="vendors__group" aria-label={g.name}>
                  <h3 className="vendors__group-title">{g.name}</h3>
                  {g.vendors.map((v) => <VendorCardView key={v.hash} vendor={v} data={data} now={now} onSelect={onSelect} />)}
                </section>
              ))}
            </div>
          </div>
        )}
      </Reveal>
    </section>
  );
}

function VendorCardView({ vendor: v, data, now, onSelect }: { vendor: VendorCard; data: VendorsResponse; now: number; onSelect: (i: AppraisedItem) => void }) {
  const resets = v.refreshesAt ? untilText(v.refreshesAt, now) : undefined;
  const pct = v.rank && v.rank.next > 0 ? Math.min(100, (v.rank.progress / v.rank.next) * 100) : 0;
  return (
    <article className="vendor-card" id={`vendor-${v.hash}`}>
      <header className="vendor-card__head">
        {v.icon ? <img className="vendor-card__icon" src={v.icon} alt="" /> : <span className="vendor-card__icon" aria-hidden><Icon name="vendor" /></span>}
        <div className="vendor-card__titles">
          <h4 className="vendor-card__name">{v.name}</h4>
          <p className="vendor-card__meta">{[v.subtitle, v.location].filter(Boolean).join(' · ')}</p>
        </div>
        {resets && <span className="vendor-card__reset" title={`New stock ${new Date(v.refreshesAt!).toLocaleString()}`}><Icon name="timer" /> {resets}</span>}
      </header>
      {v.rank && (
        <div className="vendor-rank" aria-label={`${v.rank.name}: ${v.rank.rank}, rank ${v.rank.step} of ${v.rank.steps}`}>
          <div className="vendor-rank__text">
            <span className="vendor-rank__name">{v.rank.name}</span>
            <span><strong>{v.rank.rank || `Rank ${v.rank.step}`}</strong> <span className="muted">{v.rank.step}/{v.rank.steps}</span></span>
            {v.rank.resets > 0 && <span className="vendor-rank__resets" title="Times reset"><Icon name="autorenew" /> {v.rank.resets}</span>}
          </div>
          {v.rank.next > 0 && (
            <div className="vendor-rank__bar" role="progressbar" aria-valuemin={0} aria-valuemax={v.rank.next} aria-valuenow={v.rank.progress}>
              <span style={{ width: `${pct}%` }} />
            </div>
          )}
          {v.rank.next > 0 && <span className="vendor-rank__numbers muted">{v.rank.progress.toLocaleString()} / {v.rank.next.toLocaleString()}</span>}
        </div>
      )}
      {v.categories.map((c) => (
        <section key={c.name} className="vendor-cat" aria-label={c.name}>
          <h5 className="vendor-cat__title">{c.name} <span className="muted">{c.sales.length}</span></h5>
          <ul className="vendor-cat__grid">
            {c.sales.map((s, i) => <SaleView key={`${s.index}-${i}`} sale={s} data={data} onSelect={onSelect} />)}
          </ul>
        </section>
      ))}
    </article>
  );
}

function SaleView({ sale: s, data, onSelect }: { sale: VendorSale; data: VendorsResponse; onSelect: (i: AppraisedItem) => void }) {
  const row = s.rowId ? data.items[s.rowId] : undefined;
  const grade = s.rowId ? data.grades[s.rowId]?.grade : undefined;
  const fits = s.rowId ? data.fits[s.rowId] : undefined;
  const label = [s.name, s.type, s.owned && 'owned', s.failure].filter(Boolean).join(' · ');
  return (
    <li className={`sale${s.failure ? ' is-locked' : ''}${s.owned ? ' is-owned' : ''}`} title={s.failure ? `${s.name}: ${s.failure}` : undefined}>
      <div className="sale__art">
        {row ? <ItemTile item={row} onSelect={onSelect} /> : (
          <div className={`tile ${tierClass(s.tier)}`} role="img" aria-label={label}>
            {s.icon && <img className="tile__icon" src={s.icon} alt="" decoding="async" draggable={false} ref={artReady} onLoad={artLoaded} />}
            {s.watermark && <img className="tile__watermark" src={s.watermark} alt="" decoding="async" draggable={false} />}
            {s.quantity > 1 && <span className="tile__power">{compactNumber(s.quantity)}</span>}
          </div>
        )}
        {s.owned && <span className="sale__owned" title="You own this"><Icon name="check" /></span>}
        {grade && <span className={`sale__grade grade--${grade.toLowerCase()}`} title={`Community grade ${grade}`}>{grade}</span>}
        {s.failure && <span className="sale__lock" aria-hidden><Icon name="lock" filled /></span>}
      </div>
      <span className="sale__name">{s.name}</span>
      {fits?.length ? <span className="sale__fit" title={`Best in slot for ${fits.join(', ')}`}><Icon name="builds" /><span>{fits.length === 1 ? fits[0] : `${fits.length} builds`}</span></span> : null}
      {s.costs.length > 0 && (
        <span className="sale__costs">
          {s.costs.map((c) => {
            const short = c.have !== undefined && c.have < c.quantity;
            return (
              <span
                key={c.itemHash}
                className={`sale__cost${short ? ' is-short' : ''}`}
                title={`${c.quantity.toLocaleString()} ${c.name}${c.have !== undefined ? ` (you have ${c.have.toLocaleString()})` : ''}`}
              >
                {c.icon ? <img src={c.icon} alt={c.name} /> : <span className="visually-hidden">{c.name}</span>}
                {compactNumber(c.quantity)}
              </span>
            );
          })}
        </span>
      )}
    </li>
  );
}

function VendorsSkeleton() {
  return (
    <div className="vendors__groups">
      {[0, 1].map((g) => (
        <div key={g} className="vendor-card">
          <div className="vendor-card__head">
            <Sk kind="round" style={{ width: 48, height: 48 }} />
            <div className="vendor-card__titles"><Sk kind="title" style={{ width: '30%' }} /><Sk kind="line" style={{ width: '45%' }} /></div>
          </div>
          <div className="vendor-cat__grid">
            {Array.from({ length: 8 }, (_, i) => <Sk key={i} kind="block" style={{ width: 'calc(var(--tile-base) * var(--tile-scale))', aspectRatio: '1' }} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
