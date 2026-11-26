import { Component, useEffect, useState, type ReactNode } from 'react';
import type { FailKind } from '../api.ts';
import { Icon, type IconName } from './Icon.tsx';
import { Mark } from './Mark.tsx';
import { dismissBoot } from '../boot.ts';

/** Why the sign-in screen is showing: never signed in, a sign-in that ran out, or one that didn't finish. */
export type SignInReason = 'expired' | 'retry' | undefined;

/** First run and signed-out: the mark, what the app does, and the Bungie button. */
export function SignInScreen({ reason }: { reason: SignInReason }) {
  const note = reason === 'expired'
    ? 'Your Bungie sign-in ran out. Sign in to pick up where you left off. Saved loadouts and settings are still here.'
    : reason === 'retry'
      ? 'Sign-in didn\'t finish. That happens if you back out on Bungie\'s page or the link went stale. Try again.'
      : 'Your vault, roll grades, loadouts, and a chat that knows your gear.';
  return (
    <main className="center status-screen">
      <Mark className="center__mark" />
      <h1 className="brand">Triumvirate</h1>
      <p className="status-screen__text">{note}</p>
      <a className="button button--primary" href="/auth/login">Sign in with Bungie</a>
      {!reason && <p className="status-screen__fine">Bungie asks you to allow reading and moving your gear.</p>}
    </main>
  );
}

const COPY: Record<FailKind, { icon: IconName; tone: string; title: string; text: string }> = {
  'bungie-down': {
    icon: 'maintenance', tone: 'warning', title: 'Bungie is down for maintenance',
    text: 'Destiny\'s servers are offline for now. We\'ll keep checking and load your gear as soon as they\'re back.',
  },
  'server-down': {
    icon: 'refresh', tone: 'info', title: 'The app server isn\'t answering',
    text: 'It may be restarting after an update. This usually takes under a minute.',
  },
  access: {
    icon: 'lock', tone: 'accent', title: 'Sign in to your server again',
    text: 'Your Cloudflare sign-in for this site ran out. Reload to sign in, then you\'re back here.',
  },
  offline: {
    icon: 'cloudOff', tone: 'muted', title: 'You\'re offline',
    text: 'There\'s no saved copy of your gear on this device yet. It loads as soon as you\'re connected.',
  },
  other: {
    icon: 'warning', tone: 'danger', title: 'Couldn\'t load your gear',
    text: 'Something went wrong on the way. Try again, and if it keeps happening the details below say what.',
  },
};

/** Seconds between automatic retries: Bungie maintenance runs long, a restart is quick. */
const RETRY_EVERY: Partial<Record<FailKind, number>> = { 'bungie-down': 120, 'server-down': 10 };

/**
 * Full-screen "can't load" state, used only when there's no copy of your gear to show.
 * Each cause names whose problem it is and its own fix; the ones that clear up by themselves retry on a timer.
 */
export function StatusScreen({ kind, message, onRetry }: { kind: FailKind; message: string; onRetry: () => void }) {
  const c = COPY[kind];
  const every = RETRY_EVERY[kind];
  const [left, setLeft] = useState(every ?? 0);
  useEffect(() => {
    setLeft(every ?? 0);
    if (!every) return;
    const id = setInterval(() => setLeft((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(id);
  }, [every]);
  // At zero: try, and start the next countdown (a failed try lands back on this same screen).
  useEffect(() => {
    if (!every || left !== 0) return;
    onRetry();
    setLeft(every);
  }, [left, every, onRetry]);
  const tryNow = () => { setLeft(every ?? 0); onRetry(); };
  // Offline waits for the connection instead of a timer.
  useEffect(() => {
    if (kind !== 'offline') return;
    window.addEventListener('online', onRetry);
    return () => window.removeEventListener('online', onRetry);
  }, [kind, onRetry]);

  return (
    <main className={`center status-screen status-screen--${c.tone}`}>
      <span className="status-screen__icon"><Icon name={c.icon} /></span>
      <h1 className="status-screen__title">{c.title}</h1>
      <p className="status-screen__text">{c.text}</p>
      <div className="status-screen__actions">
        {kind === 'access'
          ? <button className="button button--primary" onClick={() => location.reload()}>Reload</button>
          : <button className="button" onClick={tryNow}>{every ? 'Try now' : 'Try again'}</button>}
        {kind === 'bungie-down' && (
          <a className="button button--ghost" href="https://x.com/BungieHelp" target="_blank" rel="noreferrer">
            Bungie Help <Icon name="openExternal" />
          </a>
        )}
      </div>
      {every ? <p className="status-screen__count" aria-live="off">{`${kind === 'bungie-down' ? 'Next check' : 'Trying again'} in ${clock(left)}`}</p> : null}
      {kind === 'other' && (
        <details className="status-screen__details">
          <summary>Details</summary>
          <code>{message}</code>
        </details>
      )}
    </main>
  );
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * Last line of defence: if a screen throws while drawing, show what broke and a way back
 * instead of a blank page. Your gear and settings are safe; a reload starts the view fresh.
 */
export class CrashScreen extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) {
    console.error(error);
    dismissBoot(); // a crash on the first draw would otherwise leave the launch loader up for good
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main className="center status-screen status-screen--danger">
        <span className="status-screen__icon"><Icon name="warning" /></span>
        <h1 className="status-screen__title">This screen hit a bug</h1>
        <p className="status-screen__text">Nothing in your game changed. Reload to start fresh; if it happens again, the details say where.</p>
        <div className="status-screen__actions">
          <button className="button button--primary" onClick={() => location.reload()}>Reload</button>
        </div>
        <details className="status-screen__details">
          <summary>Details</summary>
          <code>{error.message}</code>
        </details>
      </main>
    );
  }
}
