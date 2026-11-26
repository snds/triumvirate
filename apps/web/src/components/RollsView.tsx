// Roll appraiser: every legendary and exotic weapon you own, grouped by type, graded against what
// the community actually runs (our own crawl of public matches). Modeled on a popularity appraiser:
// a letter grade per copy, PvE / PvP marks on perks, and an arrow where a better option exists.
import { useEffect, useMemo, useState } from 'react';
import type { AppraisedItem, CommunityAppraisal, Grade, PerkMark, PerkOption, Role, Verdict } from '@triumvirate/core';
import { scoreRoll, toGrade } from '@triumvirate/core/browser';
import { applyPerks, fetchCommunityAppraisals, fetchVendorOffers, type CommunityAppraisals, type VendorOffers } from '../api.ts';
import {
  decodeFilters, defaultFilters, encodeFilters, followCharacter, GRADE_ORDER, GROUP_LABEL, groupItems, isAppraisable, locationKey,
  meetsGrade, passes, pct, ROLE_LABEL, ROLL_TYPE_LABEL, SORT_LABEL, updateStream,
  type GroupBy, type RollFilters, type RollType, type SavedFilters, type SortBy, type StreamState,
} from '../rolls-view.ts';
import { usePref } from '../prefs.ts';
import { ItemTile } from './ItemTile.tsx';
import { Icon } from './Icon.tsx';
import { timeAgo } from '../inventory.ts';
import { useCompact } from '../media.ts';
import { FarmingSheet } from './FarmingSheet.tsx';
import { Sk } from './Skeleton.tsx';
import { Tab as TabButton, TabList, TabPanel, Tabs } from '../ui/Tabs.tsx';
import { Select } from '../ui/Select.tsx';

const VERDICTS: { value: Verdict; label: string }[] = [
  { value: 'god', label: 'Wish list god roll' },
  { value: 'good', label: 'Wish list match' },
  { value: 'meh', label: 'No wish list match' },
  { value: 'trash', label: 'Wish list trash' },
  { value: 'unrated', label: 'Not on the wish list' },
];
const ROLES = Object.keys(ROLE_LABEL) as Role[];
const ROLL_TYPES = Object.keys(ROLL_TYPE_LABEL) as RollType[];
const GROUPS = Object.keys(GROUP_LABEL) as GroupBy[];
const SORTS = Object.keys(SORT_LABEL) as SortBy[];

type Panel = 'filters' | 'group' | 'activity' | 'settings';
const PANELS: { id: Panel; label: string; icon: 'filter' | 'sort' | 'activity' | 'settings' }[] = [
  { id: 'filters', label: 'Filters', icon: 'filter' },
  { id: 'group', label: 'Group & sort', icon: 'sort' },
  { id: 'activity', label: 'Activity', icon: 'activity' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

export interface RollSettings {
  groupBy: GroupBy;
  sortBy: SortBy;
  /** Swap the location filter to whichever character you're playing. */
  followCharacter: boolean;
  /** The activity stream's bar: new drops and vendor rolls at or above this grade. */
  streamMin: Grade;
  soundDrops: boolean;
  soundVendors: boolean;
}
export const DEFAULT_ROLL_SETTINGS: RollSettings = { groupBy: 'type', sortBy: 'grade', followCharacter: true, streamMin: 'A', soundDrops: false, soundVendors: false };

export function RollsView({ items, syncedAt, activeClass, onSelect, onChanged, onWatchList }: {
  items: AppraisedItem[];
  /** Opens the watch list. */
  onWatchList: () => void;
  /** Called after perks change in game, so the app reloads the inventory. */
  onChanged: () => void;
  /** Refetch grades whenever the inventory changes. */
  syncedAt: string;
  /** Class of the character played most recently ("Titan"), for following character swaps. */
  activeClass?: string;
  onSelect: (i: AppraisedItem) => void;
}) {
  const [data, setData] = useState<CommunityAppraisals>();
  const [error, setError] = useState<string>();
  // Filters and view settings are saved per device, so they're still set next visit.
  const [saved, setSaved] = usePref<SavedFilters>('rollFilters', encodeFilters(defaultFilters()));
  const filters = useMemo(() => decodeFilters(saved), [saved]);
  const setFilters = (next: RollFilters | ((f: RollFilters) => RollFilters)) =>
    setSaved((s) => encodeFilters(typeof next === 'function' ? next(decodeFilters(s)) : next));
  const [storedSettings, setSettings] = usePref<RollSettings>('rollSettings', DEFAULT_ROLL_SETTINGS);
  const settings = { ...DEFAULT_ROLL_SETTINGS, ...storedSettings };
  const set = <K extends keyof RollSettings>(k: K, v: RollSettings[K]) => setSettings((s) => ({ ...DEFAULT_ROLL_SETTINGS, ...s, [k]: v }));
  const [railOpen, setRailOpen] = usePref('rollRailOpen', true);
  const [panel, setPanel] = usePref<Panel>('rollPanel', 'filters');
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());
  // On a phone the rail becomes a bottom sheet, opened from a toolbar above the cards.
  const compact = useCompact();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [farming, setFarming] = useState(false);
  const open = compact ? sheetOpen : railOpen;
  const openSheet = (p: Panel) => { setPanel(p); setSheetOpen(true); };
  useEffect(() => {
    if (!compact || !sheetOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSheetOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [compact, sheetOpen]);

  useEffect(() => {
    let live = true;
    fetchCommunityAppraisals().then((d) => { if (live) { setData(d); setError(undefined); } }, (e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [syncedAt, items]); // items too: a perk swap reorders a copy's options without a new sync

  // Character follow. The last class we saw is saved too, so a swap made while the app was
  // closed is caught on the next load, not only one made while it's open.
  const [lastClass, setLastClass] = usePref<string | null>('rollLastClass', null);
  useEffect(() => {
    if (!activeClass || activeClass === lastClass) return;
    if (settings.followCharacter && lastClass) setFilters((f) => followCharacter(f, lastClass, activeClass));
    setLastClass(activeClass);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClass, lastClass, settings.followCharacter]);

  const weapons = useMemo(() => items.filter(isAppraisable), [items]);
  const grades = data?.items ?? {};
  const shown = weapons.filter((i) => passes(i, i.instanceId ? grades[i.instanceId] : undefined, filters));
  const groups = groupItems(shown, grades, settings.groupBy, settings.sortBy);
  const locations = [...new Set(weapons.map(locationKey))].sort((a, b) => (a === 'Vault' ? 1 : 0) - (b === 'Vault' ? 1 : 0) || a.localeCompare(b));
  const types = [...new Set(weapons.map((i) => i.type))].sort();
  const changed = JSON.stringify(encodeFilters(filters)) !== JSON.stringify(encodeFilters(defaultFilters()));

  // Activity stream: new drops, remembered between visits. Runs once grades for this sync are in.
  const [stream, setStream] = usePref<StreamState | null>('rollStream', null);
  useEffect(() => {
    if (!data) return;
    const { state, added } = updateStream(stream ?? undefined, weapons);
    setStream(state);
    if (settings.soundDrops && added.some((d) => meetsGrade(grades[d.instanceId]?.grade, settings.streamMin))) chime();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  const byId = new Map(weapons.map((i) => [i.instanceId, i]));
  const drops = (stream?.drops ?? []).filter((d) => meetsGrade(grades[d.instanceId]?.grade, settings.streamMin));

  // Vendor offers, judged by the same filters (any location) and the stream's grade bar.
  const [vendors, setVendors] = useState<VendorOffers>();
  const [vendorError, setVendorError] = useState<string>();
  const [vendorBusy, setVendorBusy] = useState(false);
  const loadVendors = (refresh = false) => {
    setVendorBusy(true);
    fetchVendorOffers(refresh).then((v) => { setVendors(v); setVendorError(undefined); }, (e: Error) => setVendorError(e.message)).finally(() => setVendorBusy(false));
  };
  useEffect(() => { loadVendors(); }, [syncedAt]);
  const vendorFilters = { ...filters, locations: new Set<string>() };
  const vendorMatches = (vendors?.items ?? []).filter((i) => {
    const c = i.instanceId ? vendors!.grades[i.instanceId] : undefined;
    return meetsGrade(c?.grade, settings.streamMin) && passes(i, c, vendorFilters);
  });
  const [heard, setHeard] = usePref<string[]>('rollVendorHeard', []);
  useEffect(() => {
    if (!vendors) return;
    const keys = vendorMatches.map((i) => `${i.itemHash}:${i.instanceId}`);
    if (settings.soundVendors && keys.some((k) => !heard.includes(k))) chime();
    setHeard(keys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendors]);
  const activityCount = drops.length + vendorMatches.length;

  const toggle = <K extends keyof RollFilters>(key: K, value: RollFilters[K] extends Set<infer V> ? V : never) =>
    setFilters((f) => {
      const next = new Set(f[key] as Set<unknown>);
      if (next.has(value)) next.delete(value); else next.add(value);
      return { ...f, [key]: next };
    });

  return (
    <section className={`rolls${open || compact ? '' : ' rolls--rail-closed'}${compact ? ' rolls--compact' : ''}`}>
      {compact && sheetOpen && <div className="sheet-scrim" onClick={() => setSheetOpen(false)} aria-hidden />}
      {(!compact || sheetOpen) && (
      <aside
        className={`rolls__rail${compact ? ' rolls__rail--sheet' : ''}`}
        aria-label="Roll appraiser options"
        {...(compact ? { role: 'dialog', 'aria-modal': true } : {})}
      >
        {compact && <span className="sheet__handle" aria-hidden />}
        <Tabs value={panel} onChange={setPanel}>
        <header className="rolls__rail-head">
          {!compact && (
            <button className="button button--quiet" onClick={() => setRailOpen((v) => !v)} aria-expanded={railOpen} title={railOpen ? 'Hide options' : 'Show options'}>
              <Icon name={railOpen ? 'chevronsLeft' : 'chevronsRight'} />
              {!railOpen && changed && <span className="rolls__dot" aria-label="Filters on" />}
            </button>
          )}
          {open && (
            <TabList label="Options" className="rolls__panels">
              {PANELS.map((p) => (
                <TabButton key={p.id} id={p.id} className="rolls__panel-tab" label={p.label} title={p.label}>
                  <Icon name={p.icon} />
                  {p.id === 'filters' && changed && <span className="rolls__dot" aria-hidden />}
                  {p.id === 'activity' && activityCount > 0 && <span className="rolls__count">{activityCount}</span>}
                </TabButton>
              ))}
            </TabList>
          )}
          {compact && <button className="button button--quiet rolls__done" onClick={() => setSheetOpen(false)}>Done</button>}
        </header>
        {open && (
          <TabPanel id={panel} className="rolls__rail-body">
            <div className="rolls__panel-head">
              <h3>{PANELS.find((p) => p.id === panel)!.label}</h3>
              {panel === 'filters' && changed && <button className="button button--quiet" onClick={() => setFilters(defaultFilters())}>Reset</button>}
            </div>
            {panel === 'filters' && (
              <>
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
                  {locations.map((l) => (
                    <Check key={l} checked={filters.locations.has(l)} onChange={() => toggle('locations', l)}>
                      {l}{l === activeClass && <span className="muted"> · playing</span>}
                    </Check>
                  ))}
                </FilterGroup>
                <FilterGroup title="Weapon type" closed>
                  {types.map((t) => <Check key={t} checked={filters.types.has(t)} onChange={() => toggle('types', t)}>{t}</Check>)}
                </FilterGroup>
              </>
            )}
            {panel === 'group' && (
              <>
                <FilterGroup title="Group by">
                  {GROUPS.map((g) => <Radio key={g} name="roll-group" checked={settings.groupBy === g} onChange={() => set('groupBy', g)}>{GROUP_LABEL[g]}</Radio>)}
                </FilterGroup>
                <FilterGroup title="Sort by">
                  {SORTS.map((s) => <Radio key={s} name="roll-sort" checked={settings.sortBy === s} onChange={() => set('sortBy', s)}>{SORT_LABEL[s]}</Radio>)}
                </FilterGroup>
              </>
            )}
            {panel === 'activity' && (
              <div className="activity">
                <div className="activity__bar">
                  <span className="muted">Minimum grade</span>
                  <GradeSelect label="Minimum" value={settings.streamMin} onChange={(g) => set('streamMin', g)} />
                </div>
                <section className="activity__section">
                  <h4><Icon name="drop" /> New drops <span className="vault__count">{drops.length}</span></h4>
                  {!stream || stream.drops.length === 0
                    ? <p className="muted activity__empty">New weapons show up here as they drop. Everything you own now is already counted.</p>
                    : drops.length === 0
                      ? <p className="muted activity__empty">{stream.drops.length} new {stream.drops.length === 1 ? 'weapon' : 'weapons'}, none at {settings.streamMin} or better.</p>
                      : <ul className="activity__list">
                          {drops.map((d) => {
                            const item = byId.get(d.instanceId);
                            return item ? <ActivityRow key={d.instanceId} item={item} c={grades[d.instanceId]} meta={`${locationKey(item)} · ${timeAgo(d.at)}`} onSelect={onSelect} /> : null;
                          })}
                        </ul>}
                </section>
                <section className="activity__section">
                  <h4>
                    <Icon name="vendor" /> Vendors <span className="vault__count">{vendorMatches.length}</span>
                    <button className="button button--quiet activity__refresh" onClick={() => loadVendors(true)} disabled={vendorBusy} title="Check vendors again">
                      <Icon name="refresh" className={vendorBusy ? 'is-spinning' : ''} />
                    </button>
                  </h4>
                  {vendorError ? <p className="muted activity__empty">Vendors aren't available: {vendorError}</p>
                    : !vendors ? <p className="muted activity__empty">Checking vendors…</p>
                    : vendorMatches.length === 0
                      ? <p className="muted activity__empty">No vendor weapon at {settings.streamMin} or better matches your filters right now ({vendors.items.length} checked).</p>
                      : <ul className="activity__list">
                          {vendorMatches.map((i) => (
                            <ActivityRow key={i.instanceId} item={i} c={vendors.grades[i.instanceId!]} meta={i.vendorName} onSelect={onSelect} />
                          ))}
                        </ul>}
                  {vendors && <p className="muted activity__note">Uses your filters, except location. Checked {timeAgo(vendors.fetchedAt)}.</p>}
                </section>
              </div>
            )}
            {panel === 'settings' && (
              <>
                <FilterGroup title="Characters">
                  <Check checked={settings.followCharacter} onChange={() => set('followCharacter', !settings.followCharacter)}>
                    Follow the character I'm playing
                  </Check>
                  <p className="muted rolls__hint">When you switch characters, a location filter set to your old class moves to the new one. The vault stays as you set it.</p>
                </FilterGroup>
                <FilterGroup title="Sounds">
                  <Check checked={settings.soundDrops} onChange={() => { set('soundDrops', !settings.soundDrops); if (!settings.soundDrops) chime(); }}>
                    Play a sound when a new drop is {settings.streamMin} or better
                  </Check>
                  <Check checked={settings.soundVendors} onChange={() => { set('soundVendors', !settings.soundVendors); if (!settings.soundVendors) chime(); }}>
                    Play a sound when a vendor sells one
                  </Check>
                  <p className="muted rolls__hint">The grade bar is set in Activity.</p>
                </FilterGroup>
              </>
            )}
          </TabPanel>
        )}
        </Tabs>
      </aside>
      )}

      <div className="rolls__main">
        <header className="rolls__head">
          <div className="rolls__title-row">
            <h2 className="vault__title">Roll appraiser <span className="vault__count">{shown.length} of {weapons.length}</span></h2>
            <button className="button rolls__targets" onClick={() => setFarming(true)} aria-haspopup="dialog">
              <Icon name="target" /> Farming targets
            </button>
            <button className="button rolls__watch" onClick={onWatchList} aria-haspopup="dialog">
              <Icon name="watching" /> Watch list
            </button>
          </div>
          {farming && <FarmingSheet onClose={() => setFarming(false)} />}
          {compact && (
            <div className="rolls__toolbar" role="toolbar" aria-label="Roll appraiser options">
              {PANELS.map((p) => (
                <button
                  key={p.id}
                  className={`chip rolls__tool${p.id === 'settings' ? ' rolls__tool--icon' : ''}`}
                  onClick={() => openSheet(p.id)}
                  aria-haspopup="dialog"
                  aria-label={p.id === 'settings' ? p.label : undefined}
                >
                  <Icon name={p.icon} />
                  {p.id !== 'settings' && p.label}
                  {p.id === 'filters' && changed && <span className="rolls__dot" aria-label="(on)" />}
                  {p.id === 'activity' && activityCount > 0 && <span className="count-badge">{activityCount}</span>}
                </button>
              ))}
            </div>
          )}
          <p className="muted">
            {error ? `Community data isn't available: ${error}`
              : !data ? <><span className="visually-hidden">Loading community data</span><Sk kind="line" style={{ display: 'inline-block', width: 'min(28em, 80%)' }} /></>
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

/** One line in the activity stream: tile, name, grade, and where it is. */
function ActivityRow({ item, c, meta, onSelect }: { item: AppraisedItem; c?: CommunityAppraisal; meta: string; onSelect: (i: AppraisedItem) => void }) {
  const grade = c?.grade;
  return (
    <li className={`activity__row tier-${item.tier.toLowerCase()}`}>
      <ItemTile item={item} onSelect={onSelect} />
      <div className="activity__text">
        <span className="activity__name" title={item.name}>{item.name}</span>
        <span className="activity__meta">
          {c?.rollType && <UseIcon use={c.rollType} />} {meta}
        </span>
      </div>
      <span className={`grade grade--sm grade--${(grade ?? 'none').toLowerCase()}`} title={grade ? `Popularity grade ${grade}` : undefined}>{grade ?? '–'}</span>
    </li>
  );
}

/** A short two-note chime, made on the spot (no audio file). Browsers may block it until the page is clicked once. */
const audio = { ctx: undefined as AudioContext | undefined };
export function chime() {
  try {
    const ctx = (audio.ctx ??= new AudioContext());
    [880, 1320].forEach((f, k) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t = ctx.currentTime + k * 0.12;
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.32);
    });
  } catch { /* no audio; fine */ }
}

function RollCard({ item, c, onSelect, onChanged }: {
  item: AppraisedItem; c?: CommunityAppraisal; onSelect: (i: AppraisedItem) => void; onChanged: () => void;
}) {
  const columns = item.perks ?? [];
  // Keyed on the slotted perk hashes, not the array: a quiet auto refresh hands over new objects for the
  // same roll, and that must not throw away a preview the player is about to apply.
  const slottedKey = columns.map((col) => col.find((p) => p.active)?.hash ?? '').join(',');
  const slotted = useMemo(() => columns.map((col) => Math.max(0, col.findIndex((p) => p.active))), [slottedKey]);
  // The roll being previewed: an option index per column. Starts as what's slotted.
  const [picks, setPicks] = useState<number[]>(slotted);
  const [busy, setBusy] = useState(false);
  // The result of the last Apply, shown until the next pick: success or Bungie's reason.
  const [notice, setNotice] = useState<{ ok: boolean; text: string }>();
  useEffect(() => { setPicks(slotted); }, [slotted]);
  useEffect(() => {
    if (!notice?.ok) return;
    const id = setTimeout(() => setNotice(undefined), 6000);
    return () => clearTimeout(id);
  }, [notice]);
  const previewing = picks.some((p, i) => p !== slotted[i]);
  const previewGrade = c?.grade && previewing ? toGrade(scoreRoll(c.perks, c.traitColumns, picks)) : undefined;
  const grade = previewGrade ?? c?.grade;
  const canSwap = !!item.instanceId && columns.some((col) => col.length > 1);

  const pick = (ci: number, k: number) => { setNotice(undefined); setPicks((p) => p.map((v, i) => (i === ci ? k : v))); };
  const apply = async () => {
    const chosen = picks.flatMap((k, ci) => {
      const p = columns[ci]?.[k];
      return k !== slotted[ci] && p?.hash !== undefined && p.socketIndex !== undefined ? [{ socketIndex: p.socketIndex, plugHash: p.hash, name: p.name }] : [];
    });
    setBusy(true);
    setNotice(undefined);
    const r = await applyPerks(item.instanceId!, chosen.map(({ socketIndex, plugHash }) => ({ socketIndex, plugHash })));
    setBusy(false);
    if (r.error) setNotice({ ok: false, text: r.error });
    else setNotice({ ok: true, text: `Swapped in game: ${chosen.map((p) => p.name).join(', ')}.` });
    // Reload even after a partial failure, so the card shows whichever perks did change.
    if (!r.error || r.applied) onChanged();
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
      {canSwap && (c?.betterPossible || previewing || notice) && (
        <footer className="roll-card__actions">
          {c?.betterPossible && !previewing && (
            <button className="button button--primary" onClick={() => { setNotice(undefined); setPicks(c.bestPicks); }}>
              <Icon name="arrowUp" /> Higher rank
            </button>
          )}
          {previewing && (
            <>
              <button className="button button--primary" onClick={() => void apply()} disabled={busy}>
                {busy ? 'Applying…' : 'Apply in game'}
              </button>
              <button className="button" onClick={() => { setPicks(slotted); setNotice(undefined); }} disabled={busy}>Revert</button>
              {!busy && !notice && <p className="roll-card__hint">Previewing{previewGrade ? ` the ${previewGrade} roll` : ''}. Apply in game to swap the perks.</p>}
            </>
          )}
          {notice && (
            <p className={notice.ok ? 'roll-card__success' : 'roll-card__error'} role={notice.ok ? 'status' : 'alert'}>
              <Icon name={notice.ok ? 'check' : 'warning'} /> {notice.text}
            </p>
          )}
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

function Radio({ name, checked, onChange, children }: { name: string; checked: boolean; onChange: () => void; children: React.ReactNode }) {
  return (
    <label className="rolls__check">
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      <span>{children}</span>
    </label>
  );
}

function GradeSelect({ label, value, onChange }: { label: string; value: Grade; onChange: (g: Grade) => void }) {
  return (
    <Select ariaLabel={`${label} grade`} triggerClassName="select__trigger rolls__select" value={value} onChange={onChange} options={GRADE_ORDER.map((g) => ({ value: g, label: g }))} />
  );
}
