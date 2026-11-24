import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchInventory, logout, type Inventory } from './api.ts';
import { matches, timeAgo, type Kind } from './inventory.ts';
import type { AppraisedItem } from '@triumvirate/core';
import { CharacterColumn } from './components/CharacterColumn.tsx';
import { VaultSection } from './components/VaultSection.tsx';
import { ItemDetail } from './components/ItemDetail.tsx';
import { CleanupView } from './components/CleanupView.tsx';
import { AgentPanel } from './components/AgentPanel.tsx';

type State =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'error'; message: string }
  | { status: 'ready'; inv: Inventory };

const KINDS: { value: Kind; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'weapons', label: 'Weapons' },
  { value: 'armor', label: 'Armor' },
];

export function App() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [syncing, setSyncing] = useState(false);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [view, setView] = useState<'inventory' | 'cleanup'>('inventory');
  const [selected, setSelected] = useState<AppraisedItem | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [, tick] = useState(0);

  const load = useCallback(async (refresh: boolean) => {
    setSyncing(true);
    try {
      const inv = await fetchInventory(refresh);
      setState(inv ? { status: 'ready', inv } : { status: 'signed-out' });
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => { void load(false); }, [load]);
  // Re-render every 30 s so "synced 3 min ago" stays true.
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const visible = useMemo(
    () => (state.status === 'ready' ? state.inv.items.filter((i) => matches(i, query, kind)) : []),
    [state, query, kind],
  );

  if (state.status === 'loading') return <main className="center">Loading your Guardians…</main>;
  if (state.status === 'signed-out') {
    return (
      <main className="center">
        <h1 className="brand">Triumvirate</h1>
        <a className="button button--primary" href="/auth/login">Sign in with Bungie</a>
      </main>
    );
  }
  if (state.status === 'error') {
    return (
      <main className="center">
        <p className="error">Something went wrong: {state.message}</p>
        <button className="button" onClick={() => void load(true)}>Try again</button>
      </main>
    );
  }

  const { inv } = state;
  const vaultTotal = inv.items.filter((i) => i.owner === 'vault').length;
  return (
    <div className="app">
      <header className="topbar">
        <h1 className="brand">Triumvirate</h1>
        <nav className="segmented" aria-label="View">
          <button
            className={`segmented__option${view === 'inventory' ? ' is-selected' : ''}`}
            aria-current={view === 'inventory' ? 'page' : undefined}
            onClick={() => setView('inventory')}
          >
            Inventory
          </button>
          <button
            className={`segmented__option${view === 'cleanup' ? ' is-selected' : ''}`}
            aria-current={view === 'cleanup' ? 'page' : undefined}
            onClick={() => setView('cleanup')}
          >
            Cleanup <span className="muted">{inv.cleanup.length}</span>
          </button>
        </nav>
        <input
          className="search"
          type="search"
          placeholder="Search name, type, element…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search items"
        />
        <div className="segmented" role="radiogroup" aria-label="Item kind">
          {KINDS.map((k) => (
            <button
              key={k.value}
              role="radio"
              aria-checked={kind === k.value}
              className={`segmented__option${kind === k.value ? ' is-selected' : ''}`}
              onClick={() => setKind(k.value)}
            >
              {k.label}
            </button>
          ))}
        </div>
        <div className="topbar__end">
          <span className="muted">{inv.displayName} · synced {timeAgo(inv.syncedAt)}</span>
          <button className="button button--primary" onClick={() => setAgentOpen((o) => !o)}>Ask</button>
          <button className="button" onClick={() => void load(true)} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Refresh'}
          </button>
          <button
            className="button button--quiet"
            onClick={async () => { await logout(); setState({ status: 'signed-out' }); }}
          >
            Sign out
          </button>
        </div>
      </header>

      {view === 'inventory' ? (
        <>
          <div className="columns">
            {inv.characters.map((c) => (
              <CharacterColumn
                key={c.id}
                character={c}
                items={visible.filter((i) => i.owner === c.id)}
                onSelect={setSelected}
              />
            ))}
          </div>
          <VaultSection items={visible.filter((i) => i.owner === 'vault')} total={vaultTotal} onSelect={setSelected} />
        </>
      ) : (
        <CleanupView
          cleanup={inv.cleanup.filter((c) => matches(c.item, query, kind))}
          onSelect={setSelected}
        />
      )}

      {selected && <ItemDetail item={selected} onClose={() => setSelected(null)} />}
      {agentOpen && <AgentPanel enabled={inv.agentEnabled} onClose={() => setAgentOpen(false)} />}
    </div>
  );
}
