import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.tsx';
import { TILE_SCALES } from '../prefs.ts';

interface Props {
  name: string;
  picture?: string;
  synced: string;
  tileScale: number;
  onTileScale: (v: number) => void;
  onSignOut: () => void;
}

/** Avatar, name, and sync time as one button; opens a menu with view settings and sign out. */
export function ProfileMenu({ name, picture, synced, tileScale, onTileScale, onSignOut }: Props) {
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
        onClick={() => setOpen((o) => !o)}
      >
        {picture ? <img className="profile__avatar" src={picture} alt="" /> : <span className="profile__avatar" />}
        <span className="profile__text">
          <span className="profile__name">{name}</span>
          <span className="profile__synced">synced {synced}</span>
        </span>
        <Icon name="chevronDown" />
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu__group">
            <span className="menu__label" id="tile-size-label">Item size</span>
            <div className="segmented" role="radiogroup" aria-labelledby="tile-size-label">
              {TILE_SCALES.map((s) => (
                <button
                  key={s.label}
                  role="radio"
                  aria-checked={tileScale === s.value}
                  className={`segmented__option${tileScale === s.value ? ' is-selected' : ''}`}
                  onClick={() => onTileScale(s.value)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <button className="menu__item" role="menuitem" onClick={() => { setOpen(false); onSignOut(); }}>
            <Icon name="signOut" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
