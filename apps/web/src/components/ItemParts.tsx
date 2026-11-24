// Pieces shared by the hovercard and the full item panel.
import type { AppraisedItem, PerkOption } from '@triumvirate/core/browser';
import { VERDICT_LABEL } from './ItemTile.tsx';

// Weapon stats that are counts or times, not 0-100 ratings, so they get no bar.
const NO_BAR = new Set(['Rounds Per Minute', 'Magazine', 'Charge Time', 'Draw Time', 'Reload Time', 'Recoil Direction', 'Ammo Capacity', 'Swing Speed']);
const WEAPON = 3;

export function itemSummary(item: AppraisedItem) {
  return [item.tier, item.type, item.gearTier && `Tier ${item.gearTier}`].filter(Boolean).join(' · ');
}

export function StatBars({ item, compact }: { item: AppraisedItem; compact?: boolean }) {
  const stats = item.stats ? Object.entries(item.stats) : [];
  if (stats.length === 0) return null;
  // Armor stats top out far lower than weapon stats.
  const max = item.itemType === WEAPON ? 100 : 45;
  const total = item.itemType === WEAPON ? undefined : stats.reduce((sum, [, v]) => sum + v, 0);
  return (
    <dl className={`stats${compact ? ' stats--compact' : ''}`}>
      {stats.map(([name, v]) => (
        <div className="stats__row" key={name}>
          <dt>{name}</dt>
          <dd>
            {!NO_BAR.has(name) && (
              <span className="stats__track"><span className="stats__bar" style={{ width: `${Math.min(100, (v / max) * 100)}%` }} /></span>
            )}
            <span className="stats__value">{v}</span>
          </dd>
        </div>
      ))}
      {total !== undefined && (
        <div className="stats__row stats__row--total">
          <dt>Total</dt>
          <dd><span className="stats__value">{total}</span></dd>
        </div>
      )}
    </dl>
  );
}

export function VerdictLine({ item }: { item: AppraisedItem }) {
  const a = item.appraisal;
  if (!a) return null;
  const modes = [a.pve && 'PvE', a.pvp && 'PvP'].filter(Boolean).join(' and ');
  return (
    <p className={`verdict-line verdict-line--${a.verdict}`}>
      <strong>{VERDICT_LABEL[a.verdict]}</strong>
      {modes && <span> · {modes}</span>}
    </p>
  );
}

/** Perk columns as icons. Active perks are filled; perks in a recommended roll get a marker. */
export function PerkGrid({ item, showNames }: { item: AppraisedItem; showNames?: boolean }) {
  if (!item.perks || item.perks.length === 0) return null;
  const wished = new Set(item.appraisal?.wishedPerks ?? []);
  return (
    <div className={`perk-grid${showNames ? ' perk-grid--named' : ''}`}>
      {item.perks.map((col, c) => (
        <ul className="perk-grid__column" key={c}>
          {col.map((p) => <PerkCell key={p.name} perk={p} wished={wished.has(p.name)} showName={showNames} />)}
        </ul>
      ))}
    </div>
  );
}

function PerkCell({ perk, wished, showName }: { perk: PerkOption; wished: boolean; showName?: boolean }) {
  const label = `${perk.name}${perk.active ? ' (selected)' : ''}${wished ? ' · in a recommended roll' : ''}`;
  return (
    <li className={`perk-cell${perk.active ? ' is-active' : ''}${wished ? ' is-wished' : ''}`} title={label}>
      <span className="perk-cell__icon">
        {perk.icon ? <img src={perk.icon} alt="" /> : <span aria-hidden>{perk.name.slice(0, 1)}</span>}
        {wished && <span className="perk-cell__wish" aria-hidden>✓</span>}
      </span>
      {showName ? <span className="perk-cell__name">{perk.name}</span> : <span className="visually-hidden">{label}</span>}
    </li>
  );
}
