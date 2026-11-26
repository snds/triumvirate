// Farming targets: weapons with a wish list god roll you don't have yet, where each one drops,
// and whether a vendor is selling it right now. Pure logic; the server feeds it the manifest,
// the wish list, your items, today's vendor offers, and community usage.
import type { ManifestTables } from './manifest.ts';
import { bungieUrl, type ItemRow } from './vault.ts';
import type { Appraisal, Verdict, WishList, WishRoll } from './wishlist.ts';

export type RollUse = 'pve' | 'pvp' | 'both';

export interface FarmTarget {
  itemHash: number;
  name: string;
  icon?: string;
  watermark?: string;
  /** e.g. "Auto Rifle". */
  type: string;
  tier: string;
  /** Element name (Arc, Solar...). */
  damage?: string;
  /** The god roll to chase: perk names per column it names, and where it shines. */
  roll: { perks: string[]; use: RollUse; notes?: string };
  /** How many god rolls the wish list has for this weapon. */
  godRolls: number;
  /** Copies you own now, and the best wish list verdict among them. */
  owned: { copies: number; best?: Verdict };
  /** Collection source text ("Vault of Glass" Raid, Banshee-44...). */
  source?: string;
  /** A vendor sells it right now. `god` when the offered roll is itself a god roll. */
  vendor?: { name: string; god: boolean; good: boolean };
  /** Copies seen in public matches over the last 30 days. */
  seen?: number;
  /** One line on why it made the list. */
  why: string;
}

export interface FarmInput {
  manifest: Pick<ManifestTables, 'items' | 'sources'> & Partial<Pick<ManifestTables, 'damageTypes'>>;
  wishList: WishList;
  /** Your items (only weapons are read). */
  items: (Pick<ItemRow, 'itemHash' | 'itemType'> & { appraisal?: Pick<Appraisal, 'verdict'> })[];
  /** Weapons on sale right now, with their own roll appraisal. */
  vendors?: { itemHash: number; vendorName: string; appraisal?: Pick<Appraisal, 'verdict'> }[];
  /** Community copies seen per item hash. */
  seen?: Record<string, number>;
  /** Most targets returned (default 80). */
  limit?: number;
}

const WEAPON = 3;
/** Fewer than this many copies seen and a weapon you don't own isn't worth a slot on the list. */
const MIN_SEEN = 5;
/** Sources you can't farm: cosmetic stores, one-time rewards, and retired loot. */
const UNFARMABLE = /cannot be reacquired|eververse|special offer|season pass|rewards pass|upgraded event card|bright engram/i;

const isGod = (r: WishRoll) => !r.trash && r.tags.some((t) => t.includes('god'));
const useOf = (r: WishRoll): RollUse => {
  const pve = r.tags.some((t) => t.includes('pve'));
  const pvp = r.tags.some((t) => t.includes('pvp'));
  return pve && pvp ? 'both' : pvp ? 'pvp' : 'pve';
};
/** "Constructed by @x (PvE ...): First-choice roll for..." reads better without the byline. */
const tidyNotes = (n?: string) => n?.replace(/^Constructed by[^:]*:\s*/i, '').replace(/\s+/g, ' ').trim().slice(0, 220) || undefined;

export function farmTargets(input: FarmInput): FarmTarget[] {
  const { manifest, wishList } = input;
  const owned = new Map<number, { copies: number; best?: Verdict }>();
  const RANK: Record<Verdict, number> = { god: 4, good: 3, unrated: 2, meh: 1, trash: 0 };
  for (const i of input.items) {
    if (i.itemType !== WEAPON) continue;
    const o = owned.get(i.itemHash) ?? { copies: 0 };
    o.copies++;
    const v = i.appraisal?.verdict;
    if (v && (!o.best || RANK[v] > RANK[o.best])) o.best = v;
    owned.set(i.itemHash, o);
  }
  const vendorBy = new Map<number, FarmTarget['vendor']>();
  for (const v of input.vendors ?? []) {
    const verdict = v.appraisal?.verdict;
    const prev = vendorBy.get(v.itemHash);
    const next = { name: v.vendorName, god: verdict === 'god', good: verdict === 'god' || verdict === 'good' };
    // Keep the best offer when two vendors (or two characters' vendors) sell it.
    if (!prev || (next.god && !prev.god) || (next.good && !prev.good)) vendorBy.set(v.itemHash, next);
  }

  const out: (FarmTarget & { score: number })[] = [];
  for (const [hash, rolls] of wishList) {
    const gods = rolls.filter(isGod);
    if (!gods.length) continue;
    const def = manifest.items[hash];
    if (!def || def.itemType !== WEAPON || !def.displayProperties?.name) continue;
    const mine = owned.get(hash) ?? { copies: 0 };
    if (mine.best === 'god') continue; // already have it
    const source = manifest.sources?.[hash];
    const vendor = vendorBy.get(hash);
    if (source && UNFARMABLE.test(source) && !vendor) continue;
    const seen = input.seen?.[hash] ?? 0;
    // Worth listing when you already chase it (own a copy), can buy it now, or players use it.
    if (!mine.copies && !vendor && seen < MIN_SEEN) continue;

    const nameOf = (h: number) => manifest.items[h]?.displayProperties?.name;
    const best = gods[0]!;
    const uses = new Set(gods.map(useOf));
    const use: RollUse = uses.has('both') || (uses.has('pve') && uses.has('pvp')) ? 'both' : uses.has('pvp') ? 'pvp' : 'pve';
    const perks = best.perks.map(nameOf).filter((n): n is string => !!n && !/masterwork/i.test(n));
    const why = vendor?.god ? 'The copy on sale is a god roll.'
      : vendor ? 'The copy on sale isn\'t the god roll, so check it before you buy.'
      : mine.copies ? `You have ${mine.copies === 1 ? 'a copy' : `${mine.copies} copies`}, but not the god roll.`
      : `Popular: ${seen.toLocaleString()} copies seen in public matches.`;
    // Buyable god rolls first, then any vendor offer, then weapons you already chase, then popularity.
    const score = (vendor?.god ? 4e6 : 0) + (vendor ? 2e6 : 0) + (mine.copies ? 1e6 : 0) + Math.min(seen, 999_999);
    const tier = def.inventory?.tierTypeName ?? '';
    const damage = def.defaultDamageTypeHash ? input.manifest.damageTypes?.[def.defaultDamageTypeHash]?.displayProperties.name : undefined;
    const t: FarmTarget & { score: number } = {
      itemHash: hash,
      name: def.displayProperties.name,
      type: def.itemTypeDisplayName ?? '',
      tier,
      roll: { perks, use, ...(tidyNotes(best.notes) ? { notes: tidyNotes(best.notes) } : {}) },
      godRolls: gods.length,
      owned: mine,
      why,
      score,
    };
    const icon = bungieUrl(def.displayProperties.icon);
    if (icon) t.icon = icon;
    const watermark = bungieUrl(def.iconWatermark);
    if (watermark) t.watermark = watermark;
    if (damage) t.damage = damage;
    if (source) t.source = source;
    if (vendor) t.vendor = vendor;
    if (seen) t.seen = seen;
    out.push(t);
  }
  // Everything on sale, then a share for weapons you chase and a share for popular ones you've never
  // had, so neither crowds the other out.
  const limit = input.limit ?? 80;
  const sorted = out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const sale = sorted.filter((t) => t.vendor);
  const chased = sorted.filter((t) => !t.vendor && t.owned.copies);
  const fresh = sorted.filter((t) => !t.vendor && !t.owned.copies);
  const room = Math.max(0, limit - sale.length);
  const freshShare = Math.min(fresh.length, Math.max(room - chased.length, Math.floor(room * 0.4)));
  return [...sale, ...chased.slice(0, room - freshShare), ...fresh.slice(0, freshShare)]
    .slice(0, limit)
    .map(({ score: _score, ...t }) => t);
}

/** Short place name for grouping: "Vault of Glass" Raid → Vault of Glass raid. */
export function sourceGroup(source?: string): string {
  if (!source) return 'Other';
  const quoted = /^"([^"]+)"\s+(Raid|Dungeon)/i.exec(source);
  if (quoted) return `${quoted[1]} ${quoted[2]!.toLowerCase()}`;
  // "Complete strikes and earn rank-up packages from Commander Zavala." → Commander Zavala.
  const packages = /rank-up packages (?:from|on) ([^.]+)/i.exec(source);
  if (packages) return packages[1]!.trim();
  if (/legendary engrams/i.test(source)) return 'Legendary engrams';
  if (/^(acquired from )?x[uû]r/i.test(source)) return 'Xûr';
  return source.replace(/^Acquired from\s+/i, '').replace(/\.$/, '').split(/[.;]/)[0]!.trim();
}
