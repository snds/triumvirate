// Build optimizer: set the stats you want, and it finds the five armor pieces (and stat mods) that
// get there, from everything the class owns on any character or in the vault.
import { useEffect, useMemo, useState } from 'react';
import {
  ARMOR_BUCKETS, ARMOR_STATS, LOADOUT_BUCKETS, STAT_MAX, optimizeArmor,
  type AppraisedItem, type ArmorSet, type ArmorStat, type CharacterRow, type OptimizerResult,
} from '@triumvirate/core/browser';
import type { LoadoutDraft } from '../api.ts';
import { ItemTile } from './ItemTile.tsx';
import { Icon } from './Icon.tsx';
import { Sheet } from '../ui/Sheet.tsx';

type Targets = Record<ArmorStat, number>;
const NO_TARGETS = Object.fromEntries(ARMOR_STATS.map((s) => [s, 0])) as Targets;
const SHOWN = 8;

/** Remembered per class, so coming back picks up where you left off. */
const memoryKey = (classType: number) => `triumvirate.optimizer.${classType}`;
interface Saved { targets: Targets; exotic: string; set: string; mods: number }
function recall(classType: number): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(memoryKey(classType)) ?? 'null') as Partial<Saved> | null;
    return { targets: { ...NO_TARGETS, ...raw?.targets }, exotic: raw?.exotic ?? 'any', set: raw?.set ?? '', mods: raw?.mods ?? 5 };
  } catch {
    return { targets: NO_TARGETS, exotic: 'any', set: '', mods: 5 };
  }
}

export function OptimizerSheet({ character, items, itemSets, onClose, onEquip, onSave }: {
  character: CharacterRow;
  items: AppraisedItem[];
  itemSets?: Record<string, ArmorSet>;
  onClose: () => void;
  /** Puts these armor pieces on the character. */
  onEquip: (instanceIds: string[]) => Promise<void>;
  onSave: (draft: LoadoutDraft) => Promise<void>;
}) {
  const start = useMemo(() => recall(character.classType), [character.classType]);
  const [targets, setTargets] = useState<Targets>(start.targets);
  const [exotic, setExotic] = useState(start.exotic);
  const [set, setSet] = useState(start.set);
  const [mods, setMods] = useState(start.mods);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState<number>();
  const [note, setNote] = useState('');
  useEffect(() => {
    try { localStorage.setItem(memoryKey(character.classType), JSON.stringify({ targets, exotic, set, mods })); } catch { /* private mode */ }
  }, [character.classType, targets, exotic, set, mods]);

  const armor = useMemo(
    () => items.filter((i) => i.itemType === 2 && i.instanceId && i.bucketHash && (ARMOR_BUCKETS as readonly number[]).includes(i.bucketHash) && (i.classType === character.classType || i.classType === 3)),
    [items, character.classType],
  );
  // Exotic armor this class owns, one entry per exotic.
  const exotics = useMemo(() => {
    const seen = new Map<number, AppraisedItem>();
    for (const i of armor) if (i.tier === 'Exotic' && !seen.has(i.itemHash)) seen.set(i.itemHash, i);
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [armor]);
  // Sets with at least 2 pieces in different slots, and how many slots they cover.
  const sets = useMemo(() => {
    const slots = new Map<number, Set<number>>();
    for (const i of armor) if (i.setHash) (slots.get(i.setHash) ?? slots.set(i.setHash, new Set()).get(i.setHash)!).add(i.bucketHash!);
    return [...slots].filter(([h, s]) => s.size >= 2 && itemSets?.[h])
      .map(([hash, s]) => ({ hash, name: itemSets![hash]!.name, slots: s.size, perks: itemSets![hash]!.perks }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [armor, itemSets]);

  // Stats you set highest matter most; spare points and mods go there first.
  const priority = useMemo(() => [...ARMOR_STATS].sort((a, b) => targets[b] - targets[a]), [targets]);
  const [setHash, setPieces] = set ? set.split(':').map(Number) as [number, number] : [];
  const out = useMemo(() => optimizeArmor({
    items: armor, classType: character.classType, targets, priority,
    exotic: exotic === 'any' || exotic === 'none' ? exotic : Number(exotic),
    set: setHash ? { hash: setHash, pieces: setPieces! } : undefined,
    modSlots: mods, limit: 20,
  }, itemSets), [armor, character.classType, targets, priority, exotic, setHash, setPieces, mods, itemSets]);

  const byId = useMemo(() => new Map(armor.map((i) => [i.instanceId!, i])), [armor]);
  const icons = new Map((character.stats ?? []).map((s) => [s.name, s.icon]));
  const results = more ? out.results : out.results.slice(0, SHOWN);

  const act = async (n: number, fn: () => Promise<void>) => {
    setBusy(n);
    setNote('');
    try { await fn(); } catch (e) { setNote(e instanceof Error ? e.message : String(e)); } finally { setBusy(undefined); }
  };
  const draft = (r: OptimizerResult): LoadoutDraft => {
    // Keeps the weapons, ghost, and subclass the character has on; swaps in the armor.
    const keep = items.filter((i) => i.owner === character.id && i.equipped && i.bucketHash && LOADOUT_BUCKETS.includes(i.bucketHash) && !(ARMOR_BUCKETS as readonly number[]).includes(i.bucketHash));
    const picked = r.pieces.map((p) => byId.get(p.instanceId)!).filter(Boolean);
    const lead = priority.filter((s) => targets[s] > 0).slice(0, 2).map((s) => `${r.total[ARMOR_STATS.indexOf(s)]} ${s}`);
    return {
      name: lead.length ? `Optimized: ${lead.join(', ')}` : 'Optimized armor',
      classType: character.classType,
      items: [...keep, ...picked].map((i) => ({ instanceId: i.instanceId!, itemHash: i.itemHash, bucketHash: i.bucketHash })),
      notes: modLine(r) ? `Stat mods: ${modLine(r)}.` : undefined,
      ...(character.subclass && Object.keys(character.subclass.parts).length ? { subclass: character.subclass } : {}),
    };
  };

  return (
    <Sheet title={`Optimize ${character.className} armor`} onClose={onClose} full className="sheet--optimizer">
      <div className="optimizer-wrap"><div className="optimizer">
        <section className="optimizer__controls" aria-label="What you want">
          <h3 className="field__label">Lowest value for each stat</h3>
          <ul className="optimizer__targets">
            {ARMOR_STATS.map((s) => (
              <li key={s} className="optimizer__target">
                <label htmlFor={`opt-${s}`} className="optimizer__stat">
                  {icons.get(s) && <img src={icons.get(s)} alt="" />}{s}
                </label>
                <input
                  id={`opt-${s}`} type="range" min={0} max={STAT_MAX} step={10} value={targets[s]}
                  onChange={(e) => setTargets((t) => ({ ...t, [s]: Number(e.target.value) }))}
                  aria-valuetext={targets[s] ? `At least ${targets[s]}` : 'No minimum'}
                />
                <output className="optimizer__value" htmlFor={`opt-${s}`}>{targets[s] || 'Any'}</output>
              </li>
            ))}
          </ul>
          <p className="muted optimizer__hint">Stats you set highest get the spare points and mods.</p>
          <div className="optimizer__choices">
            <label className="field">
              <span className="field__label">Exotic</span>
              <select className="optimizer__select" value={exotic} onChange={(e) => setExotic(e.target.value)}>
                <option value="any">Any or none</option>
                <option value="none">No exotic</option>
                {exotics.map((i) => <option key={i.itemHash} value={i.itemHash}>{i.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Set bonus</span>
              <select className="optimizer__select" value={set} onChange={(e) => setSet(e.target.value)}>
                <option value="">Not needed</option>
                {sets.flatMap((s) => [2, 4].filter((n) => n <= s.slots && s.perks.some((p) => p.count === n)).map((n) => (
                  <option key={`${s.hash}:${n}`} value={`${s.hash}:${n}`}>{s.name}, {n} pieces</option>
                )))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Stat mods to use</span>
              <select className="optimizer__select" value={mods} onChange={(e) => setMods(Number(e.target.value))}>
                {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n === 0 ? 'None' : `Up to ${n} (+10 each)`}</option>)}
              </select>
            </label>
          </div>
          <button className="button button--quiet" onClick={() => { setTargets(NO_TARGETS); setExotic('any'); setSet(''); setMods(5); }}>Reset</button>
        </section>

        <section className="optimizer__results" aria-label="Best armor" aria-live="polite">
          <p className="muted optimizer__summary">
            {out.results.length
              ? `Best of ${out.checked.toLocaleString()} combinations from ${armor.length} pieces. Stats are base rolls plus mods; masterwork and tuning add a little more in game.`
              : out.reason}
          </p>
          {note && <p className="error">{note}</p>}
          <ol className="optimizer__list">
            {results.map((r, n) => (
              <li key={r.pieces.map((p) => p.instanceId).join()} className="loadout-card optimizer__result" aria-busy={busy === n || undefined}>
                <div className="loadout-strip">
                  <div className="loadout-strip__group">
                    {r.pieces.map((p) => { const i = byId.get(p.instanceId); return i ? <ItemTile key={p.instanceId} item={i} /> : null; })}
                  </div>
                </div>
                <StatBlock result={r} targets={targets} icons={icons} />
                <p className="optimizer__meta">
                  {[modLine(r) && `Mods: ${modLine(r)}`, ...r.sets.map((s) => `${s.name ?? 'Set'} ×${s.count}`), where(r, byId, character.id)].filter(Boolean).join(' · ')}
                </p>
                <div className="loadout-card__actions">
                  <button className="button button--primary" disabled={busy !== undefined || worn(r, byId, character.id)} onClick={() => void act(n, () => onEquip(r.pieces.map((p) => p.instanceId)))}>
                    <Icon name="equip" /> {worn(r, byId, character.id) ? 'Equipped' : 'Equip armor'}
                  </button>
                  <button className="button" disabled={busy !== undefined} onClick={() => void act(n, () => onSave(draft(r)))}>
                    <Icon name="save" /> Save as loadout
                  </button>
                  {busy === n && <span className="spinner" aria-label="Working" />}
                </div>
              </li>
            ))}
          </ol>
          {!more && out.results.length > SHOWN && (
            <button className="button button--quiet" onClick={() => setMore(true)}>Show {out.results.length - SHOWN} more</button>
          )}
        </section>
      </div></div>
    </Sheet>
  );
}

/** Each stat as a bar: base roll, then the mods on top, with a tick at the target. */
function StatBlock({ result, targets, icons }: { result: OptimizerResult; targets: Targets; icons: Map<string, string | undefined> }) {
  return (
    <dl className="optimizer__stats">
      {ARMOR_STATS.map((s, k) => {
        const base = Math.min(result.base[k]!, STAT_MAX);
        const total = result.total[k]!;
        const modded = Math.min(total, STAT_MAX) - base;
        return (
          <div key={s} className="optimizer__row">
            <dt>{icons.get(s) && <img src={icons.get(s)} alt="" />}<span>{s}</span></dt>
            <dd>
              <span className="optimizer__track" aria-hidden>
                <span className="stats__bar" style={{ width: `${(base / STAT_MAX) * 100}%` }} />
                <span className="stats__bonus" style={{ width: `${(modded / STAT_MAX) * 100}%` }} />
                {targets[s] > 0 && <span className="optimizer__goal" style={{ left: `${(targets[s] / STAT_MAX) * 100}%` }} />}
              </span>
              <span className={`stats__value${modded > 0 ? ' is-boosted' : ''}`}>{total}</span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

const modLine = (r: OptimizerResult) => ARMOR_STATS.map((s, k) => (r.mods[k] ? `${r.mods[k]}× ${s}` : '')).filter(Boolean).join(', ');
const worn = (r: OptimizerResult, byId: Map<string, AppraisedItem>, charId: string) =>
  r.pieces.every((p) => { const i = byId.get(p.instanceId); return i?.owner === charId && i.equipped; });
/** How much has to move: "3 in the vault" reads faster than five locations. */
function where(r: OptimizerResult, byId: Map<string, AppraisedItem>, charId: string) {
  const vault = r.pieces.filter((p) => byId.get(p.instanceId)?.owner === 'vault').length;
  const other = r.pieces.filter((p) => { const o = byId.get(p.instanceId)?.owner; return o && o !== 'vault' && o !== charId; }).length;
  return [vault && `${vault} in the vault`, other && `${other} on another character`].filter(Boolean).join(', ');
}
