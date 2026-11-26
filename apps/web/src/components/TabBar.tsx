import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon.tsx';
import type { ChatStatus } from './AgentPanel.tsx';
import type { Kind } from '../inventory.ts';
import { useKeyboardInset } from '../keyboard.ts';

export type View = 'inventory' | 'cleanup' | 'rolls' | 'loadouts' | 'vendors' | 'records';

/** Views with their own tab on a phone. */
const VIEWS: { id: View; label: string; icon: IconName }[] = [
  { id: 'inventory', label: 'Inventory', icon: 'inventory' },
  { id: 'rolls', label: 'Rolls', icon: 'rolls' },
  { id: 'loadouts', label: 'Loadouts', icon: 'loadouts' },
];
/** Views behind the More tab. */
const MORE_VIEWS: { id: View; label: string; icon: IconName }[] = [
  { id: 'cleanup', label: 'Cleanup', icon: 'cleanup' },
  { id: 'vendors', label: 'Vendors', icon: 'vendor' },
  { id: 'records', label: 'Records', icon: 'records' },
];
const ALL_VIEWS = [...VIEWS, ...MORE_VIEWS];

export const KIND_SCOPES: { value: Kind; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'weapons', label: 'Weapons' },
  { value: 'armor', label: 'Armor' },
];

/**
 * Phone navigation, shaped like the iOS 26 tab bar: a floating glass capsule inset from the screen
 * edges, with search as its own round button beside it. Tapping search turns the bar into a search
 * field: the tabs fold into one round button (the current tab, tap to go back), the field takes the
 * rest of the row, and the All / Weapons / Armor scopes float just above it.
 * The chat is the last tab, so nothing else floats over the tiles. Less-used views (Cleanup, Vendors, Records)
 * and Settings sit behind a More tab, which opens a small menu just above the bar.
 */
export function TabBar({ view, onView, onSettings, cleanupCount, chatOpen, onChat, chatStatus, chatNote, query, onQuery, kind, onKind }: {
  view: View;
  onView: (v: View) => void;
  onSettings: () => void;
  cleanupCount: number;
  chatOpen: boolean;
  onChat: () => void;
  chatStatus: ChatStatus;
  /** What the chat says while hidden ("2 new answers"), for screen readers. */
  chatNote: string;
  query: string;
  onQuery: (q: string) => void;
  kind: Kind;
  onKind: (k: Kind) => void;
}) {
  const [searching, setSearching] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  // The menu closes on a tap anywhere else, or Escape.
  useEffect(() => {
    if (!moreOpen) return;
    // The More tab toggles itself, so a tap on it isn't "elsewhere".
    const away = (e: PointerEvent) => { if (!moreRef.current?.contains(e.target as Node) && !(e.target as Element).closest?.('.tabbar__more-tab')) setMoreOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setMoreOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); };
  }, [moreOpen]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  useKeyboardInset(searching && focused);
  useEffect(() => { if (searching) inputRef.current?.focus(); }, [searching]);
  const filtered = query.trim() !== '' || kind !== 'all';
  const current = chatOpen ? { label: 'Ask', icon: 'chat' as IconName } : ALL_VIEWS.find((v) => v.id === view)!;
  const inMore = !chatOpen && MORE_VIEWS.some((v) => v.id === view);

  if (searching) {
    return (
      <div className="tabbar tabbar--searching">
        <div className="tabbar__scopes glass" role="radiogroup" aria-label="Item kind">
          {KIND_SCOPES.map((k) => (
            <button
              key={k.value}
              role="radio"
              aria-checked={kind === k.value}
              className={`tabbar__scope${kind === k.value ? ' is-selected' : ''}`}
              onClick={() => onKind(k.value)}
            >
              {k.label}
            </button>
          ))}
        </div>
        <div className="tabbar__row">
          <button className="tabbar__round glass" onClick={() => setSearching(false)} aria-label={`Back to ${current.label}`}>
            <Icon name={current.icon} filled />
          </button>
          <form className="tabbar__field glass" role="search" onSubmit={(e) => { e.preventDefault(); inputRef.current?.blur(); }}>
            <Icon name="search" />
            <input
              ref={inputRef}
              type="search"
              enterKeyHint="search"
              placeholder="Name, type, element…"
              aria-label="Search items"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(e) => { if (e.key === 'Escape') setSearching(false); }}
            />
            {query && (
              <button type="button" className="tabbar__clear" onClick={() => { onQuery(''); inputRef.current?.focus(); }} aria-label="Clear search">
                <Icon name="clear" filled />
              </button>
            )}
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="tabbar">
        {moreOpen && (
          <div className="tabbar__menu glass" ref={moreRef} role="menu" aria-label="More">
            {MORE_VIEWS.map((v) => (
              <button
                key={v.id}
                role="menuitem"
                className={`tabbar__menu-item${view === v.id && !chatOpen ? ' is-selected' : ''}`}
                onClick={() => { setMoreOpen(false); onView(v.id); }}
              >
                <Icon name={v.icon} filled={view === v.id && !chatOpen} />
                <span className="tabbar__menu-label">{v.label}</span>
                {v.id === 'cleanup' && cleanupCount > 0 && <span className="count-badge count-badge--neutral">{cleanupCount > 99 ? '99+' : cleanupCount}</span>}
              </button>
            ))}
            <button role="menuitem" className="tabbar__menu-item" onClick={() => { setMoreOpen(false); onSettings(); }}>
              <Icon name="settings" />
              <span className="tabbar__menu-label">Settings</span>
            </button>
          </div>
        )}
      <div className="tabbar__row">
        <nav className="tabbar__tabs glass" aria-label="View">
          {VIEWS.map((v) => {
            const selected = view === v.id && !chatOpen;
            return (
              <button
                key={v.id}
                className={`tabbar__tab${selected ? ' is-selected' : ''}`}
                aria-current={selected ? 'page' : undefined}
                onClick={() => onView(v.id)}
              >
                <span className="tabbar__icon">
                  <Icon name={v.icon} filled={selected} />
                </span>
                <span className="tabbar__label">{v.label}</span>
              </button>
            );
          })}
          <button
            className={`tabbar__tab tabbar__more-tab${inMore || moreOpen ? ' is-selected' : ''}`}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            aria-current={inMore ? 'page' : undefined}
            aria-label={inMore ? `More: ${current.label}` : 'More'}
            onClick={() => setMoreOpen((o) => !o)}
          >
            <span className="tabbar__icon">
              {/* The tab shows the view you're on when it lives here, so you can still tell where you are. */}
              <Icon name={inMore ? current.icon : 'more'} filled={inMore} />
              {cleanupCount > 0 && view !== 'cleanup' && <span className="tabbar__count count-badge count-badge--neutral">{cleanupCount > 99 ? '99+' : cleanupCount}</span>}
            </span>
            <span className="tabbar__label">{inMore ? current.label : 'More'}</span>
          </button>
          <button
            className={`tabbar__tab tabbar__tab--chat${chatOpen ? ' is-selected' : ''}${chatStatus.busy ? ' is-busy' : ''}`}
            aria-expanded={chatOpen}
            aria-label={`Ask${chatNote ? ` (${chatNote})` : ''}`}
            onClick={onChat}
          >
            <span className="tabbar__icon">
              <Icon name="chat" filled={chatOpen} />
              {!chatOpen && chatStatus.unread > 0 && <span className="tabbar__count count-badge count-badge--alert">{chatStatus.unread}</span>}
              {!chatOpen && chatStatus.unread === 0 && chatStatus.active && <span className="tabbar__dot" />}
            </span>
            <span className="tabbar__label">Ask</span>
          </button>
        </nav>
        <button
          className={`tabbar__round glass${filtered ? ' is-filtered' : ''}`}
          onClick={() => setSearching(true)}
          aria-label={filtered ? 'Search (filter on)' : 'Search'}
        >
          <Icon name="search" />
          {filtered && <span className="tabbar__dot tabbar__dot--accent" aria-hidden />}
        </button>
      </div>
    </div>
  );
}
