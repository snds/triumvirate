import type { AppraisedItem, CharacterRow } from '@triumvirate/core/browser';
import type { MoveCheck } from '../inventory-context.ts';
import { Icon } from './Icon.tsx';

/**
 * Phone select mode's toolbar. It takes the tab bar's place, as a toolbar does in iOS Photos while
 * selecting: how many are picked, then one button per place to send them. Each button says how
 * many of the picks can go there, so a Titan button reads "2 of 5" when three are Warlock armor.
 * The final say is the bulk planner's, which also counts slots filling up as items land.
 */
export function SelectBar({ items, characters, check, progress, onMove, onClear, onDone }: {
  items: AppraisedItem[];
  characters: CharacterRow[];
  check: (item: AppraisedItem, to: string) => MoveCheck;
  progress?: { done: number; total: number; to: string };
  onMove: (to: string) => void;
  onClear: () => void;
  onDone: () => void;
}) {
  const places = [...characters.map((c) => ({ id: c.id, label: c.className })), { id: 'vault', label: 'Vault' }]
    .map((p) => ({ ...p, can: items.filter((i) => check(i, p.id).ok).length }));
  const busy = !!progress;
  return (
    <div className="tabbar select-bar" role="toolbar" aria-label="Move selected items">
      <div className="select-bar__panel glass">
        <div className="select-bar__head">
          <span className="select-bar__count" role="status">
            {busy ? `Moving ${progress.done + 1 > progress.total ? progress.total : progress.done + 1} of ${progress.total}…`
              : items.length === 0 ? 'Tap items to select them' : `${items.length} selected`}
          </span>
          {items.length > 0 && !busy && <button className="button button--quiet" onClick={onClear}>Clear</button>}
          <button className="button button--quiet" onClick={onDone} disabled={busy}>Done</button>
        </div>
        <div className="select-bar__places">
          {places.map((p) => (
            <button
              key={p.id}
              className="select-bar__place"
              disabled={busy || p.can === 0}
              onClick={() => onMove(p.id)}
              aria-label={`Move ${p.can} to ${p.label}`}
            >
              {p.id === 'vault' && <Icon name="vault" />}
              <span className="select-bar__name">{p.label}</span>
              <span className="select-bar__can">
                {busy && progress.to === p.id ? <span className="spinner" aria-hidden /> : items.length === 0 ? '·' : p.can === items.length ? `All ${p.can}` : `${p.can} of ${items.length}`}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
