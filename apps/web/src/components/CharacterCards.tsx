import { useMemo } from 'react';
import { maxPower, setBonuses, type AppraisedItem, type CharacterRow, type Material, type PowerSlot, MATERIAL_GROUPS } from '@triumvirate/core/browser';
import { useInventory } from '../inventory-context.ts';
import { InfoCard } from '../ui/InfoCard.tsx';
import { Icon } from './Icon.tsx';

const fmt = new Intl.NumberFormat('en-US');

/** "3 of 8" toward the next whole number: the game's own way of showing partial power. */
function partial(total: number) {
  const eighths = Math.round((total - Math.floor(total)) * 8);
  return eighths === 8 ? 0 : eighths;
}

function PowerRows({ title, slots }: { title: string; slots: PowerSlot[] }) {
  return (
    <section className="power-card__group">
      <h4 className="info-card__label">{title}</h4>
      <ul className="power-card__rows">
        {slots.map((s) => (
          <li key={s.bucketHash} className="power-row">
            <span className={`power-row__icon${s.item ? ` tier-${(s.item.tier || 'common').toLowerCase()}` : ''}`}>
              {s.item?.icon && <img src={s.item.icon} alt="" loading="lazy" />}
            </span>
            <span className="power-row__slot">{s.slot}</span>
            <span className="power-row__item">{s.item ? s.item.name : 'Nothing owned'}</span>
            <span className="power-row__value">{s.power || '–'}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The character's power number, which opens a breakdown: the best weapon and armor you own for
 * each slot (one exotic of each), the max power they add up to, and the account's best.
 */
export function PowerBreakdown({ character }: { character: CharacterRow }) {
  const { allItems, characters } = useInventory();
  const power = useMemo(() => maxPower(allItems, character.classType), [allItems, character.classType]);
  const account = useMemo(
    () => Math.max(...characters.map((c) => maxPower(allItems, c.classType).total), 0),
    [allItems, characters],
  );
  const max = Math.floor(power.total);
  const eighths = partial(power.total);
  return (
    <InfoCard
      label={`Power ${character.light}. Show max power breakdown`}
      title="Max power"
      triggerClassName="character__light"
      width={340}
      trigger={<><Icon name="power" filled />{character.light}</>}
    >
      <div className="power-card__head">
        <span className="power-card__max">{max}</span>
        <span className="power-card__sub">
          {eighths ? `${eighths} of 8 toward ${max + 1}` : 'Best gear you own, one exotic weapon and one exotic armor piece'}
          <br />Wearing {character.light} now
        </span>
      </div>
      <PowerRows title="Weapons" slots={power.weapons} />
      <PowerRows title="Armor" slots={power.armor} />
      <p className="power-card__account">
        <span>Account power</span>
        <strong>{Math.floor(account)}</strong>
      </p>
      <p className="info-card__note">Your best character's max. Counts gear in the vault and on other characters, not the postmaster.</p>
    </InfoCard>
  );
}

/**
 * One badge per armor set with at least two pieces equipped. Each opens the perks that are on:
 * the 2-piece perk, plus the 4-piece one with four pieces, and the pieces themselves.
 */
export function SetBadges({ items }: { items: AppraisedItem[] }) {
  const { itemSets, select } = useInventory();
  const sets = useMemo(() => setBonuses(items, itemSets).filter((s) => s.perks.some((p) => p.active)), [items, itemSets]);
  if (!sets.length) return null;
  return (
    <span className="set-badges">
      {sets.map((s) => {
        const active = s.perks.filter((p) => p.active);
        const pieces = items.filter((i) => i.setHash === s.hash);
        const icon = s.icon ?? active[0]?.icon;
        return (
          <InfoCard
            key={s.hash}
            label={`${s.name}: ${active.map((p) => `${p.count}-piece ${p.name}`).join(', ')}`}
            title={s.name}
            triggerClassName="set-badge"
            width={320}
            trigger={<>
              {icon ? <img src={icon} alt="" /> : <Icon name="set" />}
              <span className="set-badge__count">{s.count}</span>
            </>}
          >
            <ul className="set-card__perks">
              {active.map((p) => (
                <li key={p.count} className="set-perk">
                  <span className="set-perk__head">
                    {p.icon ? <img src={p.icon} alt="" /> : <Icon name="set" />}
                    <span className="set-perk__count">{p.count}-piece</span>
                    <strong>{p.name}</strong>
                  </span>
                  {p.description && <p className="set-perk__text">{p.description}</p>}
                </li>
              ))}
            </ul>
            <div className="set-card__pieces" aria-label="Equipped pieces">
              {pieces.map((i) => (
                <button key={i.instanceId} type="button" className={`mini-tile tier-${(i.tier || 'common').toLowerCase()}`} title={i.name} aria-label={i.name} onClick={() => select(i)}>
                  {i.icon && <img src={i.icon} alt="" />}
                </button>
              ))}
            </div>
          </InfoCard>
        );
      })}
    </span>
  );
}

/** The vault header's materials count, which opens every material and consumable with its count, grouped. */
export function MaterialsCard({ materials }: { materials: Material[] }) {
  if (!materials.length) return null;
  const groups = MATERIAL_GROUPS.map((g) => ({ g, list: materials.filter((m) => m.group === g) })).filter((x) => x.list.length);
  return (
    <InfoCard
      label={`Materials and consumables: ${materials.length} kinds`}
      title="Materials and consumables"
      triggerClassName="chip materials-chip"
      width={560}
      trigger={<><Icon name="inventory" /><span>{materials.length} materials</span></>}
    >
      {groups.map(({ g, list }) => (
        <section key={g} className="materials__group">
          <h4 className="info-card__label">{g}</h4>
          <ul className="materials__list">
            {list.map((m) => (
              <li key={m.itemHash} className="material">
                <span className="material__count">{fmt.format(m.quantity)}</span>
                <span className="material__icon">{m.icon && <img src={m.icon} alt="" loading="lazy" />}</span>
                <span className="material__name">{m.name}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </InfoCard>
  );
}
