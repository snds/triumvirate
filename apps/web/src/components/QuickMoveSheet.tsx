import type { AppraisedItem } from '@triumvirate/core/browser';
import { useInventory } from '../inventory-context.ts';
import { Sheet } from './Sheet.tsx';
import { ItemTile } from './ItemTile.tsx';
import { Icon } from './Icon.tsx';
import { EquipButtons, LockButton } from './ItemDetail.tsx';

/**
 * The touch way to move an item, since drag is mouse-only. Long-press a tile (or right-click it)
 * and this rises from the bottom: one big target per place it can go, laid out like the store
 * tabs above the inventory, so "move to Titan" is the same tap as "show Titan". A move closes the
 * sheet and you stay on the tab you were on.
 */
export function QuickMoveSheet({ item, onClose, onDetails }: {
  item: AppraisedItem; onClose: () => void; onDetails: (i: AppraisedItem) => void;
}) {
  const inv = useInventory();
  const busy = !!item.instanceId && inv.moving.has(item.instanceId);
  const places = [
    ...inv.characters.map((c) => ({ id: c.id, label: c.className, meta: String(c.light), power: true, emblem: c.emblemBackground })),
    { id: 'vault', label: 'Vault', meta: '', power: false, emblem: undefined },
  ].map((p) => ({ ...p, here: item.owner === p.id, check: inv.check(item, p.id) }));
  const canMove = !!item.movable && !item.equipped;
  // The first reason a place is blocked, so a greyed button never goes unexplained.
  const blocked = places.find((p) => !p.here && !p.check.ok && !p.check.quiet);
  const where = places.find((p) => p.here)?.label ?? item.location;

  return (
    <Sheet
      title={item.name}
      onClose={onClose}
      className="quick-move"
      footer={(
        <button className="button button--quiet" onClick={() => { onClose(); onDetails(item); }}>
          <Icon name="info" />Full details
        </button>
      )}
    >
      <div className="quick-move__item">
        <ItemTile item={item} />
        <p className="quick-move__meta">
          <span>{[item.type, item.power && `${item.power}`].filter(Boolean).join(' · ')}</span>
          <span className="muted">{item.equipped ? `Equipped on ${where}` : `In ${where}`}</span>
        </p>
      </div>
      {canMove && (
        <section className="quick-move__section" aria-label="Move to">
          <h3 className="quick-move__label">Move to</h3>
          <div className="quick-move__places">
            {places.map((p) => (
              <button
                key={p.id}
                className={`store-switcher__tab quick-move__place${p.id === 'vault' ? ' store-switcher__tab--vault' : ''}${p.here ? ' is-selected' : ''}`}
                disabled={busy || p.here || !p.check.ok}
                aria-current={p.here || undefined}
                title={p.here ? 'It\'s here' : p.check.ok ? `Move to ${p.label}` : p.check.reason}
                onClick={() => { inv.move(item, p.id); onClose(); }}
              >
                {p.id === 'vault'
                  ? <span className="store-switcher__emblem store-switcher__emblem--vault" aria-hidden><Icon name="vault" /></span>
                  : <span className="store-switcher__emblem" style={p.emblem ? { backgroundImage: `url(${p.emblem})` } : undefined} aria-hidden />}
                <span className="store-switcher__text">
                  <span className="store-switcher__name">{p.label}</span>
                  <span className="store-switcher__meta">
                    {p.here ? 'Here' : <>{p.power && <Icon name="power" filled />}{p.meta}</>}
                  </span>
                </span>
              </button>
            ))}
          </div>
          {blocked && <p className="quick-move__note">{blocked.label}: {blocked.check.ok ? '' : blocked.check.reason}</p>}
        </section>
      )}
      {item.equipped && <p className="quick-move__note">Equipped items can't move. Equip something else in that slot first.</p>}
      <div className="quick-move__actions">
        <EquipButtons item={item} />
        <LockButton item={item} />
      </div>
    </Sheet>
  );
}
