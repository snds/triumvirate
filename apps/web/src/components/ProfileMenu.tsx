import type { GuardianIdentity } from '@triumvirate/core/browser';
import { Icon } from './Icon.tsx';
import { Menu } from '../ui/Menu.tsx';

interface Props {
  name: string;
  picture?: string;
  synced: string;
  onSettings: () => void;
  onSignOut: () => void;
  /** Minutes between quiet refreshes; 0 is off (shown as an icon by the sync time). */
  autoRefresh: number;
  /** Phone: the trigger is the avatar alone, so the name and sync time move into the menu. */
  compact?: boolean;
  /** The last refresh failed, so the copy on screen is old: the sync time turns the warning color. */
  stale?: boolean;
  /** Guardian Rank and commendations, shown as a card at the top of the menu. */
  guardian?: GuardianIdentity;
}

/** Avatar, name, and sync time as one button; opens a menu with Settings and sign out. */
export function ProfileMenu({ name, picture, synced, onSettings, onSignOut, autoRefresh, compact, stale, guardian }: Props) {
  const syncedLine = (
    <span className={`profile__synced${stale ? ' is-stale' : ''}`}>synced {synced}{autoRefresh > 0 && <> · <Icon name="autorenew" className="profile__auto" /></>}</span>
  );
  return (
    <div className="profile">
      <Menu
        label="Account"
        triggerClassName="profile__trigger"
        triggerLabel={compact ? `${name}, synced ${synced}` : undefined}
        trigger={<>
          {picture ? <img className="profile__avatar" src={picture} alt="" /> : <span className="profile__avatar" />}
          {!compact && <span className="profile__text">
            <span className="profile__name">{name}</span>
            {syncedLine}
          </span>}
          {!compact && <Icon name="chevronDown" />}
        </>}
        header={(compact || guardian) && (
          <div className="menu__group menu__who">
            {compact && <><span className="profile__name">{name}</span>{syncedLine}</>}
            {guardian && <IdentityCard g={guardian} />}
          </div>
        )}
        items={[
          { id: 'settings', label: 'Settings', icon: <Icon name="settings" /> },
          { id: 'signout', label: 'Sign out', icon: <Icon name="signOut" /> },
        ]}
        onAction={(id) => (id === 'settings' ? onSettings() : onSignOut())}
      />
    </div>
  );
}

/**
 * Guardian Rank and commendations: the rank's emblem and name, then the commendation total with
 * one bar split by the four groups in the game's own colors (Ally, Fun, Mastery, Leadership).
 */
function IdentityCard({ g }: { g: GuardianIdentity }) {
  const c = g.commendations;
  const shown = c?.groups.filter((x) => x.percent > 0) ?? [];
  return (
    <div className="identity">
      {g.rank && (
        <div className="identity__rank">
          {g.rank.icon ? <img className="identity__rank-icon" src={g.rank.icon} alt="" /> : <span className="identity__rank-icon" aria-hidden />}
          <span>
            <span className="identity__label">Guardian Rank {g.rank.number}</span>
            <span className="identity__name">{g.rank.name}</span>
          </span>
        </div>
      )}
      {c && c.total > 0 && (
        <div className="identity__commendations">
          <span className="identity__label">{c.total.toLocaleString()} commendations</span>
          <span className="identity__bar" aria-hidden>
            {shown.map((x) => <span key={x.name} style={{ flexGrow: x.percent, background: x.color }} />)}
          </span>
          <ul className="identity__legend">
            {c.groups.map((x) => (
              <li key={x.name}><span className="identity__dot" style={{ background: x.color }} aria-hidden />{x.name} <span className="muted">{x.percent}%</span></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
