import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.tsx';

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
}

/** Avatar, name, and sync time as one button; opens a menu with Settings and sign out. */
export function ProfileMenu({ name, picture, synced, onSettings, onSignOut, autoRefresh, compact }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="profile" ref={root}>
      <button
        className="profile__trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={compact ? `${name}, synced ${synced}` : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {picture ? <img className="profile__avatar" src={picture} alt="" /> : <span className="profile__avatar" />}
        {!compact && <span className="profile__text">
          <span className="profile__name">{name}</span>
          <span className="profile__synced">synced {synced}{autoRefresh > 0 && <> · <Icon name="autorenew" className="profile__auto" /></>}</span>
        </span>}
        {!compact && <Icon name="chevronDown" />}
      </button>
      {open && (
        <div className="menu" role="menu">
          {compact && (
            <div className="menu__group menu__who">
              <span className="profile__name">{name}</span>
              <span className="profile__synced">synced {synced}{autoRefresh > 0 && <> · <Icon name="autorenew" className="profile__auto" /></>}</span>
            </div>
          )}
          <button className="menu__item" role="menuitem" onClick={() => { setOpen(false); onSettings(); }}>
            <Icon name="settings" /> Settings
          </button>
          <button className="menu__item" role="menuitem" onClick={() => { setOpen(false); onSignOut(); }}>
            <Icon name="signOut" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
