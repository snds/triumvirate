// Roll appraiser: every legendary and exotic weapon you own, grouped by type, graded against what
// the community actually runs (our own crawl of public matches). Modeled on a popularity appraiser:
// a letter grade per copy, PvE / PvP marks on perks, and an arrow where a better option exists.
import { useEffect, useMemo, useState } from 'react';
import type { AppraisedItem, CommunityAppraisal, Grade, PerkMark, PerkOption, Role, Verdict } from '@triumvirate/core';
import { scoreRoll, toGrade } from '@triumvirate/core/browser';
import { applyPerks, fetchCommunityAppraisals, type CommunityAppraisals } from '../api.ts';
import {
  defaultFilters, GRADE_ORDER, groupByType, isAppraisable, passes, pct, ROLE_LABEL, ROLL_TYPE_LABEL,
  type RollFilters, type RollType,
} from '../rolls-view.ts';
import { ItemTile } from './ItemTile.tsx';
import { Icon } from './Icon.tsx';
import { timeAgo } from '../inventory.ts';

const VERDICTS: { value: Verdict; label: string }[] = [
  { value: 'god', label: 'Wish list god roll' },
  { value: 'good', label: 'Wish list match' },
  { value: 'meh', label: 'No wish list match' },
  { value: 'trash', label: 'Wish list trash' },
  { value: 'unrated', label: 'Not on the wish list' },
];
const ROLES = Object.keys(ROLE_LABEL) as Role[];
const ROLL_TYPES = Object.keys(ROLL_TYPE_LABEL) as RollType[];

export function RollsView({ items, syncedAt, onSelect, onChanged }: {
  items: AppraisedItem[];
  /** Called after perks change in game, so the app reloads the inventory. */
  onChanged: () => void;
  /** Refetch grades whenever the inventory changes. */
  syncedAt: string;
  onSelect: (i: AppraisedItem) => void;
}) {
  const [data, setData] = useState<CommunityAppraisals>();
  const [error, setError] = useState<string>();
  const [filters, setFilters] = useState<RollFilters>(defaultFilters);
  const [railOpen, setRailOpen] = useState(true);
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    fetchCommunityAppraisals().then((d) => { if (live) { setData(d); setError(undefined); } }, (e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [syncedAt]);

  const weapons = useMemo(() => items.filter(isAppraisable), [items]);
  const grades = data?.items ?? {};
  const shown = weapons.filter((i) => passes(i, i.instanceId ? grades[i.instanceId] : undefined, filters));
  const groups = groupByType(shown, grades);
  const locations = [...new Set(weapons.map((i) => i.location))].sort();
  const types = [...new Set(weapons.map((i) => i.type))].sort();
  const changed = JSON.stringify(serialize(filters)) !== JSON.stringify(serialize(defaultFilters()));

  const toggle = <K extends keyof RollFilters>(key: K, value: RollFilters[K] extends Set<infer V> ? V : never) =>
    setFilters((f) => {
      const next = new Set(f[key] as Set<unknown>);
      if (next.has(value)) next.delete(value); else next.add(value);
      return { ...f, [key]: next };
    });

  return (
    <section className={`rolls${railOpen ? '' : ' rolls--rail-closed'}`}>
      <aside className="rolls__rail" aria-label="Filters">
        <header className="rolls__rail-head">
          <button className="button button--quiet" onClick={() => setRailOpen((v) => !v)} aria-expanded={railOpen}>
            <Icon name="filter" /> Filters{changed ? ' (on)' : ''}
          </button>
          {railOpen && changed && <button className="button button--quiet" onClick={() => setFilters(defaultFilters())}>Reset</button>}
        </header>
        {railOpen && (
          <div className="rolls__rail-body">
            <FilterGroup title="Community roll type">
              {ROLL_TYPES.map((t) => (
                <Check key={t} checked={filters.rollTypes.has(t)} onChange={() => toggle('rollTypes', t)}>
                  {t !== 'none' && <UseIcon use={t} />} {ROLL_TYPE_LABEL[t]}
                </Check>
              ))}
            </FilterGroup>
            <FilterGroup title="Most used for">
              {ROLES.map((r) => (
                <Check key={r} checked={filters.usedFor.has(r)} onChange={() => toggle('usedFor', r)}>{ROLE_LABEL[r]}</Check>
              ))}
            </FilterGroup>
            <FilterGroup title="Popularity grade">
              <div className="rolls__range">
                <GradeSelect label="Lowest" value={filters.gradeMin} onChange={(g) => setFilters((f) => ({ ...f, gradeMin: g }))} />
                <span className="muted">to</span>
                <GradeSelect label="Highest" value={filters.gradeMax} onChange={(g) => setFilters((f) => ({ ...f, gradeMax: g }))} />
              </div>
              <Check checked={filters.betterPossibleOnly} onChange={() => setFilters((f) => ({ ...f, betterPossibleOnly: !f.betterPossibleOnly }))}>
                <Icon name="arrowUp" /> Better grade possible
              </Check>
            </FilterGroup>
            <FilterGroup title="Wish list">
              {VERDICTS.map((v) => (
                <Check key={v.value} checked={filters.verdicts.has(v.value)} onChange={() => toggle('verdicts', v.value)}>{v.label}</Check>
              ))}
            </FilterGroup>
            <FilterGroup title="Rarity">
              {['Exotic', 'Legendary'].map((r) => (
                <Check key={r} checked={filters.rarities.has(r)} onChange={() => toggle('rarities', r)}>{r}</Check>
              ))}
            </FilterGroup>
            <FilterGroup title="Location">
              {locations.map((l) => <Check key={l} checked={filters.locations.has(l)} onChange={() => toggle('locations', l)}>{l}</Check>)}
            </FilterGroup>
            <FilterGroup title="Weapon type" closed>
              {types.map((t) => <Check key={t} checked={filters.types.has(t)} onChange={() => toggle('types', t)}>{t}</Check>)}
            </FilterGroup>
          </div>
        )}
      </aside>

      <div className="rolls__main">
        <header className="rolls__head">
          <h2 className="vault__title">Roll appraiser <span className="vault__count">{shown.length} of {weapons.length}</span></h2>
          <p className="muted">
            {error ? `Community data isn't available: ${error}`
              : !data ? 'Loading community data…'
              : data.samples === 0 ? 'No community data yet. Run a crawl to fill it in.'
              : `Grades come from ${data.samples.toLocaleString()} rolls seen in public matches${data.builtAt ? `, updated ${timeAgo(data.builtAt)}` : ''}.`}
          </p>
        </header>
        {groups.length === 0 && <p className="empty">No weapons match these filters.</p>}
        {groups.map((g) => {
          const open = !closedGroups.has(g.type);
          return (
            <section key={g.type} className="rolls__group">
              <button
                className="rolls__group-head"
                aria-expanded={open}
                onClick={() => setClosedGroups((s) => { const n = new Set(s); if (open) n.add(g.type); else n.delete(g.type); return n; })}
              >
                <Icon name="chevronDown" className={open ? '' : 'is-rotated'} />
                {g.type} <span className="vault__count">{g.items.length}</span>
              </button>
              {open && (
                <div className="rolls__cards">
                  {g.items.map((i) => <RollCard key={i.instanceId ?? i.itemHash} item={i} c={i.instanceId ? grades[i.instanceId] : undefined} onSelect={onSelect} onChanged={onChanged} />)}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}

function RollCard({ item, c, onSelect, onChanged }: {
  item: AppraisedItem; c?: CommunityAppraisal; onSelect: (i: AppraisedItem) => void; onChanged: () => void;
}) {
  const columns = item.perks ?? [];
  const slotted = useMemo(() => columns.map((col) => Math.max(0, col.findIndex((p) => p.active))), [columns]);
  // The roll being previewed: an option index per column. Starts as what's slotted.
  const [picks, setPicks] = useState<number[]>(slotted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => { setPicks(slotted); setError(undefined); }, [slotted]);
  const previewing = picks.some((p, i) => p !== slotted[i]);
  const previewGrade = c?.grade && previewing ? toGrade(scoreRoll(c.perks, c.traitColumns, picks)) : undefined;
  const grade = previewGrade ?? c?.grade;
  const canSwap = !!item.instanceId && columns.some((col) => col.length > 1);

  const pick = (ci: number, k: number) => { setError(undefined); setPicks((p) => p.map((v, i) => (i === ci ? k : v))); };
  const apply = async () => {
    const plugs = picks.flatMap((k, ci) => {
      const p = columns[ci]?.[k];
      return k !== slotted[ci] && p?.hash !== undefined && p.socketIndex !== undefined ? [{ socketIndex: p.socketIndex, plugHash: p.hash }] : [];
    });
    setBusy(true);
    const r = await applyPerks(item.instanceId!, plugs);
    setBusy(false);
    if (r.error) setError(r.error);
    else onChanged();
  };

  const gradeTitle = grade
    ? `Popularity grade ${grade}${previewing ? ' (preview)' : ''}${!previewing && c?.betterPossible ? `, ${c.bestGrade} possible with this copy's other perks` : ''} · from ${c?.copies} copies`
    : `Not enough community data yet (${c?.copies ?? 0} copies seen)`;
  return (
    <article className={`roll-card tier-${item.tier.toLowerCase()}${previewing ? ' is-previewing' : ''}`}>
      <header className={`roll-card__head${item.masterworked ? ' is-masterworked' : ''}`}>
        <ItemTile item={item} onSelect={onSelect} />
        <div className="roll-card__title">
          <h3 className="roll-card__name" title={item.name}>{item.name}</h3>
          <div className="roll-card__badges">
            {c?.rollType && (
              <span className={`use-pill use-pill--${c.rollType}`}><UseIcon use={c.rollType} /> {ROLL_TYPE_LABEL[c.rollType].replace('Community ', '')}</span>
            )}
            {c?.usedFor && <span className="pill pill--neutral" title="Where this exact roll scores best">{ROLE_LABEL[c.usedFor]}</span>}
            {c?.betterPossible && !previewing && (
              <span className="pill pill--better"><Icon name="arrowUp" /> {c.bestGrade} possible</span>
            )}
            {item.appraisal && (item.appraisal.verdict === 'god' || item.appraisal.verdict === 'good') && (
              <span className={`pill pill--wish-${item.appraisal.verdict}`} title={item.appraisal.notes}>
                Wish list{item.appraisal.pve && item.appraisal.pvp ? ' PvE & PvP' : item.appraisal.pve ? ' PvE' : item.appraisal.pvp ? ' PvP' : ''}
              </span>
            )}
          </div>
        </div>
        <span className={`grade grade--${(grade ?? 'none').toLowerCase()}${previewing ? ' is-preview' : ''}`} title={gradeTitle} aria-label={gradeTitle}>
          {grade ?? '–'}
          {c?.betterPossible && !previewing && <Icon name="arrowUp" className="grade__better" />}
        </span>
      </header>
      <div className="roll-card__body">
        <span className="roll-card__location">{item.location}</span>
        <div className="roll-perks">
          {columns.map((col, ci) => (
            <ul className="roll-perks__column" key={ci}>
              {col.map((p, k) => (
                <RollPerk
                  key={`${p.name}-${k}`}
                  perk={p}
                  mark={c?.perks[ci]?.[k]}
                  picked={picks[ci] === k}
                  onPick={canSwap && col.length > 1 ? () => pick(ci, k) : undefined}
                />
              ))}
            </ul>
          ))}
          {item.intrinsic && (
            <ul className="roll-perks__column roll-perks__column--frame">
              <RollPerk perk={item.intrinsic} picked />
            </ul>
          )}
        </div>
      </div>
      {canSwap && (c?.betterPossible || previewing || error) && (
        <footer className="roll-card__actions">
          {c?.betterPossible && !previewing && (
            <button className="button button--primary" onClick={() => setPicks(c.bestPicks)}>
              <Icon name="arrowUp" /> Higher rank
            </button>
          )}
          {previewing && (
            <>
              <button className="button button--primary" onClick={() => void apply()} disabled={busy}>
                {busy ? 'Applying…' : 'Apply in game'}
              </button>
              <button className="button" onClick={() => { setPicks(slotted); setError(undefined); }} disabled={busy}>Revert</button>
            </>
          )}
          {error && <p className="roll-card__error" role="alert">{error}</p>}
        </footer>
      )}
    </article>
  );
}

function RollPerk({ perk, mark, picked, onPick }: { perk: PerkOption; mark?: PerkMark; picked?: boolean; onPick?: () => void }) {
  const lines = [perk.name + (perk.enhanced ? ' (enhanced)' : ''), perk.active ? 'Slotted' : picked ? 'Previewing' : 'Available on this copy'];
  if (mark?.use) lines.push(`Community favors it for ${mark.use === 'both' ? 'PvE and PvP' : mark.use === 'pve' ? 'PvE' : 'PvP'}`);
  if (mark?.pve !== undefined) lines.push(`PvE: on ${pct(mark.pve)} of copies`);
  if (mark?.pvp !== undefined) lines.push(`PvP: on ${pct(mark.pvp)} of copies`);
  if (mark?.better) lines.push('This copy has a more popular option in this column');
  if (perk.active && perk.description) lines.push('', perk.description);
  return (
    <li
      className={`roll-perk${picked ? ' is-active' : ''}${picked && !perk.active ? ' is-preview' : ''}${mark?.use ? ` roll-perk--${mark.use}` : ''}${onPick ? ' is-pickable' : ''}`}
      title={lines.join('\n')}
      {...(onPick ? { role: 'button', tabIndex: 0, 'aria-pressed': picked, onClick: onPick, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); } } } : {})}
    >
      {perk.icon ? <img src={perk.icon} alt="" /> : <span aria-hidden>{perk.name.slice(0, 1)}</span>}
      {mark?.use && <span className={`roll-perk__use roll-perk__use--${mark.use}`}><UseIcon use={mark.use} /></span>}
      {mark?.better && <span className="roll-perk__better"><Icon name="arrowUp" /></span>}
      <span className="visually-hidden">{lines.join('. ')}</span>
    </li>
  );
}

function UseIcon({ use }: { use: 'pve' | 'pvp' | 'both' }) {
  return <Icon name={use} filled />;
}

function FilterGroup({ title, closed, children }: { title: string; closed?: boolean; children: React.ReactNode }) {
  return (
    <details className="rolls__filter" open={!closed}>
      <summary>{title}</summary>
      <div className="rolls__filter-body">{children}</div>
    </details>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: () => void; children: React.ReactNode }) {
  return (
    <label className="rolls__check">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{children}</span>
    </label>
  );
}

function GradeSelect({ label, value, onChange }: { label: string; value: Grade; onChange: (g: Grade) => void }) {
  return (
    <select className="rolls__select" aria-label={`${label} grade`} value={value} onChange={(e) => onChange(e.target.value as Grade)}>
      {GRADE_ORDER.map((g) => <option key={g} value={g}>{g}</option>)}
    </select>
  );
}

/** Sets don't stringify; turn them into sorted arrays to compare filter states. */
const serialize = (f: RollFilters) =>
  Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v instanceof Set ? [...v].sort() : v]));
