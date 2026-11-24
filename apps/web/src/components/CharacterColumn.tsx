import type { CharacterRow, ItemRow } from '@triumvirate/core';
import { groupBySlot } from '../inventory.ts';
import { ItemTile } from './ItemTile.tsx';

export function CharacterColumn({ character, items }: { character: CharacterRow; items: ItemRow[] }) {
  const groups = groupBySlot(items, false);
  return (
    <section className="column" aria-label={`${character.className} gear`}>
      <header
        className="column__banner"
        style={character.emblemBackground ? { backgroundImage: `url(${character.emblemBackground})` } : undefined}
      >
        <span className="column__class">{character.className}</span>
        <span className="column__light">{character.light}</span>
      </header>
      {groups.map((g) => {
        const equipped = g.items.find((i) => i.equipped);
        const carried = g.items.filter((i) => !i.equipped);
        return (
          <div className="slot" key={g.slot}>
            <div className="slot__equipped">{equipped && <ItemTile item={equipped} size="lg" />}</div>
            <div className="slot__carried">
              {carried.map((i, n) => <ItemTile key={i.instanceId ?? `${i.itemHash}-${n}`} item={i} />)}
            </div>
          </div>
        );
      })}
    </section>
  );
}
