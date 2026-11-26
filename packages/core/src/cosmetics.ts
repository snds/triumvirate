// The Cosmetics tab in Records: Ghost shells, ships, sparrows, and shaders from your collections,
// owned or missing. Pure: the server hands in the manifest and the collectible states.
import type { ManifestTables } from './manifest.ts';

export type CosmeticKind = 'ghost' | 'ship' | 'sparrow' | 'shader';
export const COSMETIC_KINDS: CosmeticKind[] = ['ghost', 'ship', 'sparrow', 'shader'];
export const COSMETIC_LABEL: Record<CosmeticKind, string> = { ghost: 'Ghost shells', ship: 'Ships', sparrow: 'Sparrows', shader: 'Shaders' };

export interface Cosmetic {
  itemHash: number;
  name: string;
  kind: CosmeticKind;
  /** 96 px icon; `highRes` is the larger tile art when Bungie has it. */
  icon?: string;
  highRes?: string;
  /** 1920×1080 studio render (not for shaders). */
  render?: string;
  tier?: string;
  owned: boolean;
  /** "Eververse", "Complete the Vow of the Disciple raid"… */
  source?: string;
}

/** DestinyCollectibleState flags. */
const NOT_ACQUIRED = 1;
const INVISIBLE = 4;
/** ItemSubType.Shader. */
const SHADER = 20;
const url = (p?: string) => (p ? `https://www.bungie.net${p}` : undefined);

const kindOf = (itemType?: number, subType?: number): CosmeticKind | undefined =>
  itemType === 24 ? 'ghost' : itemType === 21 ? 'ship' : itemType === 22 ? 'sparrow' : subType === SHADER ? 'shader' : undefined;

/**
 * Every collectible ghost, ship, sparrow, and shader, once each (by collectible), with whether you
 * own it. Hidden collectibles (retired, unreleased) are left out. Owned first, then rarer first,
 * then by name, so the grid opens on the good stuff.
 */
export function cosmetics(
  manifest: Pick<ManifestTables, 'items'> & Partial<Pick<ManifestTables, 'extras' | 'sources'>>,
  collectibles: Record<string, { state: number }>,
): Cosmetic[] {
  const seen = new Set<number>();
  const out: Cosmetic[] = [];
  for (const [key, d] of Object.entries(manifest.items)) {
    const kind = kindOf(d.itemType, d.itemSubType);
    const ch = d.collectibleHash;
    if (!kind || !ch || seen.has(ch) || !d.displayProperties?.name) continue;
    const c = collectibles[ch];
    if (!c || c.state & INVISIBLE) continue;
    seen.add(ch);
    const hash = Number(key);
    const dp = d.displayProperties as { name: string; icon?: string; highResIcon?: string };
    out.push({
      itemHash: hash, name: dp.name, kind,
      ...(dp.icon ? { icon: url(dp.icon) } : {}),
      ...(dp.highResIcon ? { highRes: url(dp.highResIcon) } : {}),
      ...(manifest.extras?.[hash]?.screenshot ? { render: url(manifest.extras[hash]!.screenshot) } : {}),
      ...(d.inventory?.tierTypeName ? { tier: d.inventory.tierTypeName } : {}),
      owned: !(c.state & NOT_ACQUIRED),
      ...(manifest.sources?.[hash] ? { source: manifest.sources[hash] } : {}),
    });
  }
  const tierRank = (t?: string) => ({ Exotic: 0, Legendary: 1, Rare: 2, Uncommon: 3, Common: 4 } as Record<string, number>)[t ?? ''] ?? 5;
  return out.sort((a, b) => Number(b.owned) - Number(a.owned) || tierRank(a.tier) - tierRank(b.tier) || a.name.localeCompare(b.name));
}
