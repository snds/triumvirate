import { Icon, type IconName } from './Icon.tsx';
import type { ChatStatus } from './AgentPanel.tsx';

export type View = 'inventory' | 'cleanup' | 'rolls';

const VIEWS: { id: View; label: string; icon: IconName }[] = [
  { id: 'inventory', label: 'Inventory', icon: 'inventory' },
  { id: 'cleanup', label: 'Cleanup', icon: 'cleanup' },
  { id: 'rolls', label: 'Rolls', icon: 'rolls' },
];

/**
 * Phone navigation: the three views plus the chat, pinned to the bottom edge where a thumb rests.
 * The chat is a fourth tab here instead of a floating button, so nothing floats over the tiles.
 * Its badge and dot mean the same as the floating button's on a wide screen.
 */
export function TabBar({ view, onView, cleanupCount, chatOpen, onChat, chatStatus, chatNote }: {
  view: View;
  onView: (v: View) => void;
  cleanupCount: number;
  chatOpen: boolean;
  onChat: () => void;
  chatStatus: ChatStatus;
  /** What the chat says while hidden ("2 new answers"), for screen readers. */
  chatNote: string;
}) {
  return (
    <nav className="tabbar" aria-label="View">
      {VIEWS.map((v) => {
        const current = view === v.id && !chatOpen;
        return (
          <button
            key={v.id}
            className={`tabbar__tab${current ? ' is-selected' : ''}`}
            aria-current={current ? 'page' : undefined}
            onClick={() => onView(v.id)}
          >
            <span className="tabbar__icon">
              <Icon name={v.icon} filled={current} />
              {v.id === 'cleanup' && cleanupCount > 0 && <span className="tabbar__count count-badge count-badge--neutral">{cleanupCount > 99 ? '99+' : cleanupCount}</span>}
            </span>
            <span className="tabbar__label">{v.label}</span>
          </button>
        );
      })}
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
  );
}
