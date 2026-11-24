// Turns a raw GetProfile response into a flat, readable list of items by location.
import type { DestinyProfileResponse, DestinyItemComponent } from 'bungie-api-ts/destiny2';
import type { ManifestTables } from './manifest.ts';

export const VAULT_BUCKET = 138197802;
export const CLASS_NAMES = ['Titan', 'Hunter', 'Warlock'];
/** Index = Bungie's DamageType enum value. */
export const DAMAGE_NAMES = ['', 'Kinetic', 'Arc', 'Solar', 'Void', 'Raid', 'Stasis', 'Strand'];
/** Bit 1 of DestinyItemComponent.state = locked in game. */
const STATE_LOCKED = 1;

export interface ItemRow {
  location: string;
  /** Character id, or 'vault'. */
  owner: string;
  name: string;
  type: string;
  bucket: string;
  bucketHash?: number;
  power?: number;
  equipped: boolean;
  itemHash: number;
  instanceId?: string;
  /** Full https URL to the item icon. */
  icon?: string;
  /** Season/expansion watermark drawn over the icon. */
  watermark?: string;
  /** e.g. Exotic, Legendary, Rare. */
  tier: string;
  /** DestinyItemType: 3 = weapon, 2 = armor. */
  itemType: number;
  /** 0 Titan, 1 Hunter, 2 Warlock, 3 any. */
  classType: number;
  damage?: string;
  locked: boolean;
  /** Armor 3.0 gear tier (1-5); absent on older gear. */
  gearTier?: number;
  /** Weapon perk columns, in socket order. */
  perks?: PerkOption[][];
  /** Armor stats by stat name (e.g. Health, Grenade). */
  stats?: Record<string, number>;
}

export interface PerkOption {
  name: string;
  icon?: string;
  /** True for the perk currently slotted in this column. */
  active: boolean;
}

// Plug types that aren't part of a roll: cosmetics, trackers, and masterwork/mod slots.
const NOT_A_PERK = /shader|ornament|masterwork|mod\b|tracker|memento|empty|catalyst|deprecated|kill tracker/i;
const WEAPON = 3;
const ARMOR = 2;

export interface CharacterRow {
  id: string;
  className: string;
  classType: number;
  light: number;
  emblemBackground?: string;
  lastPlayed: string;
}

const bungieUrl = (path?: string) => (path ? `https://www.bungie.net${path}` : undefined);

export function summarizeCharacters(profile: DestinyProfileResponse): CharacterRow[] {
  return Object.entries(profile.characters?.data ?? {})
    .map(([id, ch]) => ({
      id,
      className: CLASS_NAMES[ch.classType] ?? 'Character',
      classType: ch.classType,
      light: ch.light,
      emblemBackground: bungieUrl(ch.emblemBackgroundPath),
      lastPlayed: ch.dateLastPlayed,
    }))
    // Most recently played first, the same order the game uses.
    .sort((a, b) => b.lastPlayed.localeCompare(a.lastPlayed));
}

export function summarizeProfile(profile: DestinyProfileResponse, manifest: ManifestTables): ItemRow[] {
  const instances = profile.itemComponents?.instances?.data ?? {};
  const sockets = profile.itemComponents?.sockets?.data ?? {};
  const reusable = profile.itemComponents?.reusablePlugs?.data ?? {};
  const itemStats = profile.itemComponents?.stats?.data ?? {};

  const perkOption = (hash: number, active: boolean): PerkOption | undefined => {
    const d = manifest.items[hash];
    if (!d?.displayProperties.name || NOT_A_PERK.test(d.itemTypeDisplayName ?? '')) return undefined;
    return { name: d.displayProperties.name, icon: bungieUrl(d.displayProperties.icon), active };
  };

  const weaponPerks = (instanceId: string): PerkOption[][] | undefined => {
    const socketList = sockets[instanceId]?.sockets;
    if (!socketList) return undefined;
    const options = reusable[instanceId]?.plugs ?? {};
    const columns: PerkOption[][] = [];
    socketList.forEach((socket, index) => {
      if (!socket.plugHash || socket.isVisible === false) return;
      const active = perkOption(socket.plugHash, true);
      if (!active) return;
      // Other perks this roll can switch to in the same column (multi-perk columns).
      const alts = (options[index] ?? [])
        .filter((p) => p.plugItemHash !== socket.plugHash)
        .map((p) => perkOption(p.plugItemHash, false))
        .filter((p): p is PerkOption => !!p);
      columns.push([active, ...alts]);
    });
    return columns;
  };

  const armorStats = (instanceId: string): Record<string, number> | undefined => {
    const s = itemStats[instanceId]?.stats;
    if (!s) return undefined;
    const out: Record<string, number> = {};
    for (const st of Object.values(s)) {
      const name = manifest.stats[st.statHash]?.displayProperties.name;
      if (name) out[name] = st.value;
    }
    return out;
  };
  const rows: ItemRow[] = [];

  const toRow = (item: DestinyItemComponent, location: string, owner: string, equipped: boolean): ItemRow => {
    const def = manifest.items[item.itemHash];
    const bucketHash = item.bucketHash === VAULT_BUCKET ? def?.inventory?.bucketTypeHash : item.bucketHash;
    const inst = item.itemInstanceId ? instances[item.itemInstanceId] : undefined;
    return {
      location,
      owner,
      name: def?.displayProperties.name || `Unknown item ${item.itemHash}`,
      type: def?.itemTypeDisplayName ?? '',
      bucket: (bucketHash && manifest.buckets[bucketHash]?.displayProperties.name) || '',
      bucketHash,
      power: inst?.primaryStat?.value,
      equipped,
      itemHash: item.itemHash,
      instanceId: item.itemInstanceId,
      icon: bungieUrl(def?.displayProperties.icon),
      watermark: bungieUrl(def?.iconWatermark),
      tier: def?.inventory?.tierTypeName ?? '',
      itemType: def?.itemType ?? 0,
      classType: def?.classType ?? 3,
      damage: inst?.damageType ? DAMAGE_NAMES[inst.damageType] : undefined,
      locked: (item.state & STATE_LOCKED) !== 0,
      gearTier: inst?.gearTier || undefined,
      perks: item.itemInstanceId && def?.itemType === WEAPON ? weaponPerks(item.itemInstanceId) : undefined,
      stats: item.itemInstanceId && def?.itemType === ARMOR ? armorStats(item.itemInstanceId) : undefined,
    };
  };

  for (const item of profile.profileInventory?.data?.items ?? []) {
    // Profile inventory also holds consumables and mods; keep only the vault here.
    if (item.bucketHash === VAULT_BUCKET) rows.push(toRow(item, 'Vault', 'vault', false));
  }

  const characters = profile.characters?.data ?? {};
  for (const [id, ch] of Object.entries(characters)) {
    const label = `${CLASS_NAMES[ch.classType] ?? 'Character'} (${ch.light})`;
    for (const item of profile.characterEquipment?.data?.[id]?.items ?? []) rows.push(toRow(item, label, id, true));
    for (const item of profile.characterInventories?.data?.[id]?.items ?? []) rows.push(toRow(item, label, id, false));
  }
  return rows;
}
