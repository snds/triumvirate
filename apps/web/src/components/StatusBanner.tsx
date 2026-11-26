import { useEffect } from 'react';
import type { FailKind } from '../api.ts';
import { Icon, type IconName } from './Icon.tsx';

/** What the banner says when your gear is on screen but a newer copy couldn't be loaded. */
function copy(kind: FailKind | 'offline-copy', time: string): { icon: IconName; tone: string; lead: string; rest: string } {
  switch (kind) {
    case 'offline-copy':
    case 'offline':
      return { icon: 'cloudOff', tone: 'muted', lead: 'Offline.', rest: `Showing your gear from ${time}. Refresh and moves come back when you reconnect.` };
    case 'bungie-down':
      return { icon: 'maintenance', tone: 'warning', lead: 'Bungie is down for maintenance.', rest: `Showing your gear from ${time}. Moves are paused until it's back.` };
    case 'server-down':
      return { icon: 'refresh', tone: 'info', lead: 'Couldn\'t refresh.', rest: 'The app server isn\'t answering; it may be restarting.' };
    default:
      return { icon: 'warning', tone: 'danger', lead: 'Couldn\'t refresh.', rest: '' };
  }
}

/** Bungie maintenance retries on its own; the rest wait for you (or the connection). */
const RETRY_MS = 120_000;

/**
 * A thin strip under the top bar for "your gear is here, but it's not fresh". The gear stays usable;
 * only what can't work right now (moves during maintenance, everything live while offline) pauses.
 */
export function StatusBanner({ kind, message, syncedAt, onRetry }: {
  kind: FailKind | 'offline-copy'; message?: string; syncedAt: string; onRetry?: () => void;
}) {
  const time = new Date(syncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const c = copy(kind, time);
  useEffect(() => {
    if (kind !== 'bungie-down' || !onRetry) return;
    const id = setInterval(onRetry, RETRY_MS);
    return () => clearInterval(id);
  }, [kind, onRetry]);
  const offline = kind === 'offline' || kind === 'offline-copy';
  return (
    <div className={`status-banner status-banner--${c.tone}`} role="status">
      <Icon name={c.icon} />
      <span className="status-banner__text"><b>{c.lead}</b> {c.rest || message}</span>
      {!offline && onRetry && <button className="status-banner__action" onClick={onRetry}>{kind === 'bungie-down' ? 'Try now' : 'Retry'}</button>}
    </div>
  );
}
