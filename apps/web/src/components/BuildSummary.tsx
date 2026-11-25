import { useState } from 'react';
import type { ArtifactPerk, EquippedSubclass, SetBonus } from '@triumvirate/core/browser';
import { Icon } from './Icon.tsx';

type Named = { name: string; icon?: string; description?: string };

/** Subclass slots in the order the game's subclass screen reads: super, abilities, aspects, fragments. */
const ABILITY_SLOTS = ['grenades', 'melee', 'class_abilities', 'movement'] as const;

/**
 * A loadout at a glance: subclass setup (super, abilities, aspects, fragments), armor set bonuses,
 * and artifact perks. Icons are buttons: tap or press one to read its name and what it does below
 * the row, so it works the same on a phone as with a mouse. Armor mods are left out on purpose.
 */
export function BuildSummary({ subclass, sets, artifact, artifactNote, compact }: {
  subclass?: EquippedSubclass;
  sets: SetBonus[];
  artifact?: ArtifactPerk[];
  /** Shown in place of artifact perks when there are none to show, e.g. in-game slots don't save them. */
  artifactNote?: string;
  compact?: boolean;
}) {
  const [focus, setFocus] = useState<Named & { key: string }>();
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
  const abilities = ABILITY_SLOTS.flatMap((s) => parts[s] ?? []);
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
              <button type="button" className="glance-super" {...point('super', superPart)}>
                {superPart.icon && <img src={superPart.icon} alt="" />}
              </button>
            )}
            {abilities.length > 0 && <span className="glance__group">{abilities.map((p, n) => glyph(`ab-${n}`, p, 'ability'))}</span>}
            {(parts.aspects?.length ?? 0) > 0 && <span className="glance__group">{parts.aspects!.map((p, n) => glyph(`as-${n}`, p))}</span>}
            {(parts.fragments?.length ?? 0) > 0 && <span className="glance__group">{parts.fragments!.map((p, n) => glyph(`fr-${n}`, p, 'fragment'))}</span>}
            {!superPart && abilities.length === 0 && <span className="glance__note">{subclass.name}: set it up in game</span>}
          </div>
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
    </div>
  );
}
