import { useEffect, useRef, useState } from 'react';
import type { AppraisedItem, PerkOption, RollOptions } from '@triumvirate/core/browser';
import { fetchRolls } from '../api.ts';
import { ItemHeader } from './ItemHeader.tsx';
import { Icon } from './Icon.tsx';
import { ItemFacts, PerkCell, PerkGrid, StatBars, VerdictLine } from './ItemParts.tsx';
import { ItemTile } from './ItemTile.tsx';
import { useInventory } from '../inventory-context.ts';
import { TOUCH_QUERY, useMediaQuery } from '../media.ts';

interface Props {
  item: AppraisedItem;
  onClose: () => void;
  /** Opens the chat ready to talk about this item. */
  onAsk: (item: AppraisedItem) => void;
  /** Other copies of the same item you own. */
  copies: AppraisedItem[];
  onSelect: (item: AppraisedItem) => void;
}

type Tab = 'roll' | 'all' | 'details';

/**
 * Item dialog: a large header (shared with the hovercard), actions, then tabs. "This roll" shows
 * the copy you clicked, with its own perks and stats; "All rolls" shows every perk the weapon can
 * drop with and its base stats; "Details" has the rest.
 */
export function ItemDetail({ item, onClose, onAsk, copies, onSelect }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const isWeapon = item.itemType === 3;
  const [tab, setTab] = useState<Tab>('roll');
  // A different item resets to its own roll; switching copies keeps the tab you were on.
  const lastHash = useRef(item.itemHash);
  useEffect(() => {
    if (lastHash.current !== item.itemHash) { setTab('roll'); lastHash.current = item.itemHash; }
  }, [item.itemHash]);
  // Escape closes, like any dialog, unless you're typing in the floating chat (it has its own Escape).
  // Focus moves in so keyboard users land here.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (e.target instanceof Element && e.target.closest('.agent'))) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onClose]);

  const a = item.appraisal;
  const tabs: { id: Tab; label: string }[] = [
    { id: 'roll', label: 'This roll' },
    ...(isWeapon ? [{ id: 'all' as const, label: 'All rolls' }] : []),
    { id: 'details', label: 'Details' },
  ];
  return (
    <div className="dialog-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog item-dialog" role="dialog" aria-modal="true" aria-label={item.name}>
        <ItemHeader item={item} size="dialog">
          <button ref={closeRef} className="icon-button item-header__close" onClick={onClose} aria-label="Close" title="Close">
            <Icon name="close" />
          </button>
        </ItemHeader>

        <div className="item-dialog__bar">
          <div className="item-actions">
            <EquipButtons item={item} />
            <MoveButtons item={item} />
          </div>
          <div className="drawer__actions">
            <LockButton item={item} />
            <button className="button" onClick={() => onAsk(item)}>
              <Icon name="chat" /> Ask about this item
            </button>
            <a className="button button--quiet" href={`https://www.light.gg/db/items/${item.itemHash}/`} target="_blank" rel="noreferrer">
              light.gg <Icon name="openExternal" />
            </a>
          </div>
        </div>

        <div className="tabs" role="tablist" aria-label="Item information">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              id={`item-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`item-panel-${t.id}`}
              className={`tabs__tab${tab === t.id ? ' is-selected' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="item-dialog__body" role="tabpanel" id={`item-panel-${tab}`} aria-labelledby={`item-tab-${tab}`}>
          {tab === 'roll' && (
            <div className="item-dialog__roll">
              <div className="item-dialog__main">
                <ItemFacts item={item} copies={copies.length} />
                {a && (
                  <section className={`verdict verdict--${a.verdict}`}>
                    <VerdictLine item={item} />
                    {a.rollCount > 0 && <p className="verdict__notes">{a.rollCount} curated rolls exist for this weapon.</p>}
                    {a.notes && <p className="verdict__notes">{a.notes}</p>}
                  </section>
                )}
                {item.perks && item.perks.length > 0 && (
                  <section>
                    <h3 className="drawer__section">Perks on this copy</h3>
                    <PerkGrid item={item} showNames />
                    {(a?.wishedPerks?.length ?? 0) > 0 && (
                      <p className="drawer__legend"><span className="perk-cell__wish perk-cell__wish--inline"><Icon name="check" /></span> In a recommended roll</p>
                    )}
                  </section>
                )}
              </div>
              <aside className="item-dialog__side">
                {item.stats && Object.keys(item.stats).length > 0 && (
                  <section>
                    <h3 className="drawer__section">Stats</h3>
                    <StatBars item={item} />
                  </section>
                )}
                {copies.length > 0 && (
                  <section>
                    <h3 className="drawer__section">Other copies you own</h3>
                    <ul className="copies">
                      {copies.map((c, n) => (
                        <li key={c.instanceId ?? n} className="copy">
                          <ItemTile item={c} onSelect={onSelect} />
                          <div className="copy__body">
                            <span className="copy__where">
                              {c.power !== undefined && <strong>{c.power}</strong>} {c.location}{c.equipped ? ' (equipped)' : ''}
                            </span>
                            <VerdictLine item={c} />
                            <PerkGrid item={c} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </aside>
            </div>
          )}
          {tab === 'all' && <AllRolls item={item} />}
          {tab === 'details' && <Details item={item} />}
        </div>
      </div>
    </div>
  );
}

function Details({ item }: { item: AppraisedItem }) {
  const rows: [string, string | number | undefined][] = [
    ['Location', `${item.location}${item.equipped ? ' (equipped)' : ''}`],
    ['Power', item.power],
    ['Element', item.damage],
    ['Champion stun', item.breaker?.name],
    ['Ammo', item.ammo],
    ['Gear tier', item.gearTier],
    ['Masterworked', item.itemType === 2 || item.itemType === 3 ? (item.masterworked ? 'Yes' : 'No') : undefined],
    ['Ornament', item.ornament?.name],
    ['Crafted', item.crafted ? `Yes${item.craftedLevel !== undefined ? `, level ${item.craftedLevel}` : ''}` : undefined],
    ['Locked', item.locked ? 'Yes' : 'No'],
  ];
  return (
    <dl className="details">
      {rows.filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => (
        <div className="details__row" key={k}><dt>{k}</dt><dd>{v}</dd></div>
      ))}
    </dl>
  );
}

/**
 * Every perk the weapon can roll, by column, with its base stats. Perks on this copy are marked:
 * filled when selected, ringed when available to switch to. Hover or focus a perk to read it.
 */
function AllRolls({ item }: { item: AppraisedItem }) {
  const [data, setData] = useState<RollOptions | null>(null);
  const [error, setError] = useState('');
  const [focus, setFocus] = useState<PerkOption | null>(null);
  const touch = useMediaQuery(TOUCH_QUERY);
  useEffect(() => {
    let live = true;
    setData(null);
    setError('');
    fetchRolls(item.itemHash).then((r) => live && setData(r)).catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [item.itemHash]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted"><span className="spinner" /> Loading every roll…</p>;

  const mine = new Map<string, boolean>(); // perk name → selected on this copy
  for (const col of item.perks ?? []) for (const p of col) mine.set(base(p.name), p.active || mine.get(base(p.name)) === true);
  const wished = new Set((item.appraisal?.wishedPerks ?? []).map(base));
  const decorate = (p: PerkOption): PerkOption => ({ ...p, active: mine.get(base(p.name)) === true });

  return (
    <div className="all-rolls">
      <div className="all-rolls__perks">
        {data.intrinsic && (
          <div className="all-rolls__frame">
            {data.intrinsic.icon && <img src={data.intrinsic.icon} alt="" />}
            <span><strong>{data.intrinsic.name}</strong>{data.intrinsic.description && <span className="muted"> · {data.intrinsic.description}</span>}</span>
          </div>
        )}
        <div className="all-rolls__grid" style={{ '--columns': data.columns.length } as React.CSSProperties}>
          {data.columns.map((col, c) => (
            <ul className="all-rolls__column" key={c}>
              {col.map((p) => (
                <PerkCell
                  key={p.name}
                  perk={decorate(p)}
                  wished={wished.has(base(p.name))}
                  className={mine.has(base(p.name)) ? 'is-owned' : undefined}
                  onPoint={setFocus}
                />
              ))}
            </ul>
          ))}
        </div>
        <p className="drawer__legend">
          <span className="legend-swatch legend-swatch--selected" /> On this copy
          <span className="legend-swatch legend-swatch--owned" /> Available on this copy
          <span className="perk-cell__wish perk-cell__wish--inline"><Icon name="check" /></span> In a recommended roll
        </p>
        <div className="all-rolls__focus" aria-live="polite">
          {focus ? (
            <>
              <strong>{focus.name}</strong>
              {focus.description && <p>{focus.description}</p>}
            </>
          ) : <p className="muted">{touch ? 'Tap' : 'Point at'} a perk to read what it does.</p>}
        </div>
      </div>
      <aside className="all-rolls__stats">
        <h3 className="drawer__section">Base stats</h3>
        <p className="muted all-rolls__note">Before perks, mods, and masterwork.</p>
        <StatBars item={item} stats={data.baseStats} />
      </aside>
    </div>
  );
}

/** "Kill Clip Enhanced" and "Kill Clip" are the same choice. */
const base = (name: string) => name.replace(/\s+Enhanced$/i, '');

/** The keyboard-friendly way to move an item: one button per place it could go. */
function MoveButtons({ item }: { item: AppraisedItem }) {
  const inv = useInventory();
  if (!item.movable || item.equipped) return null;
  const busy = !!item.instanceId && inv.moving.has(item.instanceId);
  const places = [...inv.characters.map((c) => ({ id: c.id, label: c.className })), { id: 'vault', label: 'Vault' }];
  const options = places
    .map((p) => ({ ...p, check: inv.check(item, p.id) }))
    .filter((p) => p.check.ok || !p.check.quiet);
  if (options.length === 0) return null;
  return (
    <div className="move-to" role="group" aria-label="Move to">
      <span className="move-to__label">Move to</span>
      {options.map((p) => (
        <button
          key={p.id}
          className="button button--quiet"
          disabled={busy || !p.check.ok}
          title={p.check.ok ? `Move to ${p.label}` : p.check.reason}
          onClick={() => inv.move(item, p.id)}
        >
          {p.label}
        </button>
      ))}
      {busy && <span className="spinner" aria-label="Moving" />}
    </div>
  );
}

/**
 * Equip on a character: one button per character that can wear it. The likeliest one (the
 * character holding it, else the one you played last) is the primary button.
 */
function EquipButtons({ item }: { item: AppraisedItem }) {
  const inv = useInventory();
  if (!item.instanceId) return null;
  const busy = inv.moving.has(item.instanceId);
  const options = inv.characters
    .map((c) => ({ c, check: inv.checkEquip(item, c.id) }))
    // Hide classes that can never wear it; keep reasons that might change (full slot, exotic clash).
    .filter((o) => o.check.ok || (!o.check.quiet && !/^Not usable/.test(o.check.reason)));
  const wornBy = item.equipped ? inv.characters.find((c) => c.id === item.owner) : undefined;
  if (options.length === 0) {
    return wornBy ? <p className="item-actions__state"><Icon name="equip" filled /> Equipped on {wornBy.className}</p> : null;
  }
  const likely = options.find((o) => o.check.ok && o.c.id === item.owner) ?? options.find((o) => o.check.ok);
  return (
    <div className="move-to" role="group" aria-label="Equip on">
      <span className="move-to__label">{wornBy ? `On ${wornBy.className} · equip on` : 'Equip on'}</span>
      {options.map(({ c, check }) => (
        <button
          key={c.id}
          className={`button${c === likely?.c ? ' button--primary' : ''}`}
          disabled={busy || !check.ok}
          title={check.ok ? `Equip on ${c.className}` : check.reason}
          onClick={() => inv.equip(item, c.id)}
        >
          {c === likely?.c && <Icon name="equip" />}{c.className}
        </button>
      ))}
      {busy && <span className="spinner" aria-label="Working" />}
    </div>
  );
}

/** Lock toggle, as in game: a locked item can't be dismantled. */
function LockButton({ item }: { item: AppraisedItem }) {
  const inv = useInventory();
  // Only weapons and armor (and ghosts) lock.
  if (!item.instanceId || (item.itemType !== 2 && item.itemType !== 3 && item.bucket !== 'Ghost')) return null;
  return (
    <button
      className={`button lock-toggle${item.locked ? ' is-locked' : ''}`}
      aria-pressed={item.locked}
      onClick={() => inv.setLocked(item, !item.locked)}
      title={item.locked ? 'Locked: it can\'t be dismantled. Click to unlock.' : 'Lock it so it can\'t be dismantled'}
    >
      <Icon name={item.locked ? 'lock' : 'lockOpen'} filled={item.locked} />
      {item.locked ? 'Locked' : 'Lock'}
    </button>
  );
}
