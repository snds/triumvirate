import type { AppraisedItem } from '@triumvirate/core/browser';
import { useInventory } from '../inventory-context.ts';
import { ItemTile } from './ItemTile.tsx';
import { Icon } from './Icon.tsx';

interface Part { name: string; icon?: string; description?: string }
export interface Build {
  name?: string; class?: string; subclass?: string; tags?: string[]; summary?: string;
  super?: Part; abilities?: Record<string, Part | undefined>; aspects?: Part[]; fragments?: Part[];
  weapons?: { id: string; note?: string }[]; armor?: { id: string; note?: string }[];
  statPriority?: { name: string; icon?: string }[]; mods?: string[]; howToPlay?: string;
}

const ABILITY_ORDER: [string, string][] = [['class', 'Class'], ['movement', 'Jump'], ['melee', 'Melee'], ['grenade', 'Grenade']];
// Armor order in the game: helmet, arms, chest, legs, class item.
const ARMOR_ORDER = ['Helmet', 'Gauntlets', 'Chest Armor', 'Leg Armor', 'Class Armor'];

/** A build laid out like a build site: subclass, gear, stat priority, then how to play it. */
export function BuildCard({ build }: { build: Build }) {
  const { byId, select } = useInventory();
  const resolve = (list?: { id: string; note?: string }[]) =>
    (list ?? []).map((x) => ({ ...x, item: byId.get(x.id) })).filter((x): x is { id: string; note?: string; item: AppraisedItem } => !!x.item);
  const weapons = resolve(build.weapons);
  const armor = resolve(build.armor).sort((a, b) => ARMOR_ORDER.indexOf(a.item.bucket) - ARMOR_ORDER.indexOf(b.item.bucket));
  const abilities = ABILITY_ORDER.map(([k, label]) => ({ label, part: build.abilities?.[k] })).filter((a) => a.part);
  const element = build.subclass?.toLowerCase();

  return (
    <article className={`build${element ? ` build--${element}` : ''}`}>
      <header className="build__header">
        <span className="build__eyebrow">{[build.class, build.subclass].filter(Boolean).join(' · ')} build</span>
        <h3 className="build__name">{build.name ?? 'Suggested build'}</h3>
        {build.tags && build.tags.length > 0 && (
          <ul className="build__tags">{build.tags.map((t) => <li key={t}>{t}</li>)}</ul>
        )}
        {build.summary && <p className="build__summary">{build.summary}</p>}
      </header>

      {(build.super || abilities.length > 0 || build.aspects?.length || build.fragments?.length) && (
        <section className="build__section">
          <h4 className="build__label">Subclass</h4>
          <div className="build__subclass">
            {build.super && <PartGroup title="Super" parts={[build.super]} large />}
            {abilities.length > 0 && <PartGroup title="Abilities" parts={abilities.map((a) => a.part!)} captions={abilities.map((a) => a.label)} />}
            {build.aspects && build.aspects.length > 0 && <PartGroup title="Aspects" parts={build.aspects} />}
          </div>
          {build.fragments && build.fragments.length > 0 && <PartGroup title="Fragments" parts={build.fragments} />}
        </section>
      )}

      {(weapons.length > 0 || armor.length > 0) && (
        <section className="build__section">
          <h4 className="build__label">Gear</h4>
          {weapons.length > 0 && <GearList title="Weapons" rows={weapons} onSelect={select} />}
          {armor.length > 0 && <GearList title="Armor" rows={armor} onSelect={select} />}
        </section>
      )}

      {build.statPriority && build.statPriority.length > 0 && (
        <section className="build__section">
          <h4 className="build__label">Stat priority</h4>
          <ol className="build__stats">
            {build.statPriority.map((s, n) => (
              <li key={s.name} className="build__stat">
                {n > 0 && <Icon name="arrowRight" className="build__arrow" />}
                <span className="build__stat-chip" title={s.name}>
                  {s.icon && <img src={s.icon} alt="" />}
                  {s.name}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {build.mods && build.mods.length > 0 && (
        <section className="build__section">
          <h4 className="build__label">Mods</h4>
          <ul className="build__mods">{build.mods.map((m) => <li key={m}>{m}</li>)}</ul>
        </section>
      )}

      {build.howToPlay && (
        <section className="build__section">
          <h4 className="build__label">How to play it</h4>
          <p className="build__text">{build.howToPlay}</p>
        </section>
      )}
    </article>
  );
}

function PartGroup({ title, parts, captions, large }: { title: string; parts: Part[]; captions?: string[]; large?: boolean }) {
  return (
    <div className="build__group">
      <span className="build__group-title">{title}</span>
      <ul className="build__parts">
        {parts.map((p, n) => (
          <li key={`${p.name}-${n}`} className={`build__part${large ? ' build__part--large' : ''}`} title={p.description ? `${p.name}\n\n${p.description}` : p.name}>
            {p.icon ? <img src={p.icon} alt={p.name} /> : <span className="build__part-fallback">{p.name}</span>}
            {captions && <span className="build__caption">{captions[n]}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function GearList({ title, rows, onSelect }: { title: string; rows: { item: AppraisedItem; note?: string }[]; onSelect: (i: AppraisedItem) => void }) {
  return (
    <div className="build__gear">
      <span className="build__group-title">{title}</span>
      <ul>
        {rows.map(({ item, note }) => (
          <li key={item.instanceId} className="build__gear-row">
            <ItemTile item={item} onSelect={onSelect} />
            <div>
              <span className="build__gear-name">{item.name}</span>
              <span className="build__gear-meta">{[item.tier, item.type].filter(Boolean).join(' ')} · {item.location}</span>
              {note && <p className="build__note">{note}</p>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
