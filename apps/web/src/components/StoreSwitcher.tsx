import type { CharacterRow } from '@triumvirate/core/browser';
import { Icon } from './Icon.tsx';

const fmt = new Intl.NumberFormat('en-US');

/**
 * Phone-only: picks which store fills the screen, each character or the vault. Characters show
 * their emblem icon and power, so the row reads like the character select screen. The bar sticks
 * to the top of the scroll area so switching is always one tap away.
 */
export function StoreSwitcher({ characters, vaultCount, value, onChange }: {
  characters: CharacterRow[];
  vaultCount?: number;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="store-switcher" role="tablist" aria-label="Show">
      {characters.map((c) => (
        <button
          key={c.id}
          role="tab"
          aria-selected={value === c.id}
          aria-controls="store-panel"
          className={`store-switcher__tab${value === c.id ? ' is-selected' : ''}`}
          onClick={() => onChange(c.id)}
        >
          {/* The emblem's left square is its icon; the banner art is cropped to show just that. */}
          <span
            className="store-switcher__emblem"
            style={c.emblemBackground ? { backgroundImage: `url(${c.emblemBackground})` } : undefined}
            aria-hidden
          />
          <span className="store-switcher__text">
            <span className="store-switcher__name">{c.className}</span>
            <span className="store-switcher__meta"><Icon name="power" filled />{c.light}</span>
          </span>
        </button>
      ))}
      <button
        role="tab"
        aria-selected={value === 'vault'}
        aria-controls="store-panel"
        className={`store-switcher__tab${value === 'vault' ? ' is-selected' : ''}`}
        onClick={() => onChange('vault')}
      >
        <span className="store-switcher__emblem store-switcher__emblem--vault" aria-hidden><Icon name="vault" /></span>
        <span className="store-switcher__text">
          <span className="store-switcher__name">Vault</span>
          {vaultCount !== undefined && <span className="store-switcher__meta">{fmt.format(vaultCount)}</span>}
        </span>
      </button>
    </div>
  );
}
