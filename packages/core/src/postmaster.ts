// Collecting the postmaster: pull everything to its character, making room first. Pure logic, like
// planEquip: the server runs the steps through Bungie and the app can preview the same plan.
import type { DestinyItemComponent, DestinyProfileResponse } from 'bungie-api-ts/destiny2';
import type { AccountSummary, CharacterRow, ItemRow } from './vault.ts';
import { ENGRAM_BUCKET, ENGRAM_CAPACITY, POSTMASTER_BUCKET } from './vault.ts';
import { CHARACTER_BUCKET_CARRIED } from './transfer.ts';
import { GEAR_BUCKETS, type EquipPlan } from './loadouts.ts';

type Row = Pick<ItemRow, 'owner' | 'equipped' | 'bucketHash' | 'homeBucketHash' | 'instanceId' | 'itemHash' | 'name' | 'movable' | 'locked' | 'power' | 'tier' | 'quantity'>;

const isPostmaster = (i: Pick<Row, 'bucketHash'>) => i.bucketHash === POSTMASTER_BUCKET;

/**
 * Which spare to send to the vault when a slot is full: unlocked before locked, then legendary
 * before exotic, then the lowest power. That keeps what you've marked or might wear.
 */
function rankSpare(a: Row, b: Row) {
  return Number(a.locked) - Number(b.locked)
    || Number(a.tier === 'Exotic') - Number(b.tier === 'Exotic')
    || (a.power ?? 0) - (b.power ?? 0);
}

/**
 * The Bungie calls that empty a character's postmaster, the way DIM does it: each item is pulled to
 * the character, and when its slot there is full (9 spares besides the equipped one), the weakest
 * spare goes to the vault first. Engrams can't go to the vault, so a full engram row skips them.
 * Stacks (materials) are pulled whole by item hash.
 */
export function planCollectPostmaster(
  characterId: string, items: Row[], characters: Pick<CharacterRow, 'id'>[], account?: Pick<AccountSummary, 'vault'>,
): EquipPlan {
  const plan: EquipPlan = { steps: [], skipped: [] };
  if (!characters.some((c) => c.id === characterId)) {
    plan.skipped.push({ instanceId: '', reason: 'Unknown character' });
    return plan;
  }
  const mine = items.filter((i) => i.owner === characterId);
  const waiting = mine.filter(isPostmaster);
  // Spares per bucket on the character, and the ones that could make room.
  const carried = new Map<number, number>();
  const spares = new Map<number, Row[]>();
  for (const i of mine) {
    if (i.equipped || isPostmaster(i) || !i.bucketHash) continue;
    carried.set(i.bucketHash, (carried.get(i.bucketHash) ?? 0) + 1);
    if (i.instanceId && i.movable) spares.set(i.bucketHash, [...(spares.get(i.bucketHash) ?? []), i]);
  }
  for (const list of spares.values()) list.sort(rankSpare);
  let vaultUsed = account?.vault.used ?? 0;
  const vaultCap = account?.vault.capacity ?? Infinity;
  const gear = GEAR_BUCKETS as readonly number[];

  for (const item of waiting) {
    const home = item.homeBucketHash;
    const skip = (reason: string) => plan.skipped.push({ instanceId: item.instanceId ?? '', name: item.name, reason });
    if (home && gear.includes(home)) {
      if ((carried.get(home) ?? 0) >= CHARACTER_BUCKET_CARRIED) {
        const spare = spares.get(home)?.shift();
        if (!spare) { skip('No room in that slot, and nothing there can move'); continue; }
        if (vaultUsed >= vaultCap) { skip('No room in that slot, and the vault is full'); continue; }
        plan.steps.push({ kind: 'toVault', characterId, instanceId: spare.instanceId!, itemHash: spare.itemHash });
        vaultUsed++;
        carried.set(home, carried.get(home)! - 1);
      }
      carried.set(home, (carried.get(home) ?? 0) + 1);
    } else if (home === ENGRAM_BUCKET) {
      if ((carried.get(home) ?? 0) >= ENGRAM_CAPACITY) { skip('Engram slots are full. Open some first.'); continue; }
      carried.set(home, (carried.get(home) ?? 0) + 1);
    }
    plan.steps.push(item.instanceId
      ? { kind: 'pull', characterId, instanceId: item.instanceId, itemHash: item.itemHash }
      : { kind: 'pull', characterId, instanceId: '', itemHash: item.itemHash, stackSize: item.quantity ?? 1 });
  }
  return plan;
}

/**
 * Records a pulled stack in a profile snapshot: it leaves the postmaster for its home bucket.
 * Stacks have no instance id, so the first postmaster stack of that item is the one.
 */
export function applyPullStack(
  profile: DestinyProfileResponse, characterId: string, itemHash: number, homeBucketHash?: number,
): boolean {
  const list = profile.characterInventories?.data?.[characterId]?.items as DestinyItemComponent[] | undefined;
  const n = list?.findIndex((i) => i.bucketHash === POSTMASTER_BUCKET && i.itemHash === itemHash && !i.itemInstanceId) ?? -1;
  if (!list || n < 0) return false;
  const [item] = list.splice(n, 1) as [DestinyItemComponent];
  // Snapshot data is plain JSON, so writing the read-only fields is safe here.
  if (homeBucketHash) list.push({ ...item, bucketHash: homeBucketHash } as DestinyItemComponent);
  return true;
}
