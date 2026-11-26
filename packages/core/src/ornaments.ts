// Ornaments for the item dialog's preview strip: every ornament a weapon's or armor piece's ornament
// socket can take, which you've unlocked, which is applied, and each one's studio render.
// Pure logic over the saved profile and the slim manifest.
import type { DestinyProfileResponse } from 'bungie-api-ts/destiny2';
import type { ManifestTables } from './manifest.ts';
import { bungieUrl } from './vault.ts';

export interface OrnamentOption {
  hash: number;
  name: string;
  icon?: string;
  /** Bungie's 1920×1080 render; the weapon's own for the default ornament. */
  screenshot?: string;
  /** The weapon's own look ("Default Ornament"). */
  isDefault?: boolean;
  /** On this copy now. */
  applied?: boolean;
  /** Yours to apply. The default always is. */
  unlocked: boolean;
}

export interface WeaponOrnaments {
  socketIndex: number;
  options: OrnamentOption[];
}

/** Ornament plugs' categories hold "skins": v400_repackage_hand_cannon0_skins for weapons,
 *  armor_skins_titan_head (and armor_skins_empty for the default) for armor. */
const SKINS = /skins/;

/**
 * The ornaments one weapon or armor copy can wear, default first, then unlocked, then the rest by
 * name. Undefined when the item has no ornament socket or only the default.
 */
export function itemOrnaments(
  profile: DestinyProfileResponse,
  manifest: Pick<ManifestTables, 'items' | 'extras' | 'plugSets'>,
  instanceId: string,
  itemHash: number,
): WeaponOrnaments | undefined {
  const extra = manifest.extras?.[itemHash];
  // Weapons keep every socket; armor keeps just its ornament socket.
  const entries = extra?.socketEntries ?? [];
  const weaponAt = entries.findIndex(([, initial]) => SKINS.test(manifest.extras?.[initial]?.plugCategory ?? ''));
  const socket: [number, number, number] | undefined = weaponAt >= 0 ? [weaponAt, ...entries[weaponAt]!] : extra?.ornamentSocket;
  if (!socket) return undefined;
  const [socketIndex, plugSet, initial] = socket;
  const current = profile.itemComponents?.sockets?.data?.[instanceId]?.sockets?.[socketIndex]?.plugHash;

  // Unlocked: the account's plug set for this socket (ornaments unlock account-wide), any
  // character's copy of it, and what this copy itself reports as insertable.
  const unlocked = new Set<number>([initial]);
  const take = (plugs?: { plugItemHash: number; canInsert: boolean; enabled: boolean }[]) => {
    for (const p of plugs ?? []) if (p.canInsert && p.enabled) unlocked.add(p.plugItemHash);
  };
  if (plugSet) {
    take(profile.profilePlugSets?.data?.plugs?.[plugSet] as never);
    for (const c of Object.values(profile.characterPlugSets?.data ?? {})) take(c.plugs?.[plugSet] as never);
  }
  take(profile.itemComponents?.reusablePlugs?.data?.[instanceId]?.plugs?.[socketIndex] as never);
  if (current) unlocked.add(current);

  const pool = new Set<number>([initial, ...(plugSet ? manifest.plugSets?.[plugSet] ?? [] : []), ...unlocked]);
  const own = manifest.extras?.[itemHash]?.screenshot;
  const options: OrnamentOption[] = [];
  for (const h of pool) {
    const d = manifest.items[h];
    const name = d?.displayProperties.name;
    if (!name) continue;
    const isDefault = h === initial;
    // Only real weapon ornaments (plus the default); the socket's whitelist can hold other plugs.
    if (!isDefault && !SKINS.test(manifest.extras?.[h]?.plugCategory ?? '')) continue;
    const shot = isDefault ? own : manifest.extras?.[h]?.screenshot;
    options.push({
      hash: h, name: isDefault ? 'Default' : name,
      ...(d.displayProperties.icon && !isDefault ? { icon: bungieUrl(d.displayProperties.icon) } : {}),
      ...(shot ? { screenshot: bungieUrl(shot) } : {}),
      ...(isDefault ? { isDefault } : {}),
      ...((current ?? initial) === h ? { applied: true } : {}),
      unlocked: unlocked.has(h),
    });
  }
  if (options.length < 2) return undefined;
  options.sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault) || Number(b.unlocked) - Number(a.unlocked) || a.name.localeCompare(b.name));
  return { socketIndex, options };
}

/** The earlier, weapons-only name. */
export const weaponOrnaments = itemOrnaments;
