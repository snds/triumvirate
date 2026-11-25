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
  /** Instance id to when you last moved it, for sorting. */
  recentMoves: Record<string, number>;
  /** Whether `item` can be equipped on `characterId`, and why not. */
  checkEquip: (item: AppraisedItem, characterId: string) => MoveCheck;
  equip: (item: AppraisedItem, characterId: string) => void;
  setLocked: (item: AppraisedItem, locked: boolean) => void;
}

export const InventoryContext = createContext<InventoryApi>({
  byId: new Map(), select: () => {}, characters: [], moving: new Set(),
  check: () => ({ ok: false, reason: 'Not ready' }), move: () => {}, recentMoves: {},
  checkEquip: () => ({ ok: false, reason: 'Not ready' }), equip: () => {}, setLocked: () => {},
});
export const useInventory = () => useContext(InventoryContext);
