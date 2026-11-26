// Watch list: the weapon rolls you're hunting. WatchEditor picks the perks for one weapon;
// WatchListSheet shows every watch with what matches it right now (vendor offers and owned copies).
import { useEffect, useState } from 'react';
import type { AppraisedItem, Grade, PerkOption, RollOptions, WatchEntry, WatchHit } from '@triumvirate/core/browser';
import { checkWatch, fetchRolls, fetchWatch, removeWatch, saveWatch, type WatchResponse } from '../api.ts';
import { timeAgo } from '../inventory.ts';
import { Icon } from './Icon.tsx';
import { ItemTile } from './ItemTile.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { Reveal, SkCards, SkPerks } from './Skeleton.tsx';
import { Segment, Segmented } from '../ui/Segmented.tsx';

/** "Kill Clip Enhanced" and "Kill Clip" are the same choice. */
const base = (name: string) => name.replace(/\s+Enhanced$/i, '').trim();

const GRADE_FLOORS: { value: Grade | undefined; label: string }[] = [
  { value: undefined, label: 'Any grade' },
  { value: 'A', label: 'A or better' },
  { value: 'S', label: 'S only' },
];

/** "Explosive Payload or Frenzy, and Kill Clip": how a watch reads in a sentence. */
export function wantedText(perks: string[][]): string {
  if (!perks.length) return 'Any roll';
  const groups = perks.map((g) => (g.length > 2 ? `${g.slice(0, -1).join(', ')}, or ${g.at(-1)}` : g.join(' or ')));
  return groups.length > 1 ? `${groups.slice(0, -1).join(', ')}${groups.length > 2 ? ',' : ''} and ${groups.at(-1)}` : groups[0]!;
}

/** The Watch button in the item dialog: reads "Watching" when the weapon is already on the list. */
export function WatchButton({ item }: { item: AppraisedItem }) {
  const [entry, setEntry] = useState<WatchEntry | null>();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    fetchWatch().then((r) => live && setEntry(r.entries.find((e) => e.itemHash === item.itemHash) ?? null), () => live && setEntry(null));
    return () => { live = false; };
  }, [item.itemHash]);
  if (item.itemType !== 3) return null;
  return (
    <>
      <button
        className={`button${entry ? ' is-watching' : ''}`}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        title={entry ? `Watching for ${wantedText(entry.perks)}` : 'Get an alert when a roll you want turns up'}
      >
        <Icon name={entry ? 'watching' : 'watch'} filled={!!entry} /> {entry ? 'Watching' : 'Watch'}
      </button>
      {open && (
        <WatchEditor
          weapon={item}
          onClose={() => setOpen(false)}
          onSaved={(r) => setEntry(r.entries.find((e) => e.itemHash === item.itemHash) ?? null)}
        />
      )}
    </>
  );
}

/**
 * Pick the perks you want on one weapon. Each column is "any of these"; columns left empty take
 * whatever rolls. A roll matches when every column you picked from has one of its perks.
 */
export function WatchEditor({ weapon, onClose, onSaved }: {
  weapon: { itemHash: number; name: string; perks?: PerkOption[][] };
  onClose: () => void;
  onSaved?: (r: WatchResponse) => void;
}) {
  const [rolls, setRolls] = useState<RollOptions>();
  const [existing, setExisting] = useState<WatchEntry | null>();
  const [picked, setPicked] = useState<Set<string>[]>([]);
  const [minGrade, setMinGrade] = useState<Grade>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([fetchRolls(weapon.itemHash), fetchWatch()]).then(([r, w]) => {
      if (!live) return;
      const e = w.entries.find((x) => x.itemHash === weapon.itemHash) ?? null;
      setRolls(r);
      setExisting(e);
      setMinGrade(e?.minGrade);
      // Put each saved group back in the column that holds its perks.
      setPicked(r.columns.map((col) => {
        const names = new Set(col.map((p) => base(p.name)));
        return new Set((e?.perks ?? []).flat().filter((n) => names.has(n)));
      }));
    }, (err: Error) => live && setError(err.message));
    return () => { live = false; };
  }, [weapon.itemHash]);

  const toggle = (c: number, name: string) => setPicked((p) => p.map((s, i) => {
    if (i !== c) return s;
    const next = new Set(s);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  }));
  // The perks on the copy you opened, as a starting point.
  const owned = new Set((weapon.perks ?? []).flat().filter((p) => p.active).map((p) => base(p.name)));
  const fromCopy = () => rolls && setPicked(rolls.columns.map((col) => new Set(col.map((p) => base(p.name)).filter((n) => owned.has(n)))));
  const groups = picked.map((s) => [...s]).filter((g) => g.length > 0);

  const save = async () => {
    setBusy(true);
    setError('');
    const r = await saveWatch({ itemHash: weapon.itemHash, perks: groups, ...(minGrade ? { minGrade } : {}) });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    onSaved?.(r);
    onClose();
  };
  const remove = async () => {
    if (!existing) return;
    setBusy(true);
    try { onSaved?.(await removeWatch(existing.id)); onClose(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  return (
    <Sheet
      title={`Watch for ${weapon.name}`}
      onClose={onClose}
      full
      footer={(
        <div className="sheet__actions">
          {error && <p className="error editor__error">{error}</p>}
          {existing && <button className="button button--quiet watch-editor__remove" disabled={busy} onClick={() => void remove()}><Icon name="delete" /> Stop watching</button>}
          <button className="button button--primary" disabled={busy || !rolls} onClick={() => void save()}>
            <Icon name="watching" /> {existing ? 'Save changes' : 'Start watching'}
          </button>
        </div>
      )}
    >
      <Reveal loading={!rolls && !error} skeleton={<SkPerks />} label="Loading every roll">
      {rolls && (
        <div className="watch-editor">
          <p className="watch-editor__summary" aria-live="polite">
            <strong>Alert me for:</strong> {wantedText(groups)}{minGrade ? `, ${minGrade === 'S' ? 'S grade only' : 'A grade or better'}` : ''}.
          </p>
          <p className="muted watch-editor__hint">Pick one or more perks per column; any of them counts. Leave a column empty to take whatever it rolls.</p>
          {owned.size > 0 && (
            <button className="button button--quiet watch-editor__copy" onClick={fromCopy}><Icon name="copies" /> Start from this copy's perks</button>
          )}
          <div className="watch-editor__columns">
            {rolls.columns.map((col, c) => (
              <fieldset className="watch-column" key={c}>
                <legend className="watch-column__label">
                  Column {c + 1}
                  {picked[c]?.size ? <button className="watch-column__clear" onClick={() => setPicked((p) => p.map((s, i) => (i === c ? new Set() : s)))}>Clear</button> : <span className="muted"> · any</span>}
                </legend>
                <ul className="watch-column__list">
                  {col.map((p) => {
                    const name = base(p.name);
                    const on = picked[c]?.has(name) ?? false;
                    return (
                      <li key={name}>
                        <button className={`watch-perk${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => toggle(c, name)} title={p.description}>
                          <span className="watch-perk__icon">{p.icon ? <img src={p.icon} alt="" onError={(e) => e.currentTarget.classList.add('is-broken')} /> : name.slice(0, 1)}</span>
                          <span className="watch-perk__name">{name}</span>
                          {on && <Icon name="check" className="watch-perk__check" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            ))}
          </div>
          <div className="watch-editor__grade">
            <span className="field__label" id="watch-grade">Community grade</span>
            <Segmented labelledBy="watch-grade" value={minGrade ?? 'any'} onChange={(v) => setMinGrade(v === 'any' ? undefined : v as Grade)}>
              {GRADE_FLOORS.map((g) => <Segment key={g.label} id={g.value ?? 'any'}>{g.label}</Segment>)}
            </Segmented>
          </div>
        </div>
      )}
      </Reveal>
    </Sheet>
  );
}

/** Every watch, with what matches it now. Owned copies open their detail. */
export function WatchListSheet({ items, onSelect, onClose }: {
  items: AppraisedItem[];
  onSelect: (item: AppraisedItem) => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<WatchResponse>();
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [checking, setChecking] = useState(false);
  const [editing, setEditing] = useState<WatchEntry>();
  useEffect(() => { fetchWatch().then(setData, (e: Error) => setError(e.message)); }, []);

  const check = async () => {
    setChecking(true);
    setError('');
    setNote('');
    const r = await checkWatch();
    setChecking(false);
    if (r.error) { setError(r.error); return; }
    setData(r);
    setNote(r.fresh ? `${r.fresh} new match${r.fresh === 1 ? '' : 'es'}.` : 'Nothing new since the last check.');
  };
  const byId = new Map(items.filter((i) => i.instanceId).map((i) => [i.instanceId!, i]));
  const hitsFor = (id: string) => (data?.hits ?? []).filter((h) => h.entryId === id);
  const status = data && [
    data.checkedAt ? `Checked ${timeAgo(data.checkedAt)}` : 'Not checked yet',
    data.everyMinutes ? `checks every ${data.everyMinutes === 60 ? 'hour' : `${data.everyMinutes} minutes`}` : 'automatic checks are off',
  ].join(' · ');

  return (
    <Sheet
      title="Watch list"
      onClose={onClose}
      full
      footer={(
        <div className="sheet__actions">
          {error && <p className="error editor__error">{error}</p>}
          {note && <p className="muted watch-list__note" role="status">{note}</p>}
          <button className="button button--primary" disabled={checking || !data?.entries.length} onClick={() => void check()}>
            <Icon name="refresh" /> {checking ? 'Checking…' : 'Check now'}
          </button>
        </div>
      )}
    >
      <Reveal loading={!data && !error} skeleton={<SkCards />} label="Loading your watch list">
      {data && (
        <div className="watch-list">
          <p className="muted watch-list__status">
            {status}.{data.alerts ? ' New matches alert the devices that have the Morning alert switch on.' : ' Phone alerts are off on the server.'}
          </p>
          {data.entries.length === 0 && (
            <div className="digest__empty">
              <p>Nothing on your watch list yet.</p>
              <p className="muted">Open a weapon and tap <strong>Watch</strong> to pick the roll you want. You'll get an alert when a vendor sells it or one drops for you.</p>
            </div>
          )}
          <ul className="watch-list__entries">
            {data.entries.map((e) => {
              const hits = hitsFor(e.id);
              return (
                <li key={e.id} className="watch-entry">
                  <div className="watch-entry__head">
                    <span className="tile tile--md digest__art tier-legendary" aria-hidden>{e.icon && <img src={e.icon} alt="" />}</span>
                    <div className="watch-entry__text">
                      <strong className="watch-entry__name">{e.name}</strong>
                      <span className="muted">{wantedText(e.perks)}{e.minGrade ? ` · ${e.minGrade === 'S' ? 'S only' : 'A or better'}` : ''}</span>
                    </div>
                    <button className="icon-button" onClick={() => setEditing(e)} aria-label={`Edit the watch for ${e.name}`} title="Edit"><Icon name="edit" /></button>
                  </div>
                  {hits.length === 0
                    ? <p className="muted watch-entry__none">No match yet.</p>
                    : <ul className="watch-entry__hits">{hits.map((h) => <HitRow key={h.key} hit={h} owned={h.instanceId ? byId.get(h.instanceId) : undefined} onSelect={onSelect} />)}</ul>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      </Reveal>
      {editing && (
        <WatchEditor
          weapon={{ itemHash: editing.itemHash, name: editing.name }}
          onClose={() => setEditing(undefined)}
          onSaved={(r) => setData((d) => ({ ...r, checkedAt: r.checkedAt ?? d?.checkedAt ?? null }))}
        />
      )}
    </Sheet>
  );
}

function HitRow({ hit, owned, onSelect }: { hit: WatchHit; owned?: AppraisedItem; onSelect: (i: AppraisedItem) => void }) {
  return (
    <li className="watch-hit">
      <Icon name={hit.source === 'vendor' ? 'vendor' : 'drop'} className="watch-hit__icon" />
      <div className="watch-hit__text">
        <span>{hit.source === 'vendor' ? `For sale at ${hit.where}` : owned ? `You own one · ${owned.location}` : `Dropped · ${hit.where}`}</span>
        <span className="muted">{hit.matched.length ? hit.matched.join(', ') : 'Any roll'} · found {timeAgo(hit.foundAt)}</span>
      </div>
      {hit.grade && <span className={`grade grade--sm grade--${hit.grade.toLowerCase()}`} title={`Popularity grade ${hit.grade}`}>{hit.grade}</span>}
      {owned && <button className="button button--quiet" onClick={() => onSelect(owned)}>Open</button>}
    </li>
  );
}
