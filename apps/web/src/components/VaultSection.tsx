import type { ItemRow } from '@triumvirate/core';
import { groupBySlot } from '../inventory.ts';
import { ItemTile } from './ItemTile.tsx';

export function VaultSection({ items, total }: { items: ItemRow[]; total: number }) {
  const groups = groupBySlot(items, true);
  return (
    <section className="vault" aria-label="Vault">
      <h2 className="vault__title">
        Vault <span className="vault__count">{items.length === total ? total : `${items.length} of ${total}`}</span>
      </h2>
      {groups.length === 0 && <p className="empty">Nothing in the vault matches.</p>}
      {groups.map((g) => (
        <div className="vault__group" key={g.slot}>
          <h3 className="vault__slot">
            {g.slot} <span className="vault__count">{g.items.length}</span>
          </h3>
          <div className="grid">
            {g.items.map((i, n) => <ItemTile key={i.instanceId ?? `${i.itemHash}-${n}`} item={i} />)}
          </div>
        </div>
      ))}
    </section>
  );
}
