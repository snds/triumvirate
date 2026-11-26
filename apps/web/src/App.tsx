import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { equipItem, fetchDigest, fetchInventory, logout, moveItem, setLocked, type ActionResult, type Inventory } from './api.ts';
import { matches, timeAgo, type Kind } from './inventory.ts';
import type { AppraisedItem } from '@triumvirate/core';
import { checkEquip, checkMove, POSTMASTER_BUCKET } from '@triumvirate/core/browser';
import { DragActionsContext, DragContext, useItemDrag } from './drag.ts';
import { CharacterColumn } from './components/CharacterColumn.tsx';
import { VaultSection } from './components/VaultSection.tsx';
import { ItemDetail } from './components/ItemDetail.tsx';
import { QuickMoveSheet } from './components/QuickMoveSheet.tsx';
import { CleanupView } from './components/CleanupView.tsx';
import { RollsView } from './components/RollsView.tsx';
import { LoadoutsView } from './components/LoadoutsView.tsx';
import { AgentPanel, type ChatStatus } from './components/AgentPanel.tsx';
import { ProfileMenu } from './components/ProfileMenu.tsx';
import { DigestSheet } from './components/DigestSheet.tsx';
import { SeasonSheet } from './components/SeasonSheet.tsx';
import { WatchListSheet } from './components/WatchSheet.tsx';
import { Icon } from './components/Icon.tsx';
import { isPostmaster } from './inventory.ts';
import { INVENTORY_ROWS, planBulkMove, SLOT_ORDER } from './inventory.ts';
import { SelectBar } from './components/SelectBar.tsx';
import { clampChatWidth, CHAT_WIDTH, usePref } from './prefs.ts';
import { HoverContext, type HoverApi } from './hover.ts';
import { InventoryContext, type InventoryApi } from './inventory-context.ts';
import { ItemHovercard } from './components/ItemHovercard.tsx';
import { StoreSwitcher } from './components/StoreSwitcher.tsx';
import { TabBar, type View } from './components/TabBar.tsx';
import { useCompact } from './media.ts';

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
  const [view, setView] = useState<View>('inventory');
  // Phones show one store (a character or the vault) at a time; this is the one on screen.
  const compact = useCompact();
  const [store, setStore] = usePref<string>('phoneStore', '');
  const [selected, setSelected] = useState<AppraisedItem | null>(null);
  /** Instance id of the item in the quick-move sheet; looked up live so it shows moves as they land. */
  const [quickId, setQuickId] = useState<string>();
  /** Phone select mode: tap tiles to pick them, then move them all at once from the bar below. */
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  /** Bulk move progress, while one is running. */
  const [bulk, setBulk] = useState<{ done: number; total: number; to: string }>();
  // Always starts closed; the chat button shows when a conversation is going.
  const [agentOpen, setAgentOpen] = useState(false);
  const [chatStatus, setChatStatus] = useState<ChatStatus>({ active: false, busy: false, unread: 0 });
  // Daily digest: the newest one's date, and the last one you opened (for the button's dot).
  const [digestOpen, setDigestOpen] = useState(false);
  const [seasonOpen, setSeasonOpen] = useState(false);
  const [watchOpen, setWatchOpen] = useState(false);
  const [latestDigest, setLatestDigest] = useState('');
  const [seenDigest, setSeenDigest] = usePref('digestSeen', '');
  // Tapping the morning alert opens the digest: as ?open=digest on a fresh launch, or as a
  // message from the service worker when the app was already open in the background.
  useEffect(() => {
    const url = new URL(location.href);
    const view = url.searchParams.get('open');
    if (view === 'digest' || view === 'watch') {
      (view === 'digest' ? setDigestOpen : setWatchOpen)(true);
      url.searchParams.delete('open');
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    }
    const onMessage = (e: MessageEvent<{ type?: string; view?: string }>) => {
      if (e.data?.type === 'open' && e.data.view === 'digest') setDigestOpen(true);
      if (e.data?.type === 'open' && e.data.view === 'watch') setWatchOpen(true);
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
  }, []);
  const syncedAt = state.status === 'ready' ? state.inv.syncedAt : '';
  useEffect(() => {
    if (!syncedAt) return;
    fetchDigest().then((r) => setLatestDigest(r.digest?.date ?? ''), () => {});
  }, [syncedAt]);
  const [collapsed, setCollapsed] = usePref('charactersCollapsed', false);
  const [classOnly, setClassOnly] = usePref('vaultClassOnly', true);
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

  // Hovercard: a short delay so sweeping the mouse across the grid doesn't flash cards.
  const closeDetail = useCallback(() => setSelected(null), []);
  // "Ask about this item" hands the chat an item; `id` changes on each ask so asking again starts fresh.
  const [about, setAbout] = useState<{ id: number; item: AppraisedItem }>();
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
  // Quiet auto refresh: only while the tab is visible and nothing is being dragged or moved.
  // A failure is skipped silently; the next tick (or the button) tries again.
  const [autoRefresh, setAutoRefresh] = usePref<number>('autoRefresh', 0);
  const quietBusy = useRef(false);
  const autoRef = useRef({ state, dragging: false, moving: 0 });
  useEffect(() => {
    if (!autoRefresh) return;
    const due = () => {
      const { state: s, dragging: d, moving: m } = autoRef.current;
      if (s.status !== 'ready' || d || m > 0 || quietBusy.current || document.visibilityState !== 'visible') return false;
      return Date.now() - Date.parse(s.inv.syncedAt) >= autoRefresh * 60_000;
    };
    const run = async () => {
      if (!due()) return;
      quietBusy.current = true;
      setSyncing(true);
      try {
        const inv = await fetchInventory(true);
        if (inv && autoRef.current.moving === 0 && !autoRef.current.dragging) {
          setState({ status: 'ready', inv });
          // Keep an open item panel pointed at the fresh copy of the same item.
          setSelected((sel) => (sel?.instanceId ? inv.items.find((i) => i.instanceId === sel.instanceId) ?? sel : sel));
        }
      } catch { /* try again next time */ } finally {
        quietBusy.current = false;
        setSyncing(false);
      }
    };
    const id = setInterval(() => void run(), 15_000);
    // Coming back to the tab catches up straight away if a refresh is overdue.
    const onVisible = () => void run();
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [autoRefresh]);

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

  const [moving, setMoving] = useState<Set<string>>(() => new Set());
  // Remembered across reloads so a raid shuffle stays at the front; only the last 60 moves are kept.
  const [recentMoves, setRecentMoves] = usePref<Record<string, number>>('recentMoves', {});
  const [toast, setToast] = useState<{ id: number; text: string; ok?: boolean }>();
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

  /** Swaps several items at once (an equip moves one in and one out), keeping the item panel in step. */
  const patchItems = useCallback((next: AppraisedItem[], account?: Inventory['account']) => {
    if (next.length === 0 && !account) return;
    const byId = new Map(next.map((i) => [i.instanceId, i]));
    setState((s) => s.status !== 'ready' ? s : {
      ...s,
      inv: { ...s.inv, account: account ?? s.inv.account, items: s.inv.items.map((i) => (i.instanceId && byId.get(i.instanceId)) || i) },
    });
    setSelected((sel) => (sel?.instanceId && byId.get(sel.instanceId)) || sel);
  }, []);

  /** Shows what an equip or loadout did: patches the items and says what didn't go on. */
  const settle = useCallback((res: ActionResult, what: string) => {
    patchItems(res.items ?? [], res.account);
    const skipped = res.skipped ?? [];
    if (res.error) setToast({ id: Date.now(), text: `Couldn't ${what}: ${res.error}` });
    else if (skipped.length) setToast({ id: Date.now(), text: `${skipped.length === 1 ? `${skipped[0]!.name ?? 'One item'} stayed put` : `${skipped.length} items stayed put`}: ${skipped[0]!.reason}` });
  }, [patchItems]);

  /** Scrolls a moved item into view and makes it glow briefly, so it's easy to find in a long vault. */
  const spotlight = useCallback((id: string) => {
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`.main [data-instance="${CSS.escape(id)}"]`);
      if (!el) return;
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      // A data attribute, not a class: React rewrites className when the tile re-renders.
      delete el.dataset.justMoved;
      void el.offsetWidth; // restart the animation if it's already running
      el.dataset.justMoved = '';
      setTimeout(() => { delete el.dataset.justMoved; }, 2400);
    });
  }, []);

  /** `quiet` skips the scroll-and-glow, for bulk moves that would otherwise jump around. */
  const move = useCallback(async (item: AppraisedItem, to: string, quiet = false) => {
    if (state.status !== 'ready' || !item.instanceId) return;
    const id = item.instanceId;
    const { inv } = state;
    setMoving((m) => new Set(m).add(id));
    setRecentMoves((r) => Object.fromEntries([...Object.entries({ ...r, [id]: Date.now() })].sort((a, b) => b[1] - a[1]).slice(0, 60)));
    // Show it in place right away; postmaster items wait, since their real slot comes from the server.
    if (item.bucketHash !== POSTMASTER_BUCKET) {
      const ch = inv.characters.find((c) => c.id === to);
      const delta = (to === 'vault' ? 1 : 0) - (item.owner === 'vault' ? 1 : 0);
      patchItem(id, { ...item, owner: to, location: ch ? `${ch.className} (${ch.light})` : 'Vault' },
        inv.account && { ...inv.account, vault: { ...inv.account.vault, used: inv.account.vault.used + delta } });
    }
    if (!quiet) spotlight(id);
    const res = await moveItem(id, to);
    // The server's copy is the truth: where it landed, or where it stopped if a step failed.
    patchItem(id, res.item ?? item, res.account);
    if (!quiet) spotlight(id);
    if (res.error) setToast({ id: Date.now(), text: `Couldn't move ${item.name}: ${res.error}` });
    setMoving((m) => { const n = new Set(m); n.delete(id); return n; });
  }, [state, patchItem, spotlight, setRecentMoves]);

  const equip = useCallback(async (item: AppraisedItem, characterId: string) => {
    if (!item.instanceId) return;
    const id = item.instanceId;
    setMoving((m) => new Set(m).add(id));
    const res = await equipItem(id, characterId);
    settle(res, `equip ${item.name}`);
    spotlight(id);
    setMoving((m) => { const n = new Set(m); n.delete(id); return n; });
  }, [settle, spotlight]);

  const lock = useCallback(async (item: AppraisedItem, locked: boolean) => {
    if (!item.instanceId) return;
    const id = item.instanceId;
    // Locks are instant in game, so show it right away and undo if Bungie says no.
    patchItem(id, { ...item, locked });
    const res = await setLocked(id, locked);
    patchItem(id, res.item ?? (res.error ? item : { ...item, locked }));
    if (res.error) setToast({ id: Date.now(), text: `Couldn't ${locked ? 'lock' : 'unlock'} ${item.name}: ${res.error}` });
  }, [patchItem]);

  const inventoryApi = useMemo<InventoryApi>(() => {
    const inv = state.status === 'ready' ? state.inv : undefined;
    return {
      byId: new Map(inv ? inv.items.filter((i) => i.instanceId).map((i) => [i.instanceId!, i]) : []),
      select: setSelected,
      characters: inv?.characters ?? [],
      moving,
      check: (item, to) => (inv ? checkMove(item, to, inv.characters, inv.items, inv.account) : { ok: false, reason: 'Not loaded' }),
      move: (item, to) => void move(item, to),
      recentMoves,
      checkEquip: (item, characterId) => (inv ? checkEquip(item, characterId, inv.characters) : { ok: false, reason: 'Not loaded' }),
      equip: (item, characterId) => void equip(item, characterId),
      setLocked: (item, locked) => void lock(item, locked),
      quick: (item) => { if (item.instanceId) setQuickId(item.instanceId); },
      selection: { active: selecting, ids: picked },
      pick: (item) => {
        if (!item.instanceId) return;
        const id = item.instanceId;
        setSelecting(true);
        setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
      },
    };
  }, [state, moving, move, recentMoves, equip, lock, selecting, picked]);

  // Bulk moves go one at a time through the latest `move`, so each sees where the last one landed.
  const moveRef = useRef(move);
  moveRef.current = move;
  const endSelect = useCallback(() => { setSelecting(false); setPicked(new Set()); }, []);
  // Select mode belongs to the phone inventory; leaving it (or widening the window) ends it.
  useEffect(() => { if (!compact || view !== 'inventory') endSelect(); }, [compact, view, endSelect]);
  const moveAll = useCallback(async (to: string) => {
    if (state.status !== 'ready') return;
    const { inv } = state;
    const chosen = inv.items.filter((i) => i.instanceId && picked.has(i.instanceId));
    const plan = planBulkMove(chosen, to, inv.items, inv.account, (i, dest, items, account) => checkMove(i, dest, inv.characters, items, account));
    const place = to === 'vault' ? 'the vault' : inv.characters.find((c) => c.id === to)?.className ?? 'there';
    setBulk({ done: 0, total: plan.go.length, to });
    for (const [n, item] of plan.go.entries()) {
      await moveRef.current(item, to, true);
      setBulk({ done: n + 1, total: plan.go.length, to });
    }
    setBulk(undefined);
    endSelect();
    const first = plan.skip[0];
    const moved = `Moved ${plan.go.length} ${plan.go.length === 1 ? 'item' : 'items'} to ${place}`;
    setToast({ id: Date.now(), ok: !first, text: first ? `${moved}. ${plan.skip.length} stayed put: ${first.reason}${plan.skip.length > 1 ? ' and more' : ''}.` : `${moved}.` });
  }, [state, picked, endSelect]);
  // Dropping re-checks the move, so a drop on a red column does nothing.
  const drag = useItemDrag((item, to) => {
    if (inventoryApi.check(item, to).ok) inventoryApi.move(item, to);
  });
  const dragging = drag.state;
  autoRef.current = { state, dragging: !!dragging, moving: moving.size };

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
  // On a phone the vault is its own page, so nothing collapses into it.
  const isCollapsed = collapsed && !compact;
  const phoneStore = store === 'vault' || inv.characters.some((c) => c.id === store) ? store : inv.characters[0]?.id ?? 'vault';
  const shown = compact
    ? inv.characters.filter((c) => c.id === phoneStore)
    : isCollapsed ? inv.characters.slice(0, 1) : inv.characters;
  const showVault = !compact || phoneStore === 'vault';
  const otherIds = new Set(others.map((c) => c.id));
  // Collapsed: the other characters' gear (not their consumables or postmaster) shows in the vault.
  // The active class is whoever you played last; other classes' armor is hidden unless you turn the filter off.
  const activeClass = inv.characters[0];
  const vaultItems = visible.filter(
    (i) => (i.owner === 'vault' || (isCollapsed && otherIds.has(i.owner) && SLOT_ORDER.includes(i.bucket)))
      && (!classOnly || !activeClass || i.classType === 3 || i.classType === activeClass.classType),
  );
  const postmasterNotes = isCollapsed
    ? others
      .map((c) => ({ c, n: inv.items.filter((i) => i.owner === c.id && isPostmaster(i)).length }))
      .filter((x) => x.n > 0)
      .map((x) => `${x.c.className} ${x.n}`)
    : [];
  const signOut = async () => { await logout(); setState({ status: 'signed-out' }); };

  return (
    <HoverContext.Provider value={hoverApi}>
    <InventoryContext.Provider value={inventoryApi}>
    <DragActionsContext.Provider value={drag.actions}>
    <DragContext.Provider value={drag.state}>
    <div
      className={`app${agentOpen ? ' app--chat' : ''}${compact ? ' app--compact' : ''}`}
      style={{ '--agent-width': `${clampChatWidth(chatWidth, windowWidth)}px` } as React.CSSProperties}
    >
      <header className="topbar">
        <h1 className="brand">Triumvirate</h1>
        {/* On a phone the views move to the tab bar at the bottom, in thumb reach. */}
        {!compact && <nav className="segmented" aria-label="View">
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
          <button
            className={`segmented__option${view === 'rolls' ? ' is-selected' : ''}`}
            aria-current={view === 'rolls' ? 'page' : undefined}
            onClick={() => setView('rolls')}
          >
            Rolls
          </button>
          <button
            className={`segmented__option${view === 'loadouts' ? ' is-selected' : ''}`}
            aria-current={view === 'loadouts' ? 'page' : undefined}
            onClick={() => setView('loadouts')}
          >
            Loadouts
          </button>
        </nav>}
        {!compact && <><input
          className="search"
          type="search"
          placeholder="Search name, type, element…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search items"
        />
        <div className="segmented topbar__kind" role="radiogroup" aria-label="Item kind">
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
        </div></>}
        <div className="topbar__end">
          {compact && view === 'inventory' && (
            <button
              className={`icon-button${selecting ? ' is-active' : ''}`}
              onClick={() => (selecting ? endSelect() : setSelecting(true))}
              aria-pressed={selecting}
              aria-label={selecting ? 'Stop selecting' : 'Select items to move'}
              title={selecting ? 'Stop selecting' : 'Select items to move'}
            >
              <Icon name="select" />
            </button>
          )}
          <button className="icon-button" onClick={() => setSeasonOpen(true)} aria-label="Season progress" title="Season progress">
            <Icon name="season" />
          </button>
          <button
            className="icon-button topbar__digest"
            onClick={() => setDigestOpen(true)}
            aria-label={latestDigest && latestDigest !== seenDigest ? 'Daily digest, new' : 'Daily digest'}
            title="Daily digest"
          >
            <Icon name="today" />
            {latestDigest && latestDigest !== seenDigest && <span className="topbar__dot" aria-hidden />}
          </button>
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
            autoRefresh={autoRefresh}
            onAutoRefresh={setAutoRefresh}
            compact={compact}
          />
        </div>
      </header>

      <main className={`main${selecting && compact ? ' main--selecting' : ''}`} onScroll={hovered ? hoverApi.leave : undefined}>
        {view === 'inventory' ? (
          <>
          {compact && (
            <StoreSwitcher
              characters={inv.characters}
              vaultCount={inv.account?.vault.used}
              value={phoneStore}
              onChange={setStore}
            />
          )}
          <div
            className={`inventory${isCollapsed ? ' inventory--collapsed' : ''}`}
            style={{ '--character-count': shown.length, '--inventory-rows': INVENTORY_ROWS.length } as React.CSSProperties}
            {...(compact ? { role: 'tabpanel', id: 'store-panel' } : {})}
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
            {showVault && <VaultSection
              items={vaultItems}
              account={inv.account}
              collapsed={isCollapsed}
              onToggleCollapsed={compact ? undefined : () => setCollapsed((v) => !v)}
              postmasterNotes={postmasterNotes}
              className={activeClass?.className}
              classOnly={classOnly}
              onToggleClassOnly={() => setClassOnly((v) => !v)}
              onSelect={setSelected}
            />}
          </div>
          </>
        ) : view === 'loadouts' ? (
          <LoadoutsView
            inv={inv}
            characterId={inv.characters.some((c) => c.id === store) ? store : inv.characters[0]?.id ?? ''}
            onCharacter={setStore}
            onSelect={setSelected}
            onSettle={settle}
            onReload={() => load(false)}
            onToast={(text) => setToast({ id: Date.now(), text })}
          />
        ) : view === 'rolls' ? (
          <RollsView items={visible} syncedAt={inv.syncedAt} activeClass={inv.characters[0]?.className} onSelect={setSelected} onChanged={() => void load(false)} onWatchList={() => setWatchOpen(true)} />
        ) : (
          <CleanupView
            characters={inv.characters}
            characterId={inv.characters.some((c) => c.id === store) ? store : inv.characters[0]?.id ?? ''}
            onCharacter={setStore}
            filter={(i) => matches(i, query, kind)}
            onSelect={setSelected}
            onPatch={(items) => patchItems(items)}
            onChanged={() => void load(false)}
            onToast={(text) => setToast({ id: Date.now(), text })}
          />
        )}
      </main>

      {/* The chat floats above everything, item dialog included, and the button summons or hides it. */}
      <AgentPanel
        enabled={inv.agentEnabled}
        open={agentOpen}
        about={about}
        onClose={() => setAgentOpen(false)}
        onStatus={setChatStatus}
        width={clampChatWidth(chatWidth, windowWidth)}
        onWidth={setChatWidth}
      />
      {compact && selecting && view === 'inventory' ? (
        <SelectBar
          items={inv.items.filter((i) => i.instanceId && picked.has(i.instanceId))}
          characters={inv.characters}
          check={inventoryApi.check}
          progress={bulk}
          onMove={(to) => void moveAll(to)}
          onClear={() => setPicked(new Set())}
          onDone={endSelect}
        />
      ) : compact ? (
        <TabBar
          view={view}
          onView={(v) => { setView(v); setAgentOpen(false); }}
          cleanupCount={inv.cleanup.length}
          chatOpen={agentOpen}
          onChat={() => setAgentOpen((o) => !o)}
          chatStatus={chatStatus}
          chatNote={fabNote(chatStatus)}
          query={query}
          onQuery={setQuery}
          kind={kind}
          onKind={setKind}
        />
      ) : <button
        className={`chat-fab${agentOpen ? ' is-open' : ''}${chatStatus.busy ? ' is-busy' : ''}`}
        onClick={() => setAgentOpen((o) => !o)}
        aria-expanded={agentOpen}
        aria-label={agentOpen ? 'Hide chat' : `Ask Triumvirate${fabNote(chatStatus) ? ` (${fabNote(chatStatus)})` : ''}`}
        title={agentOpen ? 'Hide chat' : `Ask Triumvirate${fabNote(chatStatus) ? ` · ${fabNote(chatStatus)}` : ''}`}
      >
        <Icon name={agentOpen ? 'close' : 'chat'} filled />
        {/* Hidden chat indicators: a count of new answers, or a dot for a conversation in progress. */}
        {!agentOpen && chatStatus.unread > 0 && <span className="chat-fab__badge">{chatStatus.unread}</span>}
        {!agentOpen && chatStatus.unread === 0 && chatStatus.active && <span className="chat-fab__dot" />}
      </button>}
      {seasonOpen && <SeasonSheet onClose={() => setSeasonOpen(false)} />}
      {digestOpen && (
        <DigestSheet
          items={inv.items}
          // The item dialog sits under sheets, so step out of the digest to show it.
          onSelect={(i) => { setDigestOpen(false); setSelected(i); }}
          onClose={() => setDigestOpen(false)}
          onSeen={(date) => { setSeenDigest(date); setLatestDigest((l) => (l < date ? date : l)); }}
        />
      )}
      {watchOpen && (
        <WatchListSheet
          items={inv.items}
          onSelect={(i) => { setWatchOpen(false); setSelected(i); }}
          onClose={() => setWatchOpen(false)}
        />
      )}
      {selected && (
        <ItemDetail
          item={selected}
          onClose={closeDetail}
          copies={copiesOf(selected)}
          onSelect={setSelected}
          onAsk={(item) => { setAbout((a) => ({ id: (a?.id ?? 0) + 1, item })); setAgentOpen(true); }}
        />
      )}
      {quickId && inventoryApi.byId.get(quickId) && (
        <QuickMoveSheet
          item={inventoryApi.byId.get(quickId)!}
          onClose={() => setQuickId(undefined)}
          onDetails={setSelected}
          onSelectMore={compact ? (item) => { setQuickId(undefined); inventoryApi.pick(item); } : undefined}
        />
      )}
      {hovered && !selected && !dragging && !compact && <ItemHovercard item={hovered.item} anchor={hovered.anchor} copies={copiesOf(hovered.item).length} />}
      {drag.ghost}
      {toast && (
        <div className={`toast${toast.ok ? ' toast--ok' : ''}`} role={toast.ok ? 'status' : 'alert'} key={toast.id}>
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

/** What the chat button says about a hidden chat. */
function fabNote(s: ChatStatus) {
  if (s.busy) return 'writing an answer';
  if (s.unread) return `${s.unread} new ${s.unread === 1 ? 'answer' : 'answers'}`;
  return s.active ? 'conversation open' : '';
}
