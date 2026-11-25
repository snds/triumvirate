import { useMemo, useState } from 'react';
import { LOADOUT_BUCKETS, setBonuses, type AppraisedItem, type ArmorSet, type CharacterRow, type SavedLoadout } from '@triumvirate/core/browser';
import type { LoadoutDraft } from '../api.ts';
import { BuildSummary } from './BuildSummary.tsx';
import { ItemTile } from './ItemTile.tsx';
import { Icon } from './Icon.tsx';
import { Sheet } from './Sheet.tsx';

/** Slots in the game's loadout order, with the names the game uses. */
const SLOTS: { bucket: number; label: string }[] = [
  { bucket: LOADOUT_BUCKETS.at(-1)!, label: 'Subclass' },
  { bucket: 1498876634, label: 'Kinetic' },
  { bucket: 2465295065, label: 'Energy' },
  { bucket: 953998645, label: 'Power' },
  { bucket: 3448274439, label: 'Helmet' },
  { bucket: 3551918588, label: 'Arms' },
  { bucket: 14239492, label: 'Chest' },
  { bucket: 20886954, label: 'Legs' },
  { bucket: 1585787867, label: 'Class item' },
  { bucket: 4023194814, label: 'Ghost' },
];
const isExotic = (i?: AppraisedItem) => i?.tier === 'Exotic' && (i.itemType === 2 || i.itemType === 3);

/**
 * Making or editing a Triumvirate loadout: name it, then pick one item per slot from anywhere you
 * own it (this character, the others, the vault). It starts from what the character is wearing. The
 * summary underneath updates as you pick, so set bonuses show before you save.
 */
export function LoadoutEditor({ character, items, itemSets, editing, onSave, onClose }: {
  character: CharacterRow;
  items: AppraisedItem[];
  itemSets?: Record<string, ArmorSet>;
  /** The loadout being edited; a new one when absent. */
  editing?: SavedLoadout;
  onSave: (draft: LoadoutDraft) => Promise<void>;
  onClose: () => void;
}) {
  const byId = useMemo(() => new Map(items.filter((i) => i.instanceId).map((i) => [i.instanceId!, i])), [items]);
  const wearing = useMemo(
    () => items.filter((i) => i.owner === character.id && i.equipped && i.bucketHash && LOADOUT_BUCKETS.includes(i.bucketHash)),
    [items, character.id],
  );
  // Slot → instance id. A new loadout starts from what the character has on.
  const [picks, setPicks] = useState<Record<number, string | undefined>>(() => {
    const start = editing ? editing.items.map((l) => byId.get(l.instanceId)).filter((i): i is AppraisedItem => !!i) : wearing;
    return Object.fromEntries(start.map((i) => [i.bucketHash!, i.instanceId!]));
  });
  const [name, setName] = useState(editing?.name ?? defaultName(character));
  const [keepArtifact, setKeepArtifact] = useState(editing ? !!editing.artifact : (character.artifact?.length ?? 0) > 0);
  const [picking, setPicking] = useState<number>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const chosen = SLOTS.map((s) => (picks[s.bucket] ? byId.get(picks[s.bucket]!) : undefined));
  const picked = chosen.filter((i): i is AppraisedItem => !!i);
  const subclassItem = chosen[0];
  // The setup comes from the character when it's the subclass they're wearing; otherwise from the
  // loadout being edited, if it's the same subclass; otherwise just its name.
  const subclass = subclassItem
    ? (subclassItem.equipped && subclassItem.owner === character.id && character.subclass)
      || (editing?.subclass?.name === subclassItem.name ? editing.subclass : undefined)
      || { name: subclassItem.name, element: subclassItem.damage ?? '', icon: subclassItem.icon, parts: {} }
    : undefined;
  const artifact = keepArtifact ? (editing?.artifact && !character.artifact ? editing.artifact : character.artifact) : undefined;
  const exotics = { weapon: picked.filter((i) => isExotic(i) && i.itemType === 3), armor: picked.filter((i) => isExotic(i) && i.itemType === 2) };
  const clash = exotics.weapon.length > 1 ? 'Two exotic weapons: only the first will go on.' : exotics.armor.length > 1 ? 'Two exotic armor pieces: only the first will go on.' : '';

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await onSave({
        name: name.trim(),
        // Weapons-only loadouts work on any class.
        classType: picked.some((i) => i.classType !== 3 || i.bucket === 'Subclass') ? character.classType : 3,
        items: picked.map((i) => ({ instanceId: i.instanceId!, itemHash: i.itemHash, bucketHash: i.bucketHash })),
        notes: editing?.notes,
        ...(subclass && Object.keys(subclass.parts).length ? { subclass } : {}),
        ...(artifact?.length ? { artifact } : {}),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const slot = SLOTS.find((s) => s.bucket === picking);
  return (
    <>
      <Sheet
        title={editing ? `Edit ${editing.name}` : `New ${character.className} loadout`}
        onClose={onClose}
        full
        footer={(
          <div className="sheet__actions">
            {error && <p className="error editor__error">{error}</p>}
            <button className="button button--quiet" onClick={onClose}>Cancel</button>
            <button className="button button--primary" disabled={saving || !name.trim() || picked.length === 0} onClick={() => void save()}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Save loadout'}
            </button>
          </div>
        )}
      >
        <label className="field">
          <span className="field__label">Name</span>
          <input className="search field__input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} enterKeyHint="done" />
        </label>

        <div className="editor__bar">
          <h3 className="field__label">Gear <span className="vault__count">{picked.length}/{SLOTS.length}</span></h3>
          <button className="button button--quiet" onClick={() => setPicks(Object.fromEntries(wearing.map((i) => [i.bucketHash!, i.instanceId!])))}>
            <Icon name="equip" /> Use what I'm wearing
          </button>
        </div>
        <ul className="editor__slots">
          {SLOTS.map((s, n) => {
            const item = chosen[n];
            const set = item?.setHash ? itemSets?.[item.setHash]?.name : undefined;
            return (
              <li key={s.bucket} className="editor-slot">
                <button type="button" className="editor-slot__pick" onClick={() => setPicking(s.bucket)} aria-label={`${s.label}: ${item ? item.name : 'empty'}. Change`}>
                  {item
                    ? (s.label === 'Subclass'
                      ? <span className="loadout-strip__subclass editor-slot__art">{item.icon && <img src={item.icon} alt="" />}</span>
                      : <span className="editor-slot__art"><ItemTile item={item} /></span>)
                    : <span className="editor-slot__empty"><Icon name="add" /></span>}
                  <span className="editor-slot__text">
                    <span className="editor-slot__label">{s.label}</span>
                    <span className="editor-slot__name">{item ? item.name : 'Empty'}</span>
                    {item && (
                      <span className="editor-slot__meta">
                        {[s.label === 'Subclass' ? undefined : item.power, item.owner === character.id ? (item.equipped ? 'Equipped' : 'On this character') : item.location, set].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  <Icon name="chevronRight" className="editor-slot__chevron" />
                </button>
                {item && (
                  <button type="button" className="icon-button" onClick={() => setPicks((p) => ({ ...p, [s.bucket]: undefined }))} aria-label={`Clear ${s.label}`} title="Clear">
                    <Icon name="close" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {clash && <p className="editor__warning"><Icon name="warning" /> {clash}</p>}

        <h3 className="field__label">At a glance</h3>
        <BuildSummary
          subclass={subclass}
          sets={setBonuses(picked, itemSets)}
          artifact={artifact}
          artifactNote={character.artifact?.length ? 'Not saved' : 'No artifact perks on'}
        />
        {(character.artifact?.length ?? 0) > 0 && (
          <label className="check-row">
            <input type="checkbox" checked={keepArtifact} onChange={(e) => setKeepArtifact(e.target.checked)} />
            <span>
              Save my artifact perks with it ({character.artifact!.length})
              <span className="check-row__hint">A reminder only: Bungie doesn't let apps change artifact perks.</span>
            </span>
          </label>
        )}
      </Sheet>
      {slot && (
        <ItemPicker
          slot={slot}
          character={character}
          items={items}
          itemSets={itemSets}
          current={picks[slot.bucket]}
          onPick={(id) => { setPicks((p) => ({ ...p, [slot.bucket]: id })); setPicking(undefined); }}
          onClose={() => setPicking(undefined)}
        />
      )}
    </>
  );
}

function defaultName(c: CharacterRow) {
  const sub = c.subclass?.name;
  // "Voidwalker Warlock", but not "Prismatic Warlock Warlock".
  return sub ? (sub.includes(c.className) ? sub : `${sub} ${c.className}`) : `${c.className} loadout`;
}

/** Everything that fits one slot, from every character and the vault, strongest first. */
function ItemPicker({ slot, character, items, itemSets, current, onPick, onClose }: {
  slot: { bucket: number; label: string };
  character: CharacterRow;
  items: AppraisedItem[];
  itemSets?: Record<string, ArmorSet>;
  current?: string;
  onPick: (instanceId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const isSubclass = slot.label === 'Subclass';
  const options = items
    .filter((i) => i.instanceId && i.bucketHash === slot.bucket && (i.classType === 3 || i.classType === character.classType)
      // Subclasses never leave their character.
      && (!isSubclass || i.owner === character.id))
    .filter((i) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      const set = i.setHash ? itemSets?.[i.setHash]?.name ?? '' : '';
      return q.split(/\s+/).every((w) => `${i.name} ${i.type} ${i.tier} ${i.damage ?? ''} ${set}`.toLowerCase().includes(w));
    })
    .sort((a, b) => Number(b.instanceId === current) - Number(a.instanceId === current)
      || Number(b.equipped && b.owner === character.id) - Number(a.equipped && a.owner === character.id)
      || (b.power ?? 0) - (a.power ?? 0) || a.name.localeCompare(b.name));
  return (
    <Sheet title={`Choose ${slot.label.toLowerCase()}`} onClose={onClose} full>
      {!isSubclass && (
        <input
          className="search field__input"
          type="search"
          placeholder={slot.bucket >= 0 && ['Helmet', 'Arms', 'Chest', 'Legs', 'Class item'].includes(slot.label) ? 'Name or set…' : 'Name, type, element…'}
          aria-label={`Search ${slot.label.toLowerCase()}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {options.length === 0 && <p className="empty">Nothing here fits.</p>}
      <ul className="picker">
        {options.map((i) => {
          const set = i.setHash ? itemSets?.[i.setHash]?.name : undefined;
          const where = i.owner === character.id ? (i.equipped ? 'Equipped' : 'On this character') : i.location;
          return (
            <li key={i.instanceId}>
              <button type="button" className={`picker__row${i.instanceId === current ? ' is-selected' : ''}`} onClick={() => onPick(i.instanceId!)} aria-pressed={i.instanceId === current}>
                {isSubclass
                  ? <span className="loadout-strip__subclass editor-slot__art">{i.icon && <img src={i.icon} alt="" />}</span>
                  : <span className="editor-slot__art"><ItemTile item={i} /></span>}
                <span className="editor-slot__text">
                  <span className="editor-slot__name">{i.name}</span>
                  <span className="editor-slot__meta">{[i.type, set].filter(Boolean).join(' · ')}</span>
                  <span className="editor-slot__meta">{where}</span>
                </span>
                {i.instanceId === current && <Icon name="check" className="picker__check" />}
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
