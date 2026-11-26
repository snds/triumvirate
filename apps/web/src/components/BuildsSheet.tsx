// Popular builds editor. Cleanup keeps armor that's best in slot for any build switched on here,
// and tags it with the build's activities. The list starts with well-known builds; edit it to
// match how you play. One class at a time keeps the list short on a phone.
import { useEffect, useMemo, useState } from 'react';
import { ACTIVITY_LABEL, ARMOR_STATS, BUILD_ACTIVITIES, type AppraisedItem, type ArmorSet, type ArmorStat, type BuildActivity, type PopularBuild } from '@triumvirate/core/browser';
import { fetchBuilds, saveBuilds } from '../api.ts';
import { Icon, type IconName } from './Icon.tsx';
import { Sheet } from './Sheet.tsx';
import { Reveal, SkCards } from './Skeleton.tsx';

const CLASSES = ['Titan', 'Hunter', 'Warlock'] as const;
export const ACTIVITY_ICON: Record<BuildActivity, IconName> = { endgame: 'endgame', pvp: 'pvp', casual: 'casual' };
export const ACTIVITY_HINT: Record<BuildActivity, string> = {
  endgame: 'Grandmasters, raids, and dungeons',
  pvp: 'Crucible and Trials',
  casual: 'Patrols and Lost Sector farming',
};
const RANKS = ['Most important', 'Second', 'Third'];

export function BuildsSheet({ items, itemSets, classType: startClass = 0, onClose, onSaved }: {
  /** Your inventory, for the exotic suggestions. */
  items: AppraisedItem[];
  itemSets?: Record<string, ArmorSet>;
  classType?: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [builds, setBuilds] = useState<PopularBuild[]>();
  const [classType, setClassType] = useState(startClass);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchBuilds().then((r) => setBuilds(r.builds), (e: Error) => setError(e.message));
  }, []);

  // Exotic armor you own for this class, for the exotic field's suggestions.
  const exotics = useMemo(() => [...new Set(items
    .filter((i) => i.itemType === 2 && i.tier === 'Exotic' && i.classType === classType)
    .map((i) => i.name))].sort(), [items, classType]);
  const sets = useMemo(() => Object.values(itemSets ?? {}).map((s) => s.name).sort(), [itemSets]);

  const edit = (id: string, patch: Partial<PopularBuild>) => {
    setBuilds((list) => list?.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    setDirty(true);
  };
  const remove = (id: string) => { setBuilds((list) => list?.filter((b) => b.id !== id)); setDirty(true); };
  const add = () => {
    const id = `custom-${Date.now().toString(36)}`;
    setBuilds((list) => [...(list ?? []), { id, name: 'New build', classType, activities: ['endgame'], stats: ['Health', 'Class', 'Grenade'] }]);
    setDirty(true);
  };

  const save = async (body: Parameters<typeof saveBuilds>[0]) => {
    setBusy(true);
    const r = await saveBuilds(body);
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    setBuilds(r.builds);
    setDirty(false);
    onSaved();
    onClose();
  };

  const shown = builds?.filter((b) => b.classType === classType) ?? [];

  return (
    <Sheet
      title="Popular builds"
      full
      onClose={onClose}
      className="builds"
      footer={(
        <div className="builds__footer">
          <button className="button button--quiet" disabled={busy} onClick={() => void save({ reset: true })}>Reset to starting list</button>
          <span className="builds__spacer" />
          <button className="button" onClick={onClose}>Cancel</button>
          <button className="button button--primary" disabled={!dirty || busy || !builds} onClick={() => builds && void save({ builds })}>
            <Icon name="check" /> Save
          </button>
        </div>
      )}
    >
      <p className="builds__intro muted">
        Armor that's best in slot for a build here stays out of cleanup, tagged with where the build is played.
        This starts as a hand-picked list of well-known builds, so change it to match how you play.
      </p>
      {/* A plain wrapper: the grid would squash the overflow-hidden control to nothing. */}
      <div className="builds__classes-wrap">
        <div className="segmented builds__classes" role="group" aria-label="Class">
          {CLASSES.map((name, i) => (
            <button key={name} className={`segmented__option${i === classType ? ' is-selected' : ''}`} aria-pressed={i === classType} onClick={() => setClassType(i)}>
              {name} <span className="muted">{builds?.filter((b) => b.classType === i && !b.off).length ?? ''}</span>
            </button>
          ))}
        </div>
      </div>
      {error && <p className="builds__error" role="alert">{error}</p>}

      <datalist id="build-exotics">{exotics.map((n) => <option key={n} value={n} />)}</datalist>
      <Reveal loading={!builds && !error} skeleton={<SkCards count={4} />} label="Loading builds">
      <ul className="builds__list">
        {shown.map((b) => (
          <li key={b.id} className={`build-row${b.off ? ' is-off' : ''}`}>
            <div className="build-row__head">
              <input
                className="search field__input build-row__name"
                aria-label="Build name"
                value={b.name}
                maxLength={80}
                onChange={(e) => edit(b.id, { name: e.target.value })}
              />
              <button
                role="switch"
                aria-checked={!b.off}
                aria-label={`Use ${b.name} in cleanup`}
                title={b.off ? 'Off: protects nothing' : 'On: protects its best pieces'}
                className="switch"
                onClick={() => edit(b.id, { off: !b.off })}
              ><span className="switch__track"><span className="switch__thumb" /></span></button>
              <button className="button button--quiet build-row__delete" aria-label={`Delete ${b.name}`} title="Delete" onClick={() => remove(b.id)}>
                <Icon name="delete" />
              </button>
            </div>

            <div className="build-row__activities" role="group" aria-label="Played in">
              {BUILD_ACTIVITIES.map((a) => {
                const on = b.activities.includes(a);
                return (
                  <button
                    key={a}
                    className={`chip activity-chip activity-chip--${a}${on ? ' is-selected' : ''}`}
                    aria-pressed={on}
                    title={ACTIVITY_HINT[a]}
                    // A build needs at least one activity.
                    onClick={() => (on ? b.activities.length > 1 : true) && edit(b.id, { activities: on ? b.activities.filter((x) => x !== a) : BUILD_ACTIVITIES.filter((x) => x === a || b.activities.includes(x)) })}
                  >
                    <Icon name={ACTIVITY_ICON[a]} /> {ACTIVITY_LABEL[a]}
                  </button>
                );
              })}
            </div>

            <div className="build-row__fields">
              <label className="field">
                <span className="field__label">Exotic armor</span>
                <input
                  className="search field__input"
                  list="build-exotics"
                  placeholder="None"
                  value={b.exotic ?? ''}
                  onChange={(e) => edit(b.id, { exotic: e.target.value || undefined })}
                />
                {b.exotic && !exotics.some((n) => n.toLowerCase() === b.exotic!.toLowerCase()) && (
                  <span className="build-row__hint muted">You don't own this one, so every slot uses legendaries.</span>
                )}
              </label>
              <label className="field">
                <span className="field__label">Armor set</span>
                <select className="optimizer__select" value={b.set ?? ''} onChange={(e) => edit(b.id, { set: e.target.value || undefined })}>
                  <option value="">Any</option>
                  {[...new Set([...(b.set ? [b.set] : []), ...sets])].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>

            <div className="build-row__stats" role="group" aria-label="Stats it wants">
              {RANKS.map((label, k) => (
                <label key={label} className="field">
                  <span className="field__label">{label}</span>
                  <select
                    className="optimizer__select"
                    value={b.stats[k] ?? ''}
                    onChange={(e) => {
                      const next = [...b.stats];
                      const v = e.target.value as ArmorStat | '';
                      if (v) { const at = next.indexOf(v); if (at >= 0) next[at] = next[k]!; next[k] = v; } else next.splice(k);
                      edit(b.id, { stats: next.filter(Boolean).slice(0, 3) });
                    }}
                  >
                    {k > 0 && <option value="">None</option>}
                    {ARMOR_STATS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </li>
        ))}
      </ul>
      </Reveal>
      {builds && (
        <button className="button builds__add" onClick={add}><Icon name="add" /> Add a {CLASSES[classType]} build</button>
      )}
    </Sheet>
  );
}
