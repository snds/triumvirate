// The daily digest: new drops since yesterday, vendor weapons worth buying, and how full the vault is.
import { useEffect, useState } from 'react';
import type { AppraisedItem, DigestItem } from '@triumvirate/core/browser';
import { fetchDigest, runDigest, type DigestResponse } from '../api.ts';
import { ItemTile } from './ItemTile.tsx';
import { Icon } from './Icon.tsx';
import { Sheet } from './Sheet.tsx';

const longDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const shortDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export function DigestSheet({ items, onSelect, onClose, onSeen }: {
  items: AppraisedItem[];
  onSelect: (item: AppraisedItem) => void;
  onClose: () => void;
  /** Called with the date of the digest shown, so the Today button can drop its dot. */
  onSeen: (date: string) => void;
}) {
  const [data, setData] = useState<DigestResponse>();
  const [error, setError] = useState('');
  const [building, setBuilding] = useState(false);
  const load = (date?: string) => fetchDigest(date).then(setData, (e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (data?.digest) onSeen(data.digest.date); }, [data?.digest?.date]); // eslint-disable-line react-hooks/exhaustive-deps

  const build = async () => {
    setBuilding(true);
    setError('');
    const res = await runDigest();
    if (res.error) setError(res.error); else setData(res);
    setBuilding(false);
  };
  const d = data?.digest;
  const byId = new Map(items.filter((i) => i.instanceId).map((i) => [i.instanceId!, i]));
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time

  return (
    <Sheet
      title="Daily digest"
      onClose={onClose}
      full
      footer={(
        <div className="sheet__actions">
          {error && <p className="error editor__error">{error}</p>}
          {(data?.dates.length ?? 0) > 1 && (
            <select className="optimizer__select digest__dates" aria-label="Day" value={d?.date ?? ''} onChange={(e) => void load(e.target.value)}>
              {data!.dates.map((x) => <option key={x} value={x}>{shortDate(x)}</option>)}
            </select>
          )}
          <button className="button button--primary" disabled={building} onClick={() => void build()}>
            <Icon name="refresh" /> {building ? 'Building…' : d?.date === today ? 'Rebuild today' : 'Build today'}
          </button>
        </div>
      )}
    >
      {!data && !error && <p className="muted">Loading…</p>}
      {data && !d && (
        <div className="digest__empty">
          <p>No digest yet. Build one now, or set <code>DIGEST_HOUR</code> on the server to get one every morning.</p>
          <p className="muted">The first one takes stock of what you own; new drops show up from the next one on.</p>
        </div>
      )}
      {d && (
        <article className="digest" aria-busy={building || undefined}>
          <header className="digest__head">
            <h3 className="digest__date">{longDate(d.date)}</h3>
            <p className="muted digest__built">Built at {time(d.builtAt)}{d.crawl?.samples ? ` · grades from ${d.crawl.samples.toLocaleString()} community loadouts` : ''}</p>
          </header>
          {d.lede && <p className="digest__lede">{d.lede}</p>}
          <dl className="digest__facts">
            <div><dt>New items</dt><dd>{d.firstRun ? '–' : d.drops.total}</dd></div>
            <div><dt>Vault</dt><dd>{d.vault.used}<span className="muted">/{d.vault.capacity}</span></dd></div>
            <div><dt>Cleanup picks</dt><dd>{d.cleanup.count}{d.cleanup.high ? <span className="digest__sub">{d.cleanup.high} high confidence</span> : null}</dd></div>
          </dl>

          {d.firstRun
            ? <p className="muted">This first digest takes stock of everything you own. Tomorrow's will list what's new.</p>
            : (
              <>
                <Section title="New weapons" icon="drop" list={d.drops.weapons} byId={byId} onSelect={onSelect} empty="No new weapons." />
                <Section title="New armor" icon="equip" list={d.drops.armor} byId={byId} onSelect={onSelect} empty="No new armor." />
              </>
            )}
          <Section title="Worth buying" icon="vendor" list={d.vendors} byId={byId} onSelect={onSelect} empty="Nothing at vendors graded A or better, or on your wish list." />
        </article>
      )}
    </Sheet>
  );
}

function Section({ title, icon, list, byId, onSelect, empty }: {
  title: string; icon: 'drop' | 'equip' | 'vendor'; list: DigestItem[]; byId: Map<string, AppraisedItem>; onSelect: (i: AppraisedItem) => void; empty: string;
}) {
  return (
    <section className="digest__section">
      <h4 className="drawer__section"><Icon name={icon} /> {title} <span className="vault__count">{list.length}</span></h4>
      {list.length === 0 ? <p className="muted digest__none">{empty}</p> : (
        <ul className="activity__list">
          {list.map((x, n) => {
            // Owned items open their detail; anything gone (or for sale) shows its art only.
            const owned = x.instanceId ? byId.get(x.instanceId) : undefined;
            return (
              <li key={x.instanceId ?? `${x.itemHash}-${n}`} className={`activity__row tier-${x.tier.toLowerCase()}`}>
                {owned
                  ? <ItemTile item={owned} onSelect={onSelect} />
                  : <span className={`tile tile--md digest__art tier-${x.tier.toLowerCase()}`} aria-hidden>{x.icon && <img src={x.icon} alt="" />}</span>}
                <div className="activity__text">
                  <span className="activity__name" title={x.name}>{x.name}</span>
                  <span className="activity__meta">{[x.note, x.type, owned?.location ?? x.where].filter(Boolean).join(' · ')}</span>
                </div>
                {x.grade || x.verdict
                  ? <span className={`grade grade--sm grade--${(x.grade ?? 'none').toLowerCase()}`} title={x.grade ? `Popularity grade ${x.grade}` : undefined}>{x.grade ?? '–'}</span>
                  : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
