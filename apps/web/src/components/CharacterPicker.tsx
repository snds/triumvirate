import type { CharacterRow } from '@triumvirate/core/browser';
import { Segment, Segmented } from '../ui/Segmented.tsx';
import { Icon } from './Icon.tsx';

/**
 * Pick a character: emblem icon, class, and power, like the character select screen. Used by
 * Records, Loadouts, and Vendors, and (with a vault option) by the phone store switcher.
 */
export function CharacterPicker({ characters, value, onChange, className, label = 'Character', children }: {
  characters: CharacterRow[];
  value: string;
  onChange: (id: string) => void;
  className: string;
  label?: string;
  /** Extra options after the characters (the vault, on phone). */
  children?: React.ReactNode;
}) {
  return (
    <Segmented label={label} value={value} onChange={(id) => onChange(String(id))} className={className}>
      {characters.map((c) => (
        <Segment key={c.id} id={c.id} className="store-switcher__tab">
          {/* The emblem's left square is its icon; the banner art is cropped to show just that. */}
          <span className="store-switcher__emblem" style={c.emblemBackground ? { backgroundImage: `url(${c.emblemBackground})` } : undefined} aria-hidden />
          <span className="store-switcher__text">
            <span className="store-switcher__name">{c.className}</span>
            <span className="store-switcher__meta"><Icon name="power" filled />{c.light}</span>
          </span>
        </Segment>
      ))}
      {children}
    </Segmented>
  );
}
