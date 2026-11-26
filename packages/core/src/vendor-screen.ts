// The Vendors screen: every vendor a character can visit, grouped the way the game groups them
// (Tower, destinations...), with what each sells, what it costs, whether you can afford it, and
// whether you already own it. Pure logic; the server feeds it one character's vendor response,
// trimmed vendor definitions, your balances, and collection state.
import type { DestinyVendorsResponse } from 'bungie-api-ts/destiny2';
import type { ManifestTables } from './manifest.ts';
import { bungieUrl } from './vault.ts';

/** The parts of DestinyVendorDefinition the screen reads (the full one is large). */
export interface VendorInfo {
  name: string;
  subtitle?: string;
  icon?: string;
  /** Vendor group (Tower, Destinations...) from the definition, when the response doesn't place it. */
  groupHash?: number;
  /** Destination names, by the response's vendorLocationIndex. */
  locations: (string | undefined)[];
  /** Display category names, by index ("Weapon Ornament", "Bounties"...). */
  categories: string[];
  /** Why a sale can't be bought, by failure index. */
  failures: string[];
  /** Display category indexes that aren't for sale: the vendor's help page, intro steps, unnamed rows. */
  hiddenCategories?: number[];
}

/**
 * Category identifiers that hold no sales: a vendor's help page ("xur_help_name", "crucible.help.name")
 * and its intro quest steps. Checked against the live manifest.
 */
const HIDDEN_VENDOR_CATEGORY = /(^|[._])help([._]|$)|^intro_step/;

/** Whether a display category is for show only (help page, intro step, or a nameless spacer row). */
export const hiddenVendorCategory = (c: { identifier?: string; displayProperties?: { name?: string } }) =>
  HIDDEN_VENDOR_CATEGORY.test(c.identifier ?? '') || (!c.identifier && !c.displayProperties?.name);
/** DestinyItemType.None: placeholder sales (a sub-page link, the vendor's own portrait). */
const ITEM_TYPE_NONE = 0;

export interface VendorGroupInfo { name: string; order: number }

/** A reputation ladder (Vanguard, Gunsmith...): step names and sizes. */
export interface RankInfo { name: string; steps: { name: string; total: number }[] }

export interface VendorCost {
  itemHash: number;
  name: string;
  icon?: string;
  quantity: number;
  /** How many you hold now; absent when it isn't counted (some currencies live elsewhere). */
  have?: number;
}

export interface VendorSale {
  /** Vendor item index (stable within a reset). */
  index: number;
  itemHash: number;
  name: string;
  icon?: string;
  watermark?: string;
  tier?: string;
  /** e.g. "Hand Cannon", "Weapon Ornament", "Bounty". */
  type?: string;
  /** 3 weapon, 2 armor, else something else (see DestinyItemType). */
  itemType?: number;
  quantity: number;
  costs: VendorCost[];
  /** At least one cost is more than you hold. */
  short?: boolean;
  /** Collected, or the game marks it owned. Absent when ownership doesn't apply. */
  owned?: boolean;
  /** Why it can't be bought right now ("Requires rank 10"). */
  failure?: string;
  /** Paid in silver (Eververse). */
  silver?: boolean;
  /** Matches a rolled-item row (`vendor-<vendor>-<index>`) with perks or stats, for grades and the item dialog. */
  rowId?: string;
}

export interface VendorCategory { name: string; sales: VendorSale[] }

export interface VendorRank {
  name: string;
  /** Current step's name ("Legend"). */
  rank: string;
  step: number;
  steps: number;
  progress: number;
  next: number;
  resets: number;
}

export interface VendorCard {
  hash: number;
  name: string;
  subtitle?: string;
  icon?: string;
  location?: string;
  /** When its stock changes next. */
  refreshesAt?: string;
  rank?: VendorRank;
  categories: VendorCategory[];
}

export interface VendorGroupView { hash: number; name: string; vendors: VendorCard[] }

export const SILVER_HASH = 3147280338;
/** DestinyVendorItemState.Owned, set on sales the game knows you have. */
const STATE_OWNED = 128;
/** DestinyCollectibleState.NotAcquired. */
const NOT_ACQUIRED = 1;

export interface VendorScreenInput {
  vendors: DestinyVendorsResponse;
  manifest: Pick<ManifestTables, 'items'>;
  info: (vendorHash: number) => VendorInfo | undefined;
  group: (groupHash: number) => VendorGroupInfo | undefined;
  rank?: (progressionHash: number) => RankInfo | undefined;
  /** What you hold, by item hash (currencies and materials). */
  balances: Map<number, number>;
  /** Collectible states by collectible hash (profile and character merged). */
  collectibles?: Record<string, { state: number }>;
  /** Ids of rolled-item rows that exist (`vendor-<vendor>-<index>`). */
  rowIds?: Set<string>;
  /**
   * The vendor a sale opens instead of being bought (its item's preview vendor), such as
   * Zavala's "Weapons" page. Those pages' stock is folded into the vendor that links to them.
   */
  links?: (itemHash: number) => number | undefined;
}

/**
 * Vendors in the game's group order, each with its sales sorted into its display categories.
 * Vendors with nothing on sale (and no rank to show) are left out.
 */
export function vendorScreen(input: VendorScreenInput): VendorGroupView[] {
  const { vendors: res, manifest } = input;
  const comps = res.vendors?.data ?? {};
  const sales = res.sales?.data ?? {};
  const cats = res.categories?.data ?? {};
  const groupsOut: VendorGroupView[] = [];
  const placed = new Set<number>();

  // Sub-pages: a sale whose item opens another vendor in this response. The page shows inside
  // the vendor that links to it, under the link's name, and never on its own.
  const subPages = new Map<number, { vendor: number; label: string }[]>();
  const isSubPage = new Set<number>();
  if (input.links) {
    for (const [vh, s] of Object.entries(sales)) {
      for (const sale of Object.values(s.saleItems ?? {})) {
        const target = input.links(sale.itemHash);
        if (!target || target === Number(vh) || !comps[target]) continue;
        const label = manifest.items[sale.itemHash]?.displayProperties.name || 'More';
        const list = subPages.get(Number(vh)) ?? [];
        if (!list.some((x) => x.vendor === target)) list.push({ vendor: target, label });
        subPages.set(Number(vh), list);
        isSubPage.add(target);
      }
    }
  }
  const building = new Set<number>();

  const card = (vendorHash: number): VendorCard | undefined => {
    const v = comps[vendorHash];
    const info = input.info(vendorHash);
    if (!v || !info || v.enabled === false) return undefined;
    const saleItems = sales[vendorHash]?.saleItems ?? {};
    const byIndex = new Map(Object.values(saleItems).map((s) => [s.vendorItemIndex, s]));
    const categories: VendorCategory[] = [];
    const used = new Set<number>();
    const hidden = new Set(info.hiddenCategories ?? []);
    const toSale = (index: number): VendorSale | undefined => {
      const s = byIndex.get(index);
      if (!s) return undefined;
      const def = manifest.items[s.itemHash];
      const name = def?.displayProperties.name;
      if (!name) return undefined; // hidden or classified entries
      used.add(index);
      // A link to a sub-page shows as that page's stock; a free placeholder with no type is noise.
      if (input.links?.(s.itemHash)) return undefined;
      if (def.itemType === ITEM_TYPE_NONE && !def.itemTypeDisplayName && !(s.costs ?? []).some((c) => c.quantity > 0)) return undefined;
      const costs: VendorCost[] = (s.costs ?? []).filter((c) => c.quantity > 0).map((c) => {
        const cd = manifest.items[c.itemHash];
        return { itemHash: c.itemHash, name: cd?.displayProperties.name || 'Currency', icon: bungieUrl(cd?.displayProperties.icon), quantity: c.quantity, have: input.balances.get(c.itemHash) };
      });
      const collectible = def.collectibleHash ? input.collectibles?.[def.collectibleHash] : undefined;
      const owned = collectible ? (collectible.state & NOT_ACQUIRED) === 0 : (s.augments & STATE_OWNED) !== 0 ? true : undefined;
      const failure = s.failureIndexes?.map((i) => info.failures[i]).find(Boolean);
      const rowId = `vendor-${vendorHash}-${index}`;
      return {
        index, itemHash: s.itemHash, name,
        icon: bungieUrl(def.displayProperties.icon), watermark: bungieUrl(def.iconWatermark),
        tier: def.inventory?.tierTypeName || undefined, type: def.itemTypeDisplayName || undefined, itemType: def.itemType,
        quantity: s.quantity,
        costs,
        ...(costs.some((c) => c.have !== undefined && c.have < c.quantity) ? { short: true } : {}),
        ...(owned !== undefined ? { owned } : {}),
        ...(failure ? { failure } : {}),
        ...(costs.some((c) => c.itemHash === SILVER_HASH) ? { silver: true } : {}),
        ...(input.rowIds?.has(rowId) ? { rowId } : {}),
      };
    };
    // The response lists each category's sale indexes in the game's order.
    for (const c of cats[vendorHash]?.categories ?? []) {
      if (hidden.has(c.displayCategoryIndex)) { c.itemIndexes.forEach((i) => used.add(i)); continue; }
      const list = c.itemIndexes.map(toSale).filter((x): x is VendorSale => !!x);
      if (list.length) categories.push({ name: info.categories[c.displayCategoryIndex] || 'Offers', sales: list });
    }
    // Anything on sale but in no category still shows.
    const rest = [...byIndex.keys()].filter((i) => !used.has(i)).sort((a, b) => a - b).map(toSale).filter((x): x is VendorSale => !!x);
    if (rest.length) categories.push({ name: 'Offers', sales: rest });
    // Sub-pages' stock, under the link's name ("Weapons"), or "Weapons · Kinetic" when it has several.
    if (!building.has(vendorHash)) {
      building.add(vendorHash);
      for (const sub of subPages.get(vendorHash) ?? []) {
        const child = card(sub.vendor);
        if (!child) continue;
        for (const c of child.categories) {
          const name = child.categories.length === 1 || c.name === sub.label ? sub.label : `${sub.label} · ${c.name}`;
          const existing = categories.find((x) => x.name === name);
          if (existing) existing.sales.push(...c.sales);
          else categories.push({ name, sales: c.sales });
        }
      }
      building.delete(vendorHash);
    }

    let rank: VendorRank | undefined;
    if (v.progression?.progressionHash && input.rank) {
      const r = input.rank(v.progression.progressionHash);
      const p = v.progression;
      if (r && r.steps.length) {
        const step = Math.min(p.level, r.steps.length - 1);
        rank = {
          name: r.name, rank: r.steps[step]?.name ?? '', step: step + 1, steps: r.steps.length,
          progress: p.progressToNextLevel, next: p.nextLevelAt, resets: p.currentResetCount ?? 0,
        };
      }
    }
    if (!categories.length && !rank) return undefined;
    return {
      hash: vendorHash, name: info.name, subtitle: info.subtitle, icon: info.icon,
      location: info.locations[v.vendorLocationIndex] ?? info.locations[0],
      refreshesAt: v.nextRefreshDate && !v.nextRefreshDate.startsWith('9999') ? v.nextRefreshDate : undefined,
      ...(rank ? { rank } : {}),
      categories,
    };
  };

  for (const h of isSubPage) placed.add(h);
  for (const g of res.vendorGroups?.data?.groups ?? []) {
    const list = g.vendorHashes.filter((h) => !isSubPage.has(h)).map((h) => { placed.add(h); return card(h); }).filter((x): x is VendorCard => !!x);
    if (!list.length) continue;
    groupsOut.push({ hash: g.vendorGroupHash, name: input.group(g.vendorGroupHash)?.name ?? 'Vendors', vendors: list });
  }
  // Vendors the response didn't place in a group go by their definition's group.
  const loose = new Map<number, VendorCard[]>();
  for (const h of Object.keys(comps).map(Number)) {
    if (placed.has(h)) continue;
    const c = card(h);
    if (!c) continue;
    const gh = input.info(h)?.groupHash ?? 0;
    loose.set(gh, [...(loose.get(gh) ?? []), c]);
  }
  for (const [gh, list] of loose) {
    const existing = groupsOut.find((g) => g.hash === gh);
    if (existing) existing.vendors.push(...list);
    else groupsOut.push({ hash: gh, name: input.group(gh)?.name ?? 'Other vendors', vendors: list });
  }
  return groupsOut;
}

export interface VendorFilters {
  /** Hide what you already own (only items where ownership applies are judged). */
  unowned?: boolean;
  /** Hide Eververse silver items. */
  noSilver?: boolean;
  /** Case-insensitive match on item name, type, vendor, or category. */
  query?: string;
  /** Only sales of these item types (3 weapon, 2 armor). */
  itemTypes?: number[];
}

/** Applies the screen's filters; empty categories and vendors drop out. */
export function filterVendors(groups: VendorGroupView[], f: VendorFilters): VendorGroupView[] {
  const q = f.query?.trim().toLowerCase();
  const out: VendorGroupView[] = [];
  for (const g of groups) {
    const vendors: VendorCard[] = [];
    for (const v of g.vendors) {
      const vendorHit = !!q && `${v.name} ${v.location ?? ''}`.toLowerCase().includes(q);
      const categories = v.categories.map((c) => {
        const catHit = vendorHit || (!!q && c.name.toLowerCase().includes(q));
        return {
          ...c,
          sales: c.sales.filter((s) =>
            !(f.unowned && s.owned)
            && !(f.noSilver && s.silver)
            && (!f.itemTypes || f.itemTypes.includes(s.itemType ?? -1))
            && (!q || catHit || `${s.name} ${s.type ?? ''}`.toLowerCase().includes(q))),
        };
      }).filter((c) => c.sales.length);
      // Without filters a rank-only vendor still shows; with them, only vendors with matches do.
      const filtering = f.unowned || f.noSilver || !!q || !!f.itemTypes;
      if (categories.length || (!filtering && v.rank) || (vendorHit && v.rank)) vendors.push({ ...v, categories });
    }
    if (vendors.length) out.push({ ...g, vendors });
  }
  return out;
}

/** Balances by item hash from a profile: profile currencies plus stacks in the vault and on characters. */
export function balancesFrom(profile: {
  profileCurrencies?: { data?: { items?: { itemHash: number; quantity: number }[] } };
  profileInventory?: { data?: { items?: { itemHash: number; quantity: number }[] } };
  characterInventories?: { data?: Record<string, { items?: { itemHash: number; quantity: number }[] }> };
  characterCurrencyLookups?: { data?: Record<string, { itemQuantities?: Record<string, number> }> };
}, characterId?: string): Map<number, number> {
  const out = new Map<number, number>();
  const add = (h: number, q: number) => out.set(h, (out.get(h) ?? 0) + q);
  for (const i of profile.profileCurrencies?.data?.items ?? []) add(i.itemHash, i.quantity);
  for (const i of profile.profileInventory?.data?.items ?? []) add(i.itemHash, i.quantity);
  for (const inv of Object.values(profile.characterInventories?.data ?? {})) for (const i of inv.items ?? []) add(i.itemHash, i.quantity);
  // The game's own count for the character, where given, wins (it includes things we don't list).
  const lookup = characterId ? profile.characterCurrencyLookups?.data?.[characterId]?.itemQuantities : undefined;
  for (const [h, q] of Object.entries(lookup ?? {})) out.set(Number(h), q);
  return out;
}
