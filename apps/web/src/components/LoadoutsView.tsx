import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LOADOUT_BUCKETS, loadoutStatus, type AppraisedItem, type CharacterRow, type GameLoadout, type LoadoutStyles, type SavedLoadout,
} from '@triumvirate/core/browser';
import {
  applyLoadout, createLoadout, deleteLoadout, equipGameLoadout, listLoadouts, restyleGameLoadout, saveGameLoadout, updateLoadout,
  type ActionResult, type GameSlotLook, type Inventory, type LoadoutDraft,
} from '../api.ts';
import { ItemTile } from './ItemTile.tsx';
import { Icon } from './Icon.tsx';
import { Sheet } from './Sheet.tsx';

interface Props {
  inv: Inventory;
  /** The character whose loadouts are shown (shared with the phone's store switcher). */
  characterId: string;
  onCharacter: (id: string) => void;
  onSelect: (item: AppraisedItem) => void;
  /** Patches the items an equip changed and reports anything that stayed put. */
  onSettle: (res: ActionResult, what: string) => void;
  /** Re-reads the inventory after Bungie did the work itself (in-game loadouts). */
  onReload: () => Promise<void>;
  onToast: (text: string) => void;
}

/** Loadout items in the game's order: subclass, weapons, armor, ghost. */
const ORDER = [LOADOUT_BUCKETS.at(-1)!, ...LOADOUT_BUCKETS.slice(0, -1)];
const bySlot = (a?: number, b?: number) => ORDER.indexOf(a ?? 0) - ORDER.indexOf(b ?? 0);

type Ask =
  | { kind: 'name'; title: string; initial: string; action: string; onDone: (name: string) => Promise<void> }
  | { kind: 'look'; slot: GameLoadout; saveGear: boolean }
  | { kind: 'confirm'; title: string; body: string; action: string; danger?: boolean; onDone: () => Promise<void> };

/**
 * Loadouts for one character: what it's wearing now, its in-game loadout slots, and Triumvirate's
 * own saved loadouts for its class. Equipping a Triumvirate loadout pulls gear from the vault and
 * other characters first; in-game slots are equipped by Bungie, as the game would.
 */
export function LoadoutsView({ inv, characterId, onCharacter, onSelect, onSettle, onReload, onToast }: Props) {
  const character = inv.characters.find((c) => c.id === characterId) ?? inv.characters[0];
  const [saved, setSaved] = useState<SavedLoadout[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<string>(); // which card is working
  const [ask, setAsk] = useState<Ask>();
  useEffect(() => {
    listLoadouts().then(setSaved).catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);

  const byId = useMemo(() => new Map(inv.items.filter((i) => i.instanceId).map((i) => [i.instanceId!, i])), [inv.items]);
  if (!character) return <p className="empty loadouts">No characters yet.</p>;

  const wearing = inv.items
    .filter((i) => i.owner === character.id && i.equipped && i.bucketHash && LOADOUT_BUCKETS.includes(i.bucketHash))
    .sort((a, b) => bySlot(a.bucketHash, b.bucketHash));
  const wearingDraft = (name: string): LoadoutDraft => ({
    name,
    // Weapons-only loadouts work on any class; anything with armor or a subclass is this class's.
    classType: wearing.some((i) => i.classType !== 3 || i.bucket === 'Subclass') ? character.classType : 3,
    items: wearing.map((i) => ({ instanceId: i.instanceId!, itemHash: i.itemHash, bucketHash: i.bucketHash })),
  });
  const slots = inv.gameLoadouts?.[character.id] ?? [];
  const mine = (saved ?? []).filter((l) => l.classType === 3 || l.classType === character.classType);

  /** Runs a card action with its spinner on, and keeps errors in a toast. */
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e) { onToast(e instanceof Error ? e.message : String(e)); } finally { setBusy(undefined); }
  };
  const gameAction = (key: string, what: string, fn: () => Promise<{ error?: string }>) => run(key, async () => {
    const res = await fn();
    await onReload();
    if (res.error) onToast(`Couldn't ${what}: ${res.error}`);
  });

  const newFromWearing = () => setAsk({
    kind: 'name', title: 'Save what you\'re wearing', action: 'Save loadout',
    // "Voidwalker Warlock", but not "Prismatic Warlock Warlock".
    initial: character.subclass?.name
      ? (character.subclass.name.includes(character.className) ? character.subclass.name : `${character.subclass.name} ${character.className}`)
      : `${character.className} loadout`,
    onDone: async (name) => { const l = await createLoadout(wearingDraft(name)); setSaved((s) => [l, ...(s ?? [])]); },
  });
  const copyFromGame = (slot: GameLoadout) => run(`game-${slot.index}`, async () => {
    const items = slot.items.map((id) => byId.get(id)).filter((i): i is AppraisedItem => !!i)
      .map((i) => ({ instanceId: i.instanceId!, itemHash: i.itemHash, bucketHash: i.bucketHash }));
    const l = await createLoadout({ name: slot.name ?? `In-game ${slot.index + 1}`, classType: character.classType, items });
    setSaved((s) => [l, ...(s ?? [])]);
    onToast(`Copied ${l.name} to Triumvirate loadouts.`);
  });

  return (
    <section className="loadouts" aria-label="Loadouts">
      <header className="loadouts__header">
        <div>
          <h2 className="loadouts__title">Loadouts</h2>
          <p className="muted loadouts__lede">Equipping works in orbit, in a social space, or offline.</p>
        </div>
        {inv.characters.length > 1 && (
          <div className="loadouts__picker" role="tablist" aria-label="Character">
            {inv.characters.map((c) => (
              <button
                key={c.id}
                role="tab"
                aria-selected={c.id === character.id}
                className={`store-switcher__tab${c.id === character.id ? ' is-selected' : ''}`}
                onClick={() => onCharacter(c.id)}
              >
                <span className="store-switcher__emblem" style={c.emblemBackground ? { backgroundImage: `url(${c.emblemBackground})` } : undefined} aria-hidden />
                <span className="store-switcher__text">
                  <span className="store-switcher__name">{c.className}</span>
                  <span className="store-switcher__meta"><Icon name="power" filled />{c.light}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </header>

      <article className="loadout-card loadout-card--current">
        <div className="loadout-card__head">
          <div className="loadout-card__titles">
            <h3 className="loadout-card__name">Wearing now</h3>
            <p className="loadout-card__meta">{character.subclass ? `${character.subclass.name} · ` : ''}{wearing.length} items</p>
          </div>
          <button className="button button--primary" onClick={newFromWearing} disabled={wearing.length === 0}>
            <Icon name="save" /> Save as loadout
          </button>
        </div>
        <ItemStrip items={wearing} onSelect={onSelect} />
      </article>

      <h3 className="drawer__section loadouts__section">
        <Icon name="game" /> In game <span className="vault__count">{slots.filter((s) => !s.empty).length}/{slots.length}</span>
      </h3>
      {slots.length === 0 ? (
        <p className="empty">Refresh to read your in-game loadouts.</p>
      ) : (
        <ul className="loadouts__grid">
          {slots.map((slot) => {
            const key = `game-${slot.index}`;
            const items = slot.items.map((id) => byId.get(id)).filter((i): i is AppraisedItem => !!i).sort((a, b) => bySlot(a.bucketHash, b.bucketHash));
            const status = loadoutStatus({ items: slot.items.map((id) => ({ instanceId: id, itemHash: 0 })) }, character.id, inv.items);
            return (
              <li key={slot.index} className={`loadout-card loadout-card--game${slot.empty ? ' is-empty' : ''}`} aria-busy={busy === key || undefined}>
                <div className="loadout-card__head">
                  <GameSwatch slot={slot} />
                  <div className="loadout-card__titles">
                    <h4 className="loadout-card__name">{slot.empty ? `Slot ${slot.index + 1}` : slot.name ?? `Loadout ${slot.index + 1}`}</h4>
                    <p className="loadout-card__meta">
                      {slot.empty ? 'Nothing saved yet' : <StatusLine status={status} />}
                    </p>
                  </div>
                  {busy === key && <span className="spinner" aria-label="Working" />}
                  {/* An empty slot is one line: its only action sits beside the name. */}
                  {slot.empty && (
                    <button className="button" disabled={!!busy || wearing.length === 0} onClick={() => setAsk({ kind: 'look', slot, saveGear: true })}>
                      <Icon name="save" /> Save here
                    </button>
                  )}
                </div>
                {!slot.empty && <ItemStrip items={items} missing={status.missing.length} onSelect={onSelect} />}
                {!slot.empty && <div className="loadout-card__actions">
                  {!slot.empty && (
                    <button
                      className="button button--primary"
                      disabled={!!busy || status.applied}
                      onClick={() => gameAction(key, `equip ${slot.name ?? 'the loadout'}`, () => equipGameLoadout(character.id, slot.index))}
                    >
                      <Icon name="equip" /> {status.applied ? 'Equipped' : 'Equip'}
                    </button>
                  )}
                  <button
                    className="button"
                    disabled={!!busy || wearing.length === 0}
                    onClick={() => setAsk({ kind: 'look', slot, saveGear: true })}
                  >
                    <Icon name="save" /> Replace
                  </button>
                  <button className="icon-button" disabled={!!busy} onClick={() => setAsk({ kind: 'look', slot, saveGear: false })} aria-label="Change name and look" title="Change name and look">
                    <Icon name="edit" />
                  </button>
                  <button className="icon-button" disabled={!!busy} onClick={() => void copyFromGame(slot)} aria-label="Copy to Triumvirate loadouts" title="Copy to Triumvirate loadouts">
                    <Icon name="import" />
                  </button>
                </div>}
              </li>
            );
          })}
        </ul>
      )}

      <h3 className="drawer__section loadouts__section">
        <Icon name="loadouts" /> Triumvirate <span className="vault__count">{mine.length}</span>
      </h3>
      {loadError && <p className="error">{loadError}</p>}
      {saved && mine.length === 0 && (
        <p className="empty">No saved loadouts for {character.className} yet. Unlike in-game slots, these have no limit and can pull gear from the vault and your other characters.</p>
      )}
      <ul className="loadouts__grid">
        {mine.map((l) => {
          const key = `saved-${l.id}`;
          const items = l.items.map((x) => byId.get(x.instanceId)).filter((i): i is AppraisedItem => !!i).sort((a, b) => bySlot(a.bucketHash, b.bucketHash));
          const status = loadoutStatus(l, character.id, inv.items);
          return (
            <li key={l.id} className="loadout-card" aria-busy={busy === key || undefined}>
              <div className="loadout-card__head">
                <div className="loadout-card__titles">
                  <h4 className="loadout-card__name">{l.name}</h4>
                  <p className="loadout-card__meta">{l.classType === 3 ? 'Any class · ' : ''}<StatusLine status={status} /></p>
                </div>
                {busy === key && <span className="spinner" aria-label="Working" />}
              </div>
              <ItemStrip items={items} missing={status.missing.length} onSelect={onSelect} />
              <div className="loadout-card__actions">
                <button
                  className="button button--primary"
                  disabled={!!busy || status.applied || items.length === 0}
                  onClick={() => run(key, async () => onSettle(await applyLoadout(l.id, character.id), `equip ${l.name}`))}
                >
                  <Icon name="equip" /> {status.applied ? 'Equipped' : 'Equip'}
                </button>
                <button
                  className="button"
                  disabled={!!busy || wearing.length === 0}
                  onClick={() => setAsk({
                    kind: 'confirm', title: `Update ${l.name}?`, action: 'Update',
                    body: `It will hold what your ${character.className} is wearing now, in place of its ${l.items.length} saved items.`,
                    onDone: async () => {
                      const next = await updateLoadout(l.id, { ...wearingDraft(l.name), notes: l.notes });
                      setSaved((s) => (s ?? []).map((x) => (x.id === l.id ? next : x)));
                    },
                  })}
                >
                  <Icon name="save" /> Update
                </button>
                <button
                  className="icon-button"
                  disabled={!!busy}
                  aria-label={`Rename ${l.name}`}
                  title="Rename"
                  onClick={() => setAsk({
                    kind: 'name', title: 'Rename loadout', initial: l.name, action: 'Rename',
                    onDone: async (name) => {
                      const next = await updateLoadout(l.id, { name, classType: l.classType, items: l.items, notes: l.notes });
                      setSaved((s) => (s ?? []).map((x) => (x.id === l.id ? next : x)));
                    },
                  })}
                >
                  <Icon name="edit" />
                </button>
                <button
                  className="icon-button"
                  disabled={!!busy}
                  aria-label={`Delete ${l.name}`}
                  title="Delete"
                  onClick={() => setAsk({
                    kind: 'confirm', title: `Delete ${l.name}?`, action: 'Delete', danger: true,
                    body: 'Only the saved loadout goes. Your gear stays where it is.',
                    onDone: async () => { await deleteLoadout(l.id); setSaved((s) => (s ?? []).filter((x) => x.id !== l.id)); },
                  })}
                >
                  <Icon name="delete" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {ask?.kind === 'name' && <NameSheet ask={ask} onClose={() => setAsk(undefined)} onToast={onToast} />}
      {ask?.kind === 'confirm' && <ConfirmSheet ask={ask} onClose={() => setAsk(undefined)} onToast={onToast} />}
      {ask?.kind === 'look' && (
        <LookSheet
          slot={ask.slot}
          saveGear={ask.saveGear}
          styles={inv.loadoutStyles}
          character={character}
          onClose={() => setAsk(undefined)}
          onSave={(look) => {
            const slot = ask.slot;
            setAsk(undefined);
            void gameAction(`game-${slot.index}`, 'save the loadout', () => (ask.saveGear
              ? saveGameLoadout(character.id, slot.index, look)
              : restyleGameLoadout(character.id, slot.index, look)));
          }}
        />
      )}
    </section>
  );
}

function StatusLine({ status }: { status: ReturnType<typeof loadoutStatus> }) {
  if (status.applied) return <span className="loadout-status loadout-status--on"><Icon name="check" /> Wearing all {status.total}</span>;
  return (
    <span className="loadout-status">
      {status.total} items{status.worn > 0 ? ` · ${status.worn} on now` : ''}
      {status.missing.length > 0 && <span className="loadout-status--missing"> · {status.missing.length} gone</span>}
    </span>
  );
}

/** The loadout's tiles in two groups (subclass and weapons, armor and ghost), with a dashed placeholder per item you no longer own. */
function ItemStrip({ items, missing = 0, onSelect }: { items: AppraisedItem[]; missing?: number; onSelect: (i: AppraisedItem) => void }) {
  const isFront = (i: AppraisedItem) => i.bucket === 'Subclass' || i.itemType === 3;
  const tile = (i: AppraisedItem) => (i.bucket === 'Subclass'
    // A subclass has no power or rarity frame worth showing; the game draws it as a round glyph.
    ? <button key={i.instanceId} type="button" className="loadout-strip__subclass" onClick={() => onSelect(i)} aria-label={`${i.name} (subclass)`} title={i.name}>{i.icon && <img src={i.icon} alt="" />}</button>
    : <ItemTile key={i.instanceId} item={i} onSelect={onSelect} />);
  const front = items.filter(isFront);
  const back = items.filter((i) => !isFront(i));
  return (
    <div className="loadout-strip">
      {front.length > 0 && <div className="loadout-strip__group">{front.map(tile)}</div>}
      {(back.length > 0 || missing > 0) && (
        <div className="loadout-strip__group">
          {back.map(tile)}
          {Array.from({ length: missing }, (_, n) => (
            <span key={`gone-${n}`} className="loadout-strip__gone" title="No longer in your inventory"><Icon name="warning" /></span>
          ))}
        </div>
      )}
    </div>
  );
}

/** The in-game slot's color and glyph, drawn the way the game draws it. */
function GameSwatch({ slot }: { slot: Pick<GameLoadout, 'colorImage' | 'iconImage' | 'empty' | 'index'> }) {
  return (
    <span className={`game-swatch${slot.empty ? ' is-empty' : ''}`} style={slot.colorImage ? { backgroundImage: `url(${slot.colorImage})` } : undefined} aria-hidden>
      {slot.iconImage ? <img src={slot.iconImage} alt="" /> : <span className="game-swatch__number">{slot.index + 1}</span>}
    </span>
  );
}

function NameSheet({ ask, onClose, onToast }: { ask: Extract<Ask, { kind: 'name' }>; onClose: () => void; onToast: (t: string) => void }) {
  const [name, setName] = useState(ask.initial);
  const [working, setWorking] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.select(); }, []);
  const submit = async () => {
    if (!name.trim()) return;
    setWorking(true);
    try { await ask.onDone(name.trim()); onClose(); } catch (e) { onToast(e instanceof Error ? e.message : String(e)); setWorking(false); }
  };
  return (
    <Sheet title={ask.title} onClose={onClose}>
      <form className="sheet__form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label className="field">
          <span className="field__label">Name</span>
          <input ref={input} className="search field__input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} enterKeyHint="done" />
        </label>
        <div className="sheet__actions">
          <button type="button" className="button button--quiet" onClick={onClose}>Cancel</button>
          <button type="submit" className="button button--primary" disabled={working || !name.trim()}>{ask.action}</button>
        </div>
      </form>
    </Sheet>
  );
}

function ConfirmSheet({ ask, onClose, onToast }: { ask: Extract<Ask, { kind: 'confirm' }>; onClose: () => void; onToast: (t: string) => void }) {
  const [working, setWorking] = useState(false);
  return (
    <Sheet title={ask.title} onClose={onClose}>
      <p className="sheet__body">{ask.body}</p>
      <div className="sheet__actions">
        <button className="button button--quiet" onClick={onClose}>Cancel</button>
        <button
          className={`button ${ask.danger ? 'button--danger' : 'button--primary'}`}
          disabled={working}
          onClick={async () => {
            setWorking(true);
            try { await ask.onDone(); onClose(); } catch (e) { onToast(e instanceof Error ? e.message : String(e)); setWorking(false); }
          }}
        >
          {ask.action}
        </button>
      </div>
    </Sheet>
  );
}

/**
 * Name, color, and icon for an in-game slot, from the game's own lists. With `saveGear`, it also
 * stores what the character is wearing in the slot, replacing what was there.
 */
function LookSheet({ slot, saveGear, styles, character, onClose, onSave }: {
  slot: GameLoadout; saveGear: boolean; styles?: LoadoutStyles; character: CharacterRow;
  onClose: () => void; onSave: (look: GameSlotLook) => void;
}) {
  const [look, setLook] = useState<GameSlotLook>({
    nameHash: slot.nameHash ?? styles?.names[0]?.hash,
    colorHash: slot.colorHash ?? styles?.colors[slot.index % Math.max(1, styles?.colors.length ?? 1)]?.hash,
    iconHash: slot.iconHash ?? styles?.icons[0]?.hash,
  });
  const color = styles?.colors.find((c) => c.hash === look.colorHash)?.image;
  const icon = styles?.icons.find((c) => c.hash === look.iconHash)?.image;
  const name = styles?.names.find((c) => c.hash === look.nameHash)?.name;
  const title = saveGear ? (slot.empty ? `Save to slot ${slot.index + 1}` : `Replace ${slot.name ?? `slot ${slot.index + 1}`}?`) : 'Name and look';
  return (
    <Sheet title={title} onClose={onClose} wide>
      {saveGear && (
        <p className="sheet__body">
          {slot.empty
            ? `Stores what your ${character.className} is wearing now, mods and subclass included.`
            : `Its gear is replaced with what your ${character.className} is wearing now. This can't be undone in game.`}
        </p>
      )}
      <div className="look-preview">
        <GameSwatch slot={{ colorImage: color, iconImage: icon, empty: false, index: slot.index }} />
        <strong>{name ?? `Loadout ${slot.index + 1}`}</strong>
      </div>
      {styles ? (
        <>
          <fieldset className="look-group">
            <legend className="field__label">Name</legend>
            <div className="look-names">
              {styles.names.map((n) => (
                <button key={n.hash} type="button" className={`chip${look.nameHash === n.hash ? ' is-selected' : ''}`} aria-pressed={look.nameHash === n.hash} onClick={() => setLook((l) => ({ ...l, nameHash: n.hash }))}>
                  {n.name}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="look-group">
            <legend className="field__label">Color</legend>
            <div className="look-swatches">
              {styles.colors.map((c, i) => (
                <button key={c.hash} type="button" className={`look-swatch${look.colorHash === c.hash ? ' is-selected' : ''}`} aria-pressed={look.colorHash === c.hash} aria-label={`Color ${i + 1}`} onClick={() => setLook((l) => ({ ...l, colorHash: c.hash }))} style={{ backgroundImage: `url(${c.image})` }} />
              ))}
            </div>
          </fieldset>
          <fieldset className="look-group">
            <legend className="field__label">Icon</legend>
            <div className="look-swatches">
              {styles.icons.map((c, i) => (
                <button key={c.hash} type="button" className={`look-swatch look-swatch--icon${look.iconHash === c.hash ? ' is-selected' : ''}`} aria-pressed={look.iconHash === c.hash} aria-label={`Icon ${i + 1}`} onClick={() => setLook((l) => ({ ...l, iconHash: c.hash }))}>
                  <img src={c.image} alt="" />
                </button>
              ))}
            </div>
          </fieldset>
        </>
      ) : <p className="muted">The game's names and colors load with the next item data update.</p>}
      <div className="sheet__actions">
        <button className="button button--quiet" onClick={onClose}>Cancel</button>
        <button className={`button ${saveGear && !slot.empty ? 'button--danger' : 'button--primary'}`} onClick={() => onSave(look)}>
          {saveGear ? (slot.empty ? 'Save here' : 'Replace') : 'Save look'}
        </button>
      </div>
    </Sheet>
  );
}
