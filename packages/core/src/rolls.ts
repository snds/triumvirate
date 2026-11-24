// Every roll a weapon can have, straight from its definition: the frame, each perk column's full
// pool, and the base stats before perks. Used by the item dialog's "All rolls" tab.
import type { ManifestTables } from './manifest.ts';
import { bungieUrl, NOT_A_PERK, type PerkOption, type StatDetail } from './vault.ts';

const SOCKET_INTRINSIC = 3956125808;
const SOCKET_WEAPON_PERKS = 4241085061;

export interface RollOptions {
  itemHash: number;
  intrinsic?: PerkOption;
  /** One list per perk column, in socket order. Enhanced copies are folded into their base perk. */
  columns: PerkOption[][];
  baseStats: StatDetail[];
}

export function rollOptions(manifest: ManifestTables, itemHash: number): RollOptions | undefined {
  const extra = manifest.extras?.[itemHash];
  if (!extra?.socketEntries) return undefined;
  const plug = (hash: number): PerkOption | undefined => {
    const d = manifest.items[hash];
    if (!d?.displayProperties.name || NOT_A_PERK.test(d.itemTypeDisplayName ?? '')) return undefined;
    const p: PerkOption = { name: d.displayProperties.name, icon: bungieUrl(d.displayProperties.icon), active: false };
    if (d.displayProperties.description) p.description = d.displayProperties.description;
    if (/enhanced/i.test(d.itemTypeDisplayName ?? '')) p.enhanced = true;
    return p;
  };
  const indexes = (cat: number) => extra.socketCategories?.find(([c]) => c === cat)?.[1] ?? [];

  const pool = (index: number): PerkOption[] => {
    const [set, initial] = extra.socketEntries![index] ?? [0, 0];
    const hashes = set ? manifest.plugSets?.[set] ?? [] : [];
    const list = (hashes.length ? hashes : initial ? [initial] : []).map(plug).filter((p): p is PerkOption => !!p);
    // An enhanced perk is the same choice as its base; keep one entry per name.
    const byName = new Map<string, PerkOption>();
    for (const p of list) {
      const key = p.name.replace(/\s+Enhanced$/i, '');
      const seen = byName.get(key);
      if (!seen || (seen.enhanced && !p.enhanced)) byName.set(key, p);
    }
    return [...byName.values()];
  };

  const intrinsicIndex = indexes(SOCKET_INTRINSIC)[0];
  const intrinsic = intrinsicIndex !== undefined ? pool(intrinsicIndex)[0] : undefined;
  const columns = indexes(SOCKET_WEAPON_PERKS).map(pool).filter((c) => c.length > 0);

  const group = manifest.statGroups?.[extra.statGroupHash ?? -1]?.scaledStats ?? [];
  const order = new Map(group.map((g, i) => [g.statHash, i]));
  const numeric = new Set(group.filter((g) => g.displayAsNumeric).map((g) => g.statHash));
  const baseStats = (extra.baseStats ?? [])
    .map(([hash, value]) => ({ hash, name: manifest.stats[hash]?.displayProperties.name ?? '', value, bonus: 0, numeric: numeric.has(hash) }))
    .filter((d) => d.name && !['Attack', 'Defense', 'Power'].includes(d.name))
    .sort((a, b) => (order.get(a.hash) ?? 999) - (order.get(b.hash) ?? 999) || a.name.localeCompare(b.name));

  return { itemHash, ...(intrinsic ? { intrinsic } : {}), columns, baseStats };
}
