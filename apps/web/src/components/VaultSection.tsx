import type { AccountSummary, AppraisedItem } from '@triumvirate/core/browser';
import { groupBySlot, rowOf } from '../inventory.ts';
import { ItemTile } from './ItemTile.tsx';
import { Icon } from './Icon.tsx';
import { useDropZone } from '../drag.ts';
import { useInventory } from '../inventory-context.ts';

interface Props {
  items: AppraisedItem[];
  account?: AccountSummary;
  /** True when other characters are collapsed and their gear is shown here. */
  collapsed: boolean;
  /** Absent on a phone, where the vault is its own page and nothing collapses into it. */
  onToggleCollapsed?: () => void;
  /** Collapsed characters with items waiting at the postmaster. */
  postmasterNotes: string[];
  onSelect: (i: AppraisedItem) => void;
  /** The active character's class, e.g. "Warlock". */
  className?: string;
  /** When on, other classes' armor is hidden. */
  classOnly: boolean;
  onToggleClassOnly: () => void;
}

const fmt = new Intl.NumberFormat('en-US');

export function VaultSection({ items, account, collapsed, onToggleCollapsed, postmasterNotes, onSelect, className, classOnly, onToggleClassOnly }: Props) {
  const { recentMoves } = useInventory();
  const groups = groupBySlot(items, true, recentMoves);
  const drop = useDropZone('vault');
  return (
    <section className={`column vault${drop.className}`} aria-label="Vault" {...drop.props}>
      {drop.note && <p className="drop-note" role="status">{drop.note}</p>}
      <header className="vault__header" style={{ gridRow: rowOf('header') }}>
        {onToggleCollapsed && <button
          className="icon-button"
          onClick={onToggleCollapsed}
          aria-pressed={collapsed}
          title={collapsed ? 'Show all characters' : 'Collapse other characters into the vault'}
          aria-label={collapsed ? 'Show all characters' : 'Collapse other characters into the vault'}
        >
          {/* Points the way the characters will move. */}
          <Icon name={collapsed ? 'chevronsRight' : 'chevronsLeft'} />
        </button>}
        <span className="vault__name">
          <h2 className="vault__title">Vault</h2>
          {account && (
            <span className="vault__count">
              {fmt.format(account.vault.used)}/{fmt.format(account.vault.capacity)}
              {collapsed && ' · includes other characters\' gear'}
            </span>
          )}
        </span>
        {account && account.currencies.length > 0 && (
          <ul className="currencies" aria-label="Currencies">
            {account.currencies.map((c) => (
              <li key={c.name} className="currency" title={c.name}>
                {c.icon && <img src={c.icon} alt="" />}
                <span><span className="visually-hidden">{c.name} </span>{fmt.format(c.quantity)}</span>
              </li>
            ))}
          </ul>
        )}
      </header>
      {/* No wrapper around the rest: each part sits in the shared row grid so slots line up with the characters'. */}
      {(className || postmasterNotes.length > 0 || groups.length === 0) && (
        <div className="vault__top" style={{ gridRow: rowOf('top') }}>
          {className && (
            <div className="vault__filters">
              <button
                className={`chip${classOnly ? ' is-selected' : ''}`}
                aria-pressed={classOnly}
                onClick={onToggleClassOnly}
                title={classOnly ? `Showing armor ${className}s can wear. Click to show every class.` : `Showing every class. Click to show only ${className} armor.`}
              >
                {classOnly && <Icon name="check" />}{className} gear only
              </button>
            </div>
          )}
          {postmasterNotes.length > 0 && <p className="postmaster__note">Postmaster: {postmasterNotes.join(', ')}</p>}
          {groups.length === 0 && <p className="empty">Nothing in the vault matches.</p>}
        </div>
      )}
      {groups.map((g) => (
        <div className="vault__group" key={g.slot} style={{ gridRow: rowOf(g.slot) }}>
          <h3 className="vault__slot">
            {g.slot} <span className="vault__count">{g.items.length}</span>
          </h3>
          <div className="grid">
            {g.items.map((i, n) => <ItemTile key={i.instanceId ?? `${i.itemHash}-${n}`} item={i} onSelect={onSelect} />)}
          </div>
        </div>
      ))}
    </section>
  );
}
