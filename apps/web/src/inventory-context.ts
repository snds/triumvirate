// Lets components deep in the tree (chat chips, build cards, tiles, drop zones) look up owned
// items, open the item panel, and move items.
import { createContext, useContext } from 'react';
import type { AppraisedItem, CharacterRow } from '@triumvirate/core/browser';

export type MoveCheck = { ok: true } | { ok: false; reason: string; quiet?: boolean };

export interface InventoryApi {
  byId: Map<string, AppraisedItem>;
  select: (item: AppraisedItem) => void;
  characters: CharacterRow[];
  /** Instance ids with a move in flight. */
  moving: Set<string>;
  /** Whether `item` can go to `to` (a character id or 'vault'), and why not. */
  check: (item: AppraisedItem, to: string) => MoveCheck;
  move: (item: AppraisedItem, to: string) => void;
}

export const InventoryContext = createContext<InventoryApi>({
  byId: new Map(), select: () => {}, characters: [], moving: new Set(),
  check: () => ({ ok: false, reason: 'Not ready' }), move: () => {},
});
export const useInventory = () => useContext(InventoryContext);
