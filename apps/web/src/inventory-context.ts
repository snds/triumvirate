// Lets components deep in the tree (chat chips, build cards, tiles, drop zones) look up owned
// items, open the item panel, and move items.
import { createContext, useContext } from 'react';
import type { AppraisedItem, ArmorSet, CharacterRow } from '@triumvirate/core/browser';

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
  /** Opens the quick-move sheet: the touch way to move, from a long-press or right-click. */
  quick: (item: AppraisedItem) => void;
  /** Phone select mode: while active, a tap picks or unpicks a tile instead of opening it. */
  selection: { active: boolean; ids: Set<string> };
  /** Picks or unpicks an item, starting select mode if it's off. */
  pick: (item: AppraisedItem) => void;
  /** Pulls everything from a character's postmaster (making room in the vault). Resolves when done. */
  collectPostmaster: (characterId: string) => Promise<void>;
  /** Armor sets you own pieces of, for set bonus badges. */
  itemSets?: Record<string, ArmorSet>;
  /** Every item you own, unfiltered by search, for max power. */
  allItems: AppraisedItem[];
  /** Replaces one item after a change made in game (a perk or ornament swap). */
  patch?: (item: AppraisedItem) => void;
}

export const InventoryContext = createContext<InventoryApi>({
  byId: new Map(), select: () => {}, characters: [], moving: new Set(),
  check: () => ({ ok: false, reason: 'Not ready' }), move: () => {}, recentMoves: {},
  checkEquip: () => ({ ok: false, reason: 'Not ready' }), equip: () => {}, setLocked: () => {}, quick: () => {},
  selection: { active: false, ids: new Set() }, pick: () => {}, collectPostmaster: async () => {}, allItems: [],
});
export const useInventory = () => useContext(InventoryContext);
