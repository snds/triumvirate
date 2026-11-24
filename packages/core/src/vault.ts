// Turns a raw GetProfile response into a flat, readable list of items by location.
import type { DestinyProfileResponse, DestinyItemComponent } from 'bungie-api-ts/destiny2';
import type { ManifestTables } from './manifest.ts';

export const VAULT_BUCKET = 138197802;
const CLASS_NAMES = ['Titan', 'Hunter', 'Warlock'];

export interface ItemRow {
  location: string;
  name: string;
  type: string;
  bucket: string;
  power?: number;
  equipped: boolean;
  itemHash: number;
  instanceId?: string;
}

export function summarizeProfile(profile: DestinyProfileResponse, manifest: ManifestTables): ItemRow[] {
  const instances = profile.itemComponents?.instances?.data ?? {};
  const rows: ItemRow[] = [];

  const toRow = (item: DestinyItemComponent, location: string, equipped: boolean): ItemRow => {
    const def = manifest.items[item.itemHash];
    const bucketHash = item.bucketHash === VAULT_BUCKET ? def?.inventory?.bucketTypeHash : item.bucketHash;
    const inst = item.itemInstanceId ? instances[item.itemInstanceId] : undefined;
    return {
      location,
      name: def?.displayProperties.name || `Unknown item ${item.itemHash}`,
      type: def?.itemTypeDisplayName ?? '',
      bucket: (bucketHash && manifest.buckets[bucketHash]?.displayProperties.name) || '',
      power: inst?.primaryStat?.value,
      equipped,
      itemHash: item.itemHash,
      instanceId: item.itemInstanceId,
    };
  };

  for (const item of profile.profileInventory?.data?.items ?? []) {
    // Profile inventory also holds consumables and mods; keep only the vault here.
    if (item.bucketHash === VAULT_BUCKET) rows.push(toRow(item, 'Vault', false));
  }

  const characters = profile.characters?.data ?? {};
  for (const [id, ch] of Object.entries(characters)) {
    const label = `${CLASS_NAMES[ch.classType] ?? 'Character'} (${ch.light})`;
    for (const item of profile.characterEquipment?.data?.[id]?.items ?? []) rows.push(toRow(item, label, true));
    for (const item of profile.characterInventories?.data?.[id]?.items ?? []) rows.push(toRow(item, label, false));
  }
  return rows;
}
