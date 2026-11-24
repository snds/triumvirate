import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchInventory, logout, moveItem, type Inventory } from './api.ts';
import { matches, timeAgo, type Kind } from './inventory.ts';
import type { AppraisedItem } from '@triumvirate/core';
import { checkMove, POSTMASTER_BUCKET } from '@triumvirate/core/browser';
import { DragActionsContext, DragContext, type DragApi } from './drag.ts';
import { CharacterColumn } from './components/CharacterColumn.tsx';
import { VaultSection } from './components/VaultSection.tsx';
import { ItemDetail } from './components/ItemDetail.tsx';
import { CleanupView } from './components/CleanupView.tsx';
import { AgentPanel } from './components/AgentPanel.tsx';
import { ProfileMenu } from './components/ProfileMenu.tsx';
import { Icon } from './components/Icon.tsx';
import { isPostmaster } from './components/CharacterColumn.tsx';
import { SLOT_ORDER } from './inventory.ts';
import { clampChatWidth, CHAT_WIDTH, usePref } from './prefs.ts';
import { HoverContext, type HoverApi } from './hover.ts';
import { InventoryContext, type InventoryApi } from './inventory-context.ts';
import { ItemHovercard } from './components/ItemHovercard.tsx';

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
  const [agentOpen, setAgentOpen] = usePref('chatOpen', true);
  const [collapsed, setCollapsed] = usePref('charactersCollapsed', false);
  const [tileScale, setTileScale] = usePref('tileScale', 1);
  // Kept while the chat is collapsed, so it reopens at the same width.
  const [chatWidth, setChatWidth] = usePref<number>('chatWidth', CHAT_WIDTH.default);
  // Re-clamp when the window shrinks so the panel never crowds out the inventory.
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const [, tick] = useState(0);
  const [hovered, setHovered] = useState<{ item: AppraisedItem; anchor: DOMRect } | null>(null);
  const [ask, setAsk] = useState<{ id: number; text: string }>();

  // Hovercard: a short delay so sweeping the mouse across the grid doesn't flash cards.
  const closeDetail = useCallback(() => setSelected(null), []);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hoverApi = useMemo<HoverApi>(() => ({
    enter: (item, anchor) => {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = setTimeout(() => setHovered({ item, anchor }), 350);
    },
    leave: () => {
      clearTimeout(hoverTimer.current);
      setHovered(null);
    },
  }), []);

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

  // The scale lives on :root because the tile size tokens are computed there.
  useEffect(() => {
    document.documentElement.style.setProperty('--tile-scale', String(tileScale));
  }, [tileScale]);

  // Every copy of each item, so the hovercard and panel can say "2 other copies".
  const byHash = useMemo(() => {
    const m = new Map<number, AppraisedItem[]>();
    if (state.status === 'ready') for (const i of state.inv.items) m.set(i.itemHash, [...(m.get(i.itemHash) ?? []), i]);
    return m;
  }, [state]);
  const copiesOf = useCallback(
    (item: AppraisedItem) => (item.instanceId ? (byHash.get(item.itemHash) ?? []).filter((i) => i.instanceId && i.instanceId !== item.instanceId) : []),
    [byHash],
  );

  // ── Moving items ────────────────────────────────────────────
  const [dragging, setDragging] = useState<AppraisedItem | null>(null);
  const dragActions = useMemo(() => ({ start: setDragging, end: () => setDragging(null) }), []);
  const dragApi = useMemo<DragApi>(() => ({ item: dragging, ...dragActions }), [dragging, dragActions]);
  // Belt and braces: if the browser never sends dragend (it can be lost), the next click or Escape clears it.
  useEffect(() => {
    if (!dragging) return;
    const clear = () => setDragging(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && clear();
    window.addEventListener('pointerdown', clear);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', clear); window.removeEventListener('keydown', onKey); };
  }, [dragging]);
  const [moving, setMoving] = useState<Set<string>>(() => new Set());
  const [toast, setToast] = useState<{ id: number; text: string }>();
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(undefined), 8000);
    return () => clearTimeout(id);
  }, [toast]);

  /** Swaps one item in the loaded inventory (matched by instance id), keeping the item panel in step. */
  const patchItem = useCallback((instanceId: string, next: AppraisedItem, account?: Inventory['account']) => {
    setState((s) => s.status !== 'ready' ? s : {
      ...s,
      inv: { ...s.inv, account: account ?? s.inv.account, items: s.inv.items.map((i) => (i.instanceId === instanceId ? next : i)) },
    });
    setSelected((sel) => (sel?.instanceId === instanceId ? next : sel));
  }, []);

  const move = useCallback(async (item: AppraisedItem, to: string) => {
    if (state.status !== 'ready' || !item.instanceId) return;
    const id = item.instanceId;
    const { inv } = state;
    setMoving((m) => new Set(m).add(id));
    // Show it in place right away; postmaster items wait, since their real slot comes from the server.
    if (item.bucketHash !== POSTMASTER_BUCKET) {
      const ch = inv.characters.find((c) => c.id === to);
      const delta = (to === 'vault' ? 1 : 0) - (item.owner === 'vault' ? 1 : 0);
      patchItem(id, { ...item, owner: to, location: ch ? `${ch.className} (${ch.light})` : 'Vault' },
        inv.account && { ...inv.account, vault: { ...inv.account.vault, used: inv.account.vault.used + delta } });
    }
    const res = await moveItem(id, to);
    // The server's copy is the truth: where it landed, or where it stopped if a step failed.
    patchItem(id, res.item ?? item, res.account);
    if (res.error) setToast({ id: Date.now(), text: `Couldn't move ${item.name}: ${res.error}` });
    setMoving((m) => { const n = new Set(m); n.delete(id); return n; });
  }, [state, patchItem]);

  const inventoryApi = useMemo<InventoryApi>(() => {
    const inv = state.status === 'ready' ? state.inv : undefined;
    return {
      byId: new Map(inv ? inv.items.filter((i) => i.instanceId).map((i) => [i.instanceId!, i]) : []),
      select: setSelected,
      characters: inv?.characters ?? [],
      moving,
      check: (item, to) => (inv ? checkMove(item, to, inv.characters, inv.items, inv.account) : { ok: false, reason: 'Not loaded' }),
      move: (item, to) => void move(item, to),
    };
  }, [state, moving, move]);

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
  // Characters arrive most recently played first; that one stays when the others collapse.
  const [, ...others] = inv.characters;
  const shown = collapsed ? inv.characters.slice(0, 1) : inv.characters;
  const otherIds = new Set(others.map((c) => c.id));
  // Collapsed: the other characters' gear (not their consumables or postmaster) shows in the vault.
  const vaultItems = visible.filter(
    (i) => i.owner === 'vault' || (collapsed && otherIds.has(i.owner) && SLOT_ORDER.includes(i.bucket)),
  );
  const postmasterNotes = collapsed
    ? others
      .map((c) => ({ c, n: inv.items.filter((i) => i.owner === c.id && isPostmaster(i)).length }))
      .filter((x) => x.n > 0)
      .map((x) => `${x.c.className} ${x.n}`)
    : [];
  const signOut = async () => { await logout(); setState({ status: 'signed-out' }); };

  return (
    <HoverContext.Provider value={hoverApi}>
    <InventoryContext.Provider value={inventoryApi}>
    <DragActionsContext.Provider value={dragActions}>
    <DragContext.Provider value={dragApi}>
    <div
      className={`app${agentOpen ? ' app--chat' : ''}`}
      style={{ '--agent-width': `${clampChatWidth(chatWidth, windowWidth)}px` } as React.CSSProperties}
    >
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
          <button
            className={`icon-button${syncing ? ' is-busy' : ''}`}
            onClick={() => void load(true)}
            disabled={syncing}
            aria-label={syncing ? 'Syncing' : 'Refresh from Bungie'}
            title={syncing ? 'Syncing…' : 'Refresh from Bungie'}
          >
            <Icon name="refresh" />
          </button>
          <ProfileMenu
            name={inv.displayName}
            picture={inv.profilePicture}
            synced={timeAgo(inv.syncedAt)}
            tileScale={tileScale}
            onTileScale={setTileScale}
            onSignOut={() => void signOut()}
          />
          <button
            className="icon-button"
            onClick={() => setAgentOpen((o) => !o)}
            aria-pressed={agentOpen}
            aria-label={agentOpen ? 'Collapse chat' : 'Open chat'}
            title={agentOpen ? 'Collapse chat' : 'Open chat'}
          >
            <Icon name="chat" filled={agentOpen} />
          </button>
        </div>
      </header>

      <main className="main" onScroll={hovered ? hoverApi.leave : undefined}>
        {view === 'inventory' ? (
          <div
            className={`inventory${collapsed ? ' inventory--collapsed' : ''}`}
            style={{ '--character-count': shown.length } as React.CSSProperties}
          >
            {shown.map((c) => (
                <CharacterColumn
                  key={c.id}
                  character={c}
                  items={visible.filter((i) => i.owner === c.id && !isPostmaster(i))}
                  postmaster={inv.items.filter((i) => i.owner === c.id && isPostmaster(i))}
                  onSelect={setSelected}
                />
            ))}
            <VaultSection
              items={vaultItems}
              account={inv.account}
              collapsed={collapsed}
              onToggleCollapsed={() => setCollapsed((v) => !v)}
              postmasterNotes={postmasterNotes}
              onSelect={setSelected}
            />
          </div>
        ) : (
          <CleanupView
            cleanup={inv.cleanup.filter((c) => matches(c.item, query, kind))}
            onSelect={setSelected}
          />
        )}
      </main>

      <AgentPanel
        enabled={inv.agentEnabled}
        open={agentOpen}
        ask={ask}
        width={clampChatWidth(chatWidth, windowWidth)}
        onWidth={setChatWidth}
      />
      {selected && (
        <ItemDetail
          item={selected}
          onClose={closeDetail}
          copies={copiesOf(selected)}
          onSelect={setSelected}
          onAsk={(text) => { setAgentOpen(true); setSelected(null); setAsk((a) => ({ id: (a?.id ?? 0) + 1, text })); }}
        />
      )}
      {hovered && !selected && !dragging && <ItemHovercard item={hovered.item} anchor={hovered.anchor} copies={copiesOf(hovered.item).length} />}
      {toast && (
        <div className="toast" role="alert" key={toast.id}>
          <span>{toast.text}</span>
          <button className="icon-button" onClick={() => setToast(undefined)} aria-label="Dismiss" title="Dismiss"><Icon name="close" /></button>
        </div>
      )}
    </div>
    </DragContext.Provider>
    </DragActionsContext.Provider>
    </InventoryContext.Provider>
    </HoverContext.Provider>
  );
}
