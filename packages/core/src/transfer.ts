// Moving items between characters and the vault. Pure logic so the web app can check a
// drop instantly and the server can plan and record the same move.
import type { DestinyItemComponent, DestinyProfileResponse } from 'bungie-api-ts/destiny2';
import type { ManifestTables } from './manifest.ts';
import type { AccountSummary, CharacterRow, ItemRow } from './vault.ts';
import { POSTMASTER_BUCKET, VAULT_BUCKET } from './vault.ts';

/** Where an item can go: a character id, or 'vault'. */
export type Destination = string;

/** Non-equipped slots per weapon or armor bucket on a character (10 with the equipped one). */
export const CHARACTER_BUCKET_CARRIED = 9;

export type MoveStep =
  | { kind: 'pull'; characterId: string }
  | { kind: 'toVault'; characterId: string }
  | { kind: 'fromVault'; characterId: string };

type MovableItem = Pick<ItemRow, 'owner' | 'equipped' | 'movable' | 'pullOnly' | 'classType' | 'itemType' | 'bucketHash' | 'instanceId'>;

/**
 * Whether `item` can be dropped on `to`, with a short reason when it can't.
 * `items` is the whole inventory, used to check for room.
 */
export function checkMove(
  item: MovableItem, to: Destination, characters: Pick<CharacterRow, 'id' | 'classType' | 'className'>[],
  items: Pick<ItemRow, 'owner' | 'equipped' | 'bucketHash'>[], account?: Pick<AccountSummary, 'vault'>,
): { ok: true } | { ok: false; reason: string; quiet?: boolean } {
  const inPostmaster = item.bucketHash === POSTMASTER_BUCKET;
  // Dropping back where it already is does nothing, so say nothing.
  if (item.owner === to && !inPostmaster) return { ok: false, reason: 'Already here', quiet: true };
  if (item.equipped) return { ok: false, reason: 'Equipped items can\'t be moved' };
  if (!item.movable) return { ok: false, reason: 'This item can\'t be moved' };
  if (item.pullOnly && to !== item.owner) return { ok: false, reason: 'Can only go to its own character' };
  if (to === 'vault') {
    if (account && account.vault.used >= account.vault.capacity) return { ok: false, reason: 'Vault is full' };
    return { ok: true };
  }
  const ch = characters.find((c) => c.id === to);
  if (!ch) return { ok: false, reason: 'Unknown character' };
  // Armor is class-locked; class 3 means any class.
  if (item.classType !== 3 && item.classType !== ch.classType) return { ok: false, reason: `Not usable by a ${ch.className}` };
  const bucket = inPostmaster ? undefined : item.bucketHash;
  if (bucket) {
    const carried = items.filter((i) => i.owner === to && !i.equipped && i.bucketHash === bucket).length;
    if (carried >= CHARACTER_BUCKET_CARRIED) return { ok: false, reason: 'No room in that slot' };
  }
  return { ok: true };
}

/** The Bungie calls that take an item from where it is to `to`. Character to character goes through the vault. */
export function planMove(item: Pick<ItemRow, 'owner' | 'bucketHash'>, to: Destination): MoveStep[] {
  const steps: MoveStep[] = [];
  let at = item.owner;
  if (item.bucketHash === POSTMASTER_BUCKET && at !== 'vault') steps.push({ kind: 'pull', characterId: at });
  if (at === to) return steps;
  if (at !== 'vault') {
    steps.push({ kind: 'toVault', characterId: at });
    at = 'vault';
  }
  if (to !== 'vault') steps.push({ kind: 'fromVault', characterId: to });
  return steps;
}

/**
 * Records one finished step in a profile snapshot, so the app shows the move without a full
 * re-sync (Bungie's own profile data lags behind actions by a few seconds).
 */
export function applyStep(
  profile: DestinyProfileResponse, instanceId: string, step: MoveStep, manifest: Pick<ManifestTables, 'items'>,
): boolean {
  const lists: DestinyItemComponent[][] = [];
  const vault = profile.profileInventory?.data?.items;
  if (vault) lists.push(vault as DestinyItemComponent[]);
  for (const inv of Object.values(profile.characterInventories?.data ?? {})) lists.push(inv.items as DestinyItemComponent[]);
  for (const list of lists) {
    const n = list.findIndex((i) => i.itemInstanceId === instanceId);
    if (n < 0) continue;
    const [item] = list.splice(n, 1) as [DestinyItemComponent];
    const home = manifest.items[item.itemHash]?.inventory?.bucketTypeHash ?? item.bucketHash;
    const target = step.kind === 'toVault'
      ? (profile.profileInventory?.data?.items as DestinyItemComponent[] | undefined)
      : (profile.characterInventories?.data?.[step.characterId]?.items as DestinyItemComponent[] | undefined);
    if (!target) { list.splice(n, 0, item); return false; }
    // Snapshot data is plain JSON, so writing the read-only fields is safe here.
    target.push({ ...item, bucketHash: step.kind === 'toVault' ? VAULT_BUCKET : home, location: step.kind === 'toVault' ? 2 : 1 } as DestinyItemComponent);
    return true;
  }
  return false;
}
