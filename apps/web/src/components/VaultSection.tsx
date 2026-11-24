import type { AccountSummary, AppraisedItem } from '@triumvirate/core/browser';
import { groupBySlot } from '../inventory.ts';
import { ItemTile } from './ItemTile.tsx';
import { Icon } from './Icon.tsx';

interface Props {
  items: AppraisedItem[];
  account?: AccountSummary;
  /** True when other characters are collapsed and their gear is shown here. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Collapsed characters with items waiting at the postmaster. */
  postmasterNotes: string[];
  onSelect: (i: AppraisedItem) => void;
}

const fmt = new Intl.NumberFormat('en-US');

export function VaultSection({ items, account, collapsed, onToggleCollapsed, postmasterNotes, onSelect }: Props) {
  const groups = groupBySlot(items, true);
  return (
    <section className="vault" aria-label="Vault">
      <header className="vault__header">
        <button
          className="icon-button"
          onClick={onToggleCollapsed}
          aria-pressed={collapsed}
          title={collapsed ? 'Show all characters' : 'Collapse other characters into the vault'}
          aria-label={collapsed ? 'Show all characters' : 'Collapse other characters into the vault'}
        >
          <Icon name={collapsed ? 'chevronsRight' : 'chevronsLeft'} />
        </button>
        <h2 className="vault__title">Vault</h2>
        {account && (
          <span className="vault__count">
            {fmt.format(account.vault.used)}/{fmt.format(account.vault.capacity)}
          </span>
        )}
        {collapsed && <span className="vault__count">Includes other characters' gear</span>}
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
      {postmasterNotes.length > 0 && <p className="postmaster__note">Postmaster: {postmasterNotes.join(', ')}</p>}
      {groups.length === 0 && <p className="empty">Nothing in the vault matches.</p>}
      {groups.map((g) => (
        <div className="vault__group" key={g.slot}>
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
