// Popular builds, and which of your armor pieces are best in slot for them. Cleanup keeps those
// pieces out of the junk list and says which activities they're for.
//
// The builds are a curated, editable list: Bungie's API has no "popular builds" feed, and the
// community sites that publish builds aren't open data. The starting list below is a snapshot of
// well-known builds per activity; the server saves your edits in .data/builds.json.
import type { ItemRow } from './vault.ts';
import type { ArmorSet } from './manifest.ts';
import { ARMOR_BUCKETS, ARMOR_SLOT_NAMES, ARMOR_STATS, baseStats, type ArmorStat } from './optimizer.ts';

/** Where a build is played. Endgame: Grandmasters, raids, dungeons. Casual: patrols, Lost Sector farming. */
export type BuildActivity = 'endgame' | 'pvp' | 'casual';
export const BUILD_ACTIVITIES: BuildActivity[] = ['endgame', 'pvp', 'casual'];
export const ACTIVITY_LABEL: Record<BuildActivity, string> = { endgame: 'Endgame', pvp: 'PvP', casual: 'Casual' };

export interface PopularBuild {
  id: string;
  name: string;
  /** 0 Titan, 1 Hunter, 2 Warlock. */
  classType: number;
  activities: BuildActivity[];
  /** The exotic armor it's built around, by name. Optional: some builds are set or stat builds. */
  exotic?: string;
  /** An armor set it wants (by name): pieces of that set win their slot when you own one. */
  set?: string;
  /** The stats it wants, most important first. The first three count (3x, 2x, 1x). */
  stats: ArmorStat[];
  /** Off builds are kept in the list but don't protect anything. */
  off?: boolean;
  /** Added from the community crawl's suggestions (see build-usage.ts). */
  source?: 'community';
}

/** The starting list: four well-known builds per class, spread across endgame, PvP, and casual. */
export const DEFAULT_BUILDS: PopularBuild[] = [
  { id: 'titan-synthoceps', name: 'Synthoceps melee', classType: 0, activities: ['endgame', 'casual'], exotic: 'Synthoceps', stats: ['Melee', 'Health', 'Class'] },
  { id: 'titan-pyrogale', name: 'Pyrogale Burning Maul', classType: 0, activities: ['endgame'], exotic: 'Pyrogale Gauntlets', stats: ['Super', 'Melee', 'Health'] },
  { id: 'titan-inmost', name: 'Heart of Inmost Light', classType: 0, activities: ['endgame', 'casual'], exotic: 'Heart of Inmost Light', stats: ['Class', 'Grenade', 'Melee'] },
  { id: 'titan-one-eyed', name: 'One-Eyed Mask', classType: 0, activities: ['pvp'], exotic: 'One-Eyed Mask', stats: ['Weapons', 'Health', 'Class'] },
  { id: 'hunter-gyrfalcon', name: 'Gyrfalcon\'s Void', classType: 1, activities: ['endgame', 'casual'], exotic: 'Gyrfalcon\'s Hauberk', stats: ['Class', 'Weapons', 'Health'] },
  { id: 'hunter-nighthawk', name: 'Celestial Nighthawk', classType: 1, activities: ['endgame'], exotic: 'Celestial Nighthawk', stats: ['Super', 'Weapons', 'Health'] },
  { id: 'hunter-cowl', name: 'Assassin\'s Cowl', classType: 1, activities: ['casual'], exotic: 'Assassin\'s Cowl', stats: ['Melee', 'Class', 'Health'] },
  { id: 'hunter-stompees', name: 'St0mp-EE5', classType: 1, activities: ['pvp'], exotic: 'St0mp-EE5', stats: ['Weapons', 'Health', 'Class'] },
  { id: 'warlock-getaway', name: 'Getaway Artist', classType: 2, activities: ['endgame', 'casual'], exotic: 'Getaway Artist', stats: ['Grenade', 'Class', 'Health'] },
  { id: 'warlock-speaker', name: 'Speaker\'s Sight healing', classType: 2, activities: ['endgame'], exotic: 'Speaker\'s Sight', stats: ['Grenade', 'Health', 'Class'] },
  { id: 'warlock-sunbracers', name: 'Sunbracers', classType: 2, activities: ['casual'], exotic: 'Sunbracers', stats: ['Grenade', 'Melee', 'Health'] },
  { id: 'warlock-transversive', name: 'Transversive Steps', classType: 2, activities: ['pvp'], exotic: 'Transversive Steps', stats: ['Weapons', 'Health', 'Class'] },
];

/** Keeps only well-formed builds, so a hand-edited file can't break cleanup. */
export function cleanBuilds(input: unknown): PopularBuild[] {
  if (!Array.isArray(input)) return [];
  const out: PopularBuild[] = [];
  const ids = new Set<string>();
  for (const b of input as Partial<PopularBuild>[]) {
    if (!b || typeof b !== 'object' || typeof b.name !== 'string' || !b.name.trim()) continue;
    if (![0, 1, 2].includes(b.classType as number)) continue;
    const stats = (Array.isArray(b.stats) ? b.stats : []).filter((s): s is ArmorStat => ARMOR_STATS.includes(s as ArmorStat));
    const activities = (Array.isArray(b.activities) ? b.activities : []).filter((a): a is BuildActivity => BUILD_ACTIVITIES.includes(a as BuildActivity));
    if (!stats.length || !activities.length) continue;
    let id = typeof b.id === 'string' && b.id.trim() ? b.id.trim().slice(0, 64) : `build-${out.length + 1}`;
    while (ids.has(id)) id += '-2';
    ids.add(id);
    out.push({
      id, name: b.name.trim().slice(0, 80), classType: b.classType!, activities: [...new Set(activities)],
      ...(typeof b.exotic === 'string' && b.exotic.trim() ? { exotic: b.exotic.trim().slice(0, 80) } : {}),
      ...(typeof b.set === 'string' && b.set.trim() ? { set: b.set.trim().slice(0, 80) } : {}),
      stats: [...new Set(stats)].slice(0, 6),
      ...(b.off ? { off: true } : {}),
      ...(b.source === 'community' ? { source: 'community' as const } : {}),
    });
  }
  return out.slice(0, 100);
}

/** One build a piece is best in slot for. */
export interface BuildFit {
  buildId: string;
  build: string;
  activities: BuildActivity[];
  slot: (typeof ARMOR_SLOT_NAMES)[number];
  /** True when this piece is the build's exotic. */
  exotic: boolean;
}

type Armor = Pick<ItemRow, 'instanceId' | 'itemHash' | 'name' | 'tier' | 'classType' | 'itemType' | 'bucketHash' | 'stats' | 'statDetails' | 'setHash' | 'gearTier' | 'locked' | 'equipped' | 'power'>;

const WEIGHTS = [3, 2, 1];
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** How well a piece's rolled stats suit a build: its wanted stats, weighted 3, 2, 1. */
export function buildScore(piece: Pick<ItemRow, 'stats' | 'statDetails'>, build: Pick<PopularBuild, 'stats'>): number {
  const base = baseStats(piece);
  return build.stats.slice(0, 3).reduce((a, s, i) => a + base[ARMOR_STATS.indexOf(s)]! * WEIGHTS[i]!, 0);
}

/** Ties go to the higher tier, then more total stats, then the one you've locked or are wearing. */
const tiebreak = (a: Armor, b: Armor) =>
  (b.gearTier ?? 0) - (a.gearTier ?? 0)
  || baseStats(b).reduce((x, y) => x + y, 0) - baseStats(a).reduce((x, y) => x + y, 0)
  || Number(b.locked || b.equipped) - Number(a.locked || a.equipped)
  || (b.power ?? 0) - (a.power ?? 0)
  || (a.instanceId ?? '').localeCompare(b.instanceId ?? '');

/**
 * For each build, the one piece per slot that suits it best: the build's exotic (best copy) in its
 * slot, and the best legendary in each other slot. A build that names a set uses that set's pieces
 * where you own one. Returns the fits by instance id.
 */
export function bestInSlot(items: Armor[], builds: PopularBuild[], sets: Record<string, ArmorSet> = {}): Map<string, BuildFit[]> {
  const out = new Map<string, BuildFit[]>();
  const armor = items.filter((i) => i.itemType === 2 && i.instanceId && i.stats && Object.keys(i.stats).length > 0);
  const setName = (i: Armor) => (i.setHash ? sets[i.setHash]?.name : undefined);
  const add = (piece: Armor, b: PopularBuild, si: number, exotic: boolean) => {
    const fit: BuildFit = { buildId: b.id, build: b.name, activities: b.activities, slot: ARMOR_SLOT_NAMES[si]!, exotic };
    out.set(piece.instanceId!, [...(out.get(piece.instanceId!) ?? []), fit]);
  };
  const best = (list: Armor[], b: PopularBuild) =>
    [...list].sort((x, y) => buildScore(y, b) - buildScore(x, b) || tiebreak(x, y))[0];

  for (const b of builds) {
    if (b.off) continue;
    const mine = armor.filter((i) => i.classType === b.classType || i.classType === 3);
    const exotics = b.exotic ? mine.filter((i) => i.tier === 'Exotic' && norm(i.name) === norm(b.exotic!)) : [];
    const exoticSlot = exotics.length ? ARMOR_BUCKETS.indexOf(exotics[0]!.bucketHash as (typeof ARMOR_BUCKETS)[number]) : -1;
    ARMOR_BUCKETS.forEach((bucket, si) => {
      if (si === exoticSlot) {
        const pick = best(exotics, b);
        if (pick) add(pick, b, si, true);
        return;
      }
      const legendaries = mine.filter((i) => i.bucketHash === bucket && i.tier !== 'Exotic');
      const inSet = b.set ? legendaries.filter((i) => norm(setName(i) ?? '') === norm(b.set!)) : [];
      const pick = best(inSet.length ? inSet : legendaries, b);
      if (pick) add(pick, b, si, false);
    });
  }
  return out;
}

/** The activities a list of fits covers, in the usual order. */
export const fitActivities = (fits: BuildFit[]) => BUILD_ACTIVITIES.filter((a) => fits.some((f) => f.activities.includes(a)));
