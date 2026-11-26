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
}

/** Avatar, name, and sync time as one button; opens a menu with Settings and sign out. */
export function ProfileMenu({ name, picture, synced, onSettings, onSignOut, autoRefresh, compact, stale }: Props) {
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
        header={compact && (
          <div className="menu__group menu__who">
            <span className="profile__name">{name}</span>
            {syncedLine}
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
