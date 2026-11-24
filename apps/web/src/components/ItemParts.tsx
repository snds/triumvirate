// Pieces shared by the hovercard and the full item panel.
import { STAT_RECOIL_DIRECTION, type AppraisedItem, type PerkOption, type StatDetail } from '@triumvirate/core/browser';
import { VERDICT_LABEL } from './ItemTile.tsx';
import { Icon } from './Icon.tsx';

const WEAPON = 3;

export function itemSummary(item: AppraisedItem) {
  return [item.tier, item.type, item.gearTier && `Tier ${item.gearTier}`].filter(Boolean).join(' · ');
}

/** Older snapshots only have name → value; treat those as having no bonus info. */
function detailsOf(item: AppraisedItem): StatDetail[] {
  if (item.statDetails) return item.statDetails;
  return Object.entries(item.stats ?? {}).map(([name, value]) => ({
    hash: 0, name, value, bonus: 0, numeric: /per minute|magazine|time/i.test(name),
  }));
}

export function StatBars({ item, compact, stats: given }: { item: AppraisedItem; compact?: boolean; stats?: StatDetail[] }) {
  // `stats` overrides the item's own, e.g. the weapon's base stats on the All rolls tab.
  const stats = given ?? detailsOf(item);
  if (stats.length === 0) return null;
  // Armor stats top out far lower than weapon stats.
  const max = item.itemType === WEAPON ? 100 : 45;
  const total = item.itemType === WEAPON ? undefined : stats.reduce((sum, s) => sum + s.value, 0);
  return (
    <dl className={`stats${compact ? ' stats--compact' : ''}`}>
      {stats.map((s) => (
        <div className="stats__row" key={s.name}>
          <dt title={s.name}>{s.name}</dt>
          <dd>
            {s.hash === STAT_RECOIL_DIRECTION ? (
              <RecoilDial value={s.value} />
            ) : !s.numeric && (
              <span className="stats__track" aria-hidden>
                <span className="stats__bar" style={{ width: `${pct(s.value - Math.max(0, s.bonus), max)}%` }} />
                {s.bonus > 0 && <span className="stats__bonus" style={{ width: `${pct(s.bonus, max)}%` }} />}
              </span>
            )}
            <span className={`stats__value${s.bonus > 0 ? ' is-boosted' : s.bonus < 0 ? ' is-reduced' : ''}`}>{s.value}</span>
            {s.bonus !== 0 && !s.numeric && (
              <span className={`stats__delta${s.bonus < 0 ? ' is-reduced' : ''}`}>{s.bonus > 0 ? `+${s.bonus}` : s.bonus}</span>
            )}
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

const pct = (v: number, max: number) => Math.max(0, Math.min(100, (v / max) * 100));

/**
 * Recoil direction as a half dial, the way DIM and light.gg draw it.
 * Bungie's formula: the kick leans left/right by sin((v + 5) · 2π / 20) and spreads more as v drops;
 * values ending in 5 or 0 near 100 kick straight up.
 */
export function RecoilDial({ value }: { value: number }) {
  const lean = Math.sin((value + 5) * ((2 * Math.PI) / 20)) * (100 - value); // degrees off vertical
  const spread = Math.max(4, (100 - value) * 0.6); // half-width of the wedge
  const r = 9;
  const point = (deg: number) => {
    const a = ((deg - 90) * Math.PI) / 180; // 0° = straight up
    return `${10 + r * Math.cos(a)} ${11 + r * Math.sin(a)}`;
  };
  const from = Math.max(-90, lean - spread);
  const to = Math.min(90, lean + spread);
  return (
    <svg className="recoil" viewBox="0 0 20 12" role="img" aria-label={`Recoil direction ${value}`}>
      <path className="recoil__arc" d={`M1 11 A9 9 0 0 1 19 11 Z`} />
      <path className="recoil__wedge" d={`M10 11 L${point(from)} A${r} ${r} 0 0 1 ${point(to)} Z`} />
    </svg>
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

/** Crafted level, kill tracker, and how many other copies you own, as small chips. */
export function ItemFacts({ item, copies }: { item: AppraisedItem; copies: number }) {
  const facts: { icon: Parameters<typeof Icon>[0]['name']; text: string }[] = [];
  if (item.crafted) facts.push({ icon: 'crafted', text: item.craftedLevel !== undefined ? `Crafted · Level ${item.craftedLevel}` : 'Crafted' });
  if (item.killTracker) facts.push({ icon: 'tracker', text: `${item.killTracker.count.toLocaleString('en-US')} ${shortTracker(item.killTracker.label)}` });
  if (item.ornament) facts.push({ icon: 'ornament', text: `${item.ornament.name} ornament` });
  if (copies > 0) facts.push({ icon: 'copies', text: `${copies} other ${copies === 1 ? 'copy' : 'copies'}` });
  if (facts.length === 0) return null;
  return (
    <ul className="facts">
      {facts.map((f) => (
        <li key={f.text} className="fact">
          <Icon name={f.icon} />{f.text}
          {/* The original art, so you can see what the ornament is covering. */}
          {f.icon === 'ornament' && item.baseIcon && (
            <img className="fact__thumb" src={item.baseIcon} alt="Original look" title="Original look" />
          )}
        </li>
      ))}
    </ul>
  );
}

// "Crucible opponents defeated" reads fine; trim only the generic tracker names.
const shortTracker = (label: string) => label.replace(/ tracker$/i, '').toLowerCase() || 'kills';

/** Frame, perk columns, then masterwork and mods. Active perks are filled; perks in a recommended roll get a check. */
export function PerkGrid({ item, showNames }: { item: AppraisedItem; showNames?: boolean }) {
  if (!item.perks || item.perks.length === 0) return null;
  const wished = new Set(item.appraisal?.wishedPerks ?? []);
  return (
    <div className={`perks-block${showNames ? ' perks-block--named' : ''}`}>
      <div className="perk-grid">
        {item.intrinsic && (
          <ul className="perk-grid__column perk-grid__column--intrinsic">
            <PerkCell perk={item.intrinsic} wished={false} showName={showNames} square />
          </ul>
        )}
        {item.perks.map((col, c) => (
          <ul className="perk-grid__column" key={c}>
            {col.map((p) => <PerkCell key={p.name} perk={p} wished={wished.has(p.name)} showName={showNames} />)}
          </ul>
        ))}
      </div>
      {item.mods && item.mods.length > 0 && (
        <ul className="perk-grid__mods">
          {item.mods.map((m) => <PerkCell key={m.name} perk={m} wished={false} showName={showNames} square />)}
        </ul>
      )}
    </div>
  );
}

export function PerkCell({ perk, wished, showName, square, className, onPoint }: {
  perk: PerkOption; wished: boolean; showName?: boolean; square?: boolean;
  className?: string;
  /** Makes the cell focusable and reports when it's pointed at or focused. */
  onPoint?: (perk: PerkOption) => void;
}) {
  const label = [perk.name, perk.enhanced && 'enhanced', perk.active && 'selected', wished && 'in a recommended roll']
    .filter(Boolean).join(' · ');
  return (
    <li
      className={`perk-cell${perk.active ? ' is-active' : ''}${wished ? ' is-wished' : ''}${square ? ' is-square' : ''}${className ? ` ${className}` : ''}`}
      {...(onPoint ? { tabIndex: 0, onMouseEnter: () => onPoint(perk), onFocus: () => onPoint(perk) } : {})}
      title={perk.description ? `${label}\n\n${perk.description}` : label}
    >
      <span className="perk-cell__icon">
        {perk.icon ? <img src={perk.icon} alt="" /> : <span aria-hidden>{perk.name.slice(0, 1)}</span>}
        {perk.enhanced && <span className="perk-cell__enhanced"><Icon name="enhanced" /></span>}
        {wished && <span className="perk-cell__wish"><Icon name="check" /></span>}
      </span>
      {showName ? (
        <span className="perk-cell__text">
          <span className="perk-cell__name">{perk.name}</span>
          {perk.active && perk.description && <span className="perk-cell__desc">{perk.description}</span>}
        </span>
      ) : <span className="visually-hidden">{label}</span>}
    </li>
  );
}

/** Gear tier as diamonds (Tier 3 = three), like the game. Gold when masterworked. */
export function TierDiamonds({ item, className }: { item: AppraisedItem; className?: string }) {
  if (!item.gearTier) return null;
  return (
    <span className={`tier-diamonds${item.masterworked ? ' is-masterworked' : ''} ${className ?? ''}`} aria-label={`Tier ${item.gearTier}`} role="img">
      {Array.from({ length: item.gearTier }, (_, n) => <span key={n} className="tier-diamonds__d" />)}
    </span>
  );
}
