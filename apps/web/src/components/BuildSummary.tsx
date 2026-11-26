import { useState } from 'react';
import type { ArtifactPerk, CharacterStat, EquippedSubclass, SetBonus, SubclassPartView } from '@triumvirate/core/browser';
import { Icon } from './Icon.tsx';
import { AbilitySheet } from './AbilitySheet.tsx';

type Named = { name: string; icon?: string; description?: string };

/** How the game names each subclass slot, for the ability sheet's eyebrow. */
const SLOT_LABEL: Record<string, string> = {
  supers: 'Super', grenades: 'Grenade', melee: 'Melee', class_abilities: 'Class ability', movement: 'Jump', aspects: 'Aspect', fragments: 'Fragment',
};

/** Subclass slots in the order the game's subclass screen reads: super, abilities, aspects, fragments. */
const ABILITY_SLOTS = ['grenades', 'melee', 'class_abilities', 'movement'] as const;

/**
 * A loadout at a glance: subclass setup (super, abilities, aspects, fragments), stats, armor set
 * bonuses, and artifact perks. Subclass icons open a sheet headed by the part's key art; other icons
 * are buttons that show their name and what they do below the rows, so it works the same on a phone
 * as with a mouse. Armor mods are left out on purpose.
 */
export function BuildSummary({ subclass, stats, sets, artifact, artifactNote, compact }: {
  subclass?: EquippedSubclass;
  /** The character's live stats; shown as the game's glyphs with values. Saved loadouts leave it out. */
  stats?: CharacterStat[];
  sets: SetBonus[];
  artifact?: ArtifactPerk[];
  /** Shown in place of artifact perks when there are none to show, e.g. in-game slots don't save them. */
  artifactNote?: string;
  compact?: boolean;
}) {
  const [focus, setFocus] = useState<Named & { key: string }>();
  const [ability, setAbility] = useState<{ part: SubclassPartView; slot: string }>();
  const point = (key: string, p: Named) => ({
    onClick: () => setFocus((f) => (f?.key === key ? undefined : { key, ...p })),
    'aria-label': p.name,
    title: p.name,
    'aria-pressed': focus?.key === key,
  });
  const glyph = (key: string, p: Named, kind: 'ability' | 'square' | 'fragment' = 'square') => (
    <button key={key} type="button" className={`glance-icon glance-icon--${kind}`} {...point(key, p)}>
      {p.icon ? <img src={p.icon} alt="" /> : <span className="glance-icon__fallback">{p.name.slice(0, 2)}</span>}
    </button>
  );
  const parts = subclass?.parts ?? {};
  const superPart = parts.supers?.[0];
  const abilities = ABILITY_SLOTS.flatMap((s) => (parts[s] ?? []).map((p) => ({ ...p, slot: s })));
  // Subclass parts open their sheet; the sheet has room for the art and the whole description.
  const part = (key: string, p: SubclassPartView, slot: string, kind: 'ability' | 'square' | 'fragment') => (
    <button
      key={key} type="button" className={`glance-icon glance-icon--${kind}`}
      onClick={() => setAbility({ part: p, slot })} aria-label={`${p.name} (${SLOT_LABEL[slot] ?? slot})`} title={p.name} aria-haspopup="dialog"
    >
      {p.icon ? <img src={p.icon} alt="" /> : <span className="glance-icon__fallback">{p.name.slice(0, 2)}</span>}
    </button>
  );
  const element = (subclass?.element || 'none').toLowerCase();
  const activeSets = sets.filter((s) => s.perks.some((p) => p.active));
  // A lone stray piece says nothing useful; show sets with at least one bonus on, else the biggest one.
  const shownSets = activeSets.length ? activeSets : sets.slice(0, 1);

  return (
    <div className={`glance${compact ? ' glance--compact' : ''}`}>
      {subclass && (
        <div className="glance__row">
          <span className="glance__label">Subclass</span>
          <div className={`glance__icons glance--${element}`}>
            {superPart && (
              <button
                type="button" className="glance-super" onClick={() => setAbility({ part: superPart, slot: 'supers' })}
                aria-label={`${superPart.name} (Super)`} title={superPart.name} aria-haspopup="dialog"
              >
                {superPart.icon && <img src={superPart.icon} alt="" />}
              </button>
            )}
            {abilities.length > 0 && <span className="glance__group">{abilities.map((p, n) => part(`ab-${n}`, p, p.slot, 'ability'))}</span>}
            {(parts.aspects?.length ?? 0) > 0 && <span className="glance__group">{parts.aspects!.map((p, n) => part(`as-${n}`, p, 'aspects', 'square'))}</span>}
            {(parts.fragments?.length ?? 0) > 0 && <span className="glance__group">{parts.fragments!.map((p, n) => part(`fr-${n}`, p, 'fragments', 'fragment'))}</span>}
            {!superPart && abilities.length === 0 && <span className="glance__note">{subclass.name}: set it up in game</span>}
          </div>
        </div>
      )}
      {stats && stats.length > 0 && (
        <div className="glance__row">
          <span className="glance__label">Stats</span>
          {/* Glyph and number, as in game; the name is the tooltip and what a screen reader says. */}
          <ul className="glance__stats">
            {stats.map((s) => (
              <li key={s.name} className="glance-stat" title={`${s.name} ${s.value}`}>
                {s.icon ? <img src={s.icon} alt="" /> : <span className="glance-stat__name" aria-hidden>{s.name.slice(0, 3)}</span>}
                <span className="visually-hidden">{s.name}</span>
                <span className="glance-stat__value">{s.value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="glance__row">
        <span className="glance__label">Set bonus</span>
        {shownSets.length === 0 ? <span className="glance__note">None</span> : (
          <ul className="glance__sets">
            {shownSets.map((s) => (
              <li key={s.hash} className="glance-set">
                <span className="glance-set__name">{s.name} <span className="glance-set__count">{s.count}/{Math.max(...s.perks.map((p) => p.count))}</span></span>
                {s.perks.map((p) => (
                  <button
                    key={p.count}
                    type="button"
                    className={`glance-perk${p.active ? ' is-active' : ''}`}
                    {...point(`set-${s.hash}-${p.count}`, { name: `${p.name} (${p.count}-piece${p.active ? '' : `, ${p.count - s.count} more`})`, description: p.description, icon: p.icon })}
                  >
                    <Icon name={p.active ? 'check' : 'lock'} />
                    <span className="glance-perk__count">{p.count}</span>
                    <span className="glance-perk__name">{p.name}</span>
                  </button>
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="glance__row">
        <span className="glance__label">Artifact</span>
        {artifact?.length ? (
          <div className="glance__icons">
            <span className="glance__group">{artifact.map((p) => glyph(`ar-${p.hash}`, p))}</span>
          </div>
        ) : <span className="glance__note">{artifactNote ?? 'None'}</span>}
      </div>
      <p className="glance__focus" aria-live="polite">
        {focus ? <><strong>{focus.name}</strong>{focus.description && <span> · {focus.description}</span>}</> : null}
      </p>
      {ability && subclass && (
        <AbilitySheet part={ability.part} slot={SLOT_LABEL[ability.slot] ?? ability.slot} subclass={subclass} onClose={() => setAbility(undefined)} />
      )}
    </div>
  );
}
