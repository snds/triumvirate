import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon.tsx';
import type { ChatStatus } from './AgentPanel.tsx';
import type { Kind } from '../inventory.ts';
import { useKeyboardInset } from '../keyboard.ts';
import { Menu } from '../ui/Menu.tsx';
import { Segment, Segmented } from '../ui/Segmented.tsx';

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
/** The desktop top bar: every view, in its own order. Mid-width shows the phone's split (primary + More). */
export const DESKTOP_VIEWS = (['inventory', 'cleanup', 'rolls', 'loadouts', 'vendors', 'records'] as const).map((id) => ALL_VIEWS.find((v) => v.id === id)!);
export const PRIMARY_VIEWS = VIEWS;
export const QUIET_VIEWS = MORE_VIEWS;

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
        <Segmented className="tabbar__scopes glass" label="Item kind" value={kind} onChange={onKind}>
          {KIND_SCOPES.map((k) => <Segment key={k.value} id={k.value} className="tabbar__scope">{k.label}</Segment>)}
        </Segmented>
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
          <Menu
            label="More"
            triggerClassName={`tabbar__tab tabbar__more-tab${inMore ? ' is-selected' : ''}`}
            triggerLabel={inMore ? `More: ${current.label}` : 'More'}
            trigger={<>
              <span className="tabbar__icon">
                {/* The tab shows the view you're on when it lives here, so you can still tell where you are. */}
                <Icon name={inMore ? current.icon : 'more'} filled={inMore} />
                {cleanupCount > 0 && view !== 'cleanup' && <span className="tabbar__count count-badge count-badge--neutral">{cleanupCount > 99 ? '99+' : cleanupCount}</span>}
              </span>
              <span className="tabbar__label">{inMore ? current.label : 'More'}</span>
            </>}
            placement="top end"
            offset={12}
            className="tabbar__menu glass"
            itemClassName="tabbar__menu-item"
            items={[
              ...MORE_VIEWS.map((v) => ({
                id: v.id, label: v.label, selected: view === v.id && !chatOpen,
                icon: <Icon name={v.icon} filled={view === v.id && !chatOpen} />,
                end: v.id === 'cleanup' && cleanupCount > 0 ? <span className="count-badge count-badge--neutral">{cleanupCount > 99 ? '99+' : cleanupCount}</span> : undefined,
              })),
              { id: 'settings', label: 'Settings', icon: <Icon name="settings" /> },
            ]}
            onAction={(id) => (id === 'settings' ? onSettings() : onView(id as View))}
          />
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
