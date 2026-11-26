import type { CharacterRow } from '@triumvirate/core/browser';
import { Segment } from '../ui/Segmented.tsx';
import { CharacterPicker } from './CharacterPicker.tsx';
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
    <CharacterPicker className="store-switcher" label="Show" characters={characters} value={value} onChange={onChange}>
      <Segment id="vault" className="store-switcher__tab store-switcher__tab--vault">
        <span className="store-switcher__emblem store-switcher__emblem--vault" aria-hidden><Icon name="vault" /></span>
        <span className="store-switcher__text">
          <span className="store-switcher__name">Vault</span>
          {vaultCount !== undefined && <span className="store-switcher__meta">{fmt.format(vaultCount)}</span>}
        </span>
      </Segment>
    </CharacterPicker>
  );
}
