// Cleanup autopilot: remembers what you decided about each cleanup pick, and plans the moves
// that bring the dismantle queue within reach. Bungie's API can't dismantle, so "dismantle"
// means "queued": the item is pulled onto a character where the game lets you shard it, and
// it drops off the queue on its own once it's gone from your inventory.
import type { CleanupCandidate } from './cleanup.ts';
import { CHARACTER_BUCKET_CARRIED, planMove } from './transfer.ts';
import type { ActionStep, EquipPlan } from './loadouts.ts';
import type { CharacterRow, ItemRow } from './vault.ts';

export type CleanupAction = 'dismantle' | 'keep';

export interface CleanupDecision {
  action: CleanupAction;
  /** ISO time of the decision. */
  at: string;
  /** Kept so the history still reads well after the item is gone. */
  name: string;
  itemHash: number;
}

export interface ClearedItem {
  instanceId: string;
  name: string;
  itemHash: number;
  /** When the app first noticed it was gone. */
  at: string;
}

export interface CleanupState {
  /** By instance id. */
  decisions: Record<string, CleanupDecision>;
  /** Queued items that have since left the inventory, newest first. */
  cleared: ClearedItem[];
}

export const emptyCleanupState = (): CleanupState => ({ decisions: {}, cleared: [] });

const CLEARED_KEEP = 200;

/**
 * Brings saved decisions in line with the inventory. A queued item that's gone was dismantled
 * (or deleted), so it moves to `cleared`. A queued item you've since locked was a change of
 * heart, so its decision is dropped. A kept item that's gone is simply forgotten.
 * Returns the same object when nothing changed, so callers can skip a save.
 */
export function reconcileCleanup(
  state: CleanupState, items: Pick<ItemRow, 'instanceId' | 'locked'>[], now = new Date(),
): CleanupState {
  const byId = new Map(items.filter((i) => i.instanceId).map((i) => [i.instanceId!, i]));
  const decisions: Record<string, CleanupDecision> = {};
  const cleared: ClearedItem[] = [];
  let changed = false;
  for (const [id, d] of Object.entries(state.decisions)) {
    const item = byId.get(id);
    if (!item) {
      changed = true;
      if (d.action === 'dismantle') cleared.push({ instanceId: id, name: d.name, itemHash: d.itemHash, at: now.toISOString() });
      continue;
    }
    if (d.action === 'dismantle' && item.locked) { changed = true; continue; }
    decisions[id] = d;
  }
  if (!changed) return state;
  return { decisions, cleared: [...cleared, ...state.cleared].slice(0, CLEARED_KEEP) };
}

/** Records one decision per id; `undo` forgets it. Unknown ids are ignored. */
export function decideCleanup(
  state: CleanupState, items: Pick<ItemRow, 'instanceId' | 'name' | 'itemHash'>[], ids: string[],
  action: CleanupAction | 'undo', now = new Date(),
): CleanupState {
  const byId = new Map(items.filter((i) => i.instanceId).map((i) => [i.instanceId!, i]));
  const decisions = { ...state.decisions };
  for (const id of ids) {
    if (action === 'undo') { delete decisions[id]; continue; }
    const item = byId.get(id);
    if (!item) continue;
    decisions[id] = { action, at: now.toISOString(), name: item.name, itemHash: item.itemHash };
  }
  return { ...state, decisions };
}

/** Picks you haven't decided on yet. */
export const openPicks = (picks: CleanupCandidate[], state: CleanupState) =>
  picks.filter((p) => !p.item.instanceId || !state.decisions[p.item.instanceId]);

/** Items in the dismantle queue, as they are now. */
export function queuedItems<T extends Pick<ItemRow, 'instanceId'>>(items: T[], state: CleanupState): T[] {
  return items.filter((i) => i.instanceId && state.decisions[i.instanceId]?.action === 'dismantle');
}

/** How many cleared in the last `days` days. */
export const clearedSince = (state: CleanupState, days: number, now = new Date()) =>
  state.cleared.filter((c) => now.getTime() - Date.parse(c.at) <= days * 86_400_000).length;

type Row = Pick<ItemRow, 'owner' | 'equipped' | 'bucketHash' | 'instanceId' | 'itemHash' | 'classType' | 'name' | 'movable' | 'itemType'>;
type Char = Pick<CharacterRow, 'id' | 'classType' | 'className'>;

/**
 * Moves that bring queued items out of the vault onto a character, where the game can dismantle
 * them. Items go to `characterId` when it can use them; class armor for another class goes to a
 * character of that class. Items already on a character stay put. Stops filling a slot at the
 * 9 carried spaces the game allows, and says what didn't fit.
 */
export function planPull(ids: string[], characterId: string, items: Row[], characters: Char[]): EquipPlan {
  const plan: EquipPlan = { steps: [], skipped: [] };
  const byId = new Map(items.filter((i) => i.instanceId).map((i) => [i.instanceId!, i]));
  const carried = new Map<string, number>();
  const key = (owner: string, bucket?: number) => `${owner}|${bucket}`;
  for (const i of items) if (i.owner !== 'vault' && !i.equipped) carried.set(key(i.owner, i.bucketHash), (carried.get(key(i.owner, i.bucketHash)) ?? 0) + 1);
  const chosen = characters.find((c) => c.id === characterId);
  for (const id of ids) {
    const item = byId.get(id);
    if (!item) { plan.skipped.push({ instanceId: id, reason: 'Not in your inventory anymore' }); continue; }
    if (item.owner !== 'vault') continue; // already somewhere you can dismantle it
    if (item.movable === false) { plan.skipped.push({ instanceId: id, name: item.name, reason: 'This item can\'t be moved' }); continue; }
    const to = item.classType === 3 || item.classType === chosen?.classType
      ? chosen
      : characters.find((c) => c.classType === item.classType);
    if (!to) { plan.skipped.push({ instanceId: id, name: item.name, reason: 'None of your characters can carry it' }); continue; }
    const k = key(to.id, item.bucketHash);
    if ((carried.get(k) ?? 0) >= CHARACTER_BUCKET_CARRIED) {
      plan.skipped.push({ instanceId: id, name: item.name, reason: `No room on your ${to.className}` });
      continue;
    }
    carried.set(k, (carried.get(k) ?? 0) + 1);
    for (const s of planMove(item, to.id)) plan.steps.push({ ...s, instanceId: id, itemHash: item.itemHash } as ActionStep);
  }
  return plan;
}
