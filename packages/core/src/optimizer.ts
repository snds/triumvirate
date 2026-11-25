// Build optimizer: picks the five armor pieces (and the stat mods on them) that best hit your stat
// targets. Pure and browser-safe, so the web app runs it on the device and the chat can run it too.
import type { ItemRow } from './vault.ts';
import type { ArmorSet } from './manifest.ts';

/** Armor 3.0 character stats, in the game's order. */
export const ARMOR_STATS = ['Weapons', 'Health', 'Class', 'Grenade', 'Super', 'Melee'] as const;
export type ArmorStat = (typeof ARMOR_STATS)[number];
/** Armor 3.0 stats run from 0 to 200; points past 200 do nothing. */
export const STAT_MAX = 200;
/** A major stat mod adds 10 to one stat. */
export const MOD_SIZE = 10;
/** Helmet, gauntlets, chest, legs, class item: in game order. */
export const ARMOR_BUCKETS = [3448274439, 3551918588, 14239492, 20886954, 1585787867] as const;
export const ARMOR_SLOT_NAMES = ['Helmet', 'Gauntlets', 'Chest', 'Legs', 'Class item'] as const;

export type OptimizerItem = Pick<ItemRow, 'instanceId' | 'itemHash' | 'name' | 'tier' | 'classType' | 'itemType' | 'bucketHash' | 'stats' | 'statDetails' | 'setHash' | 'owner' | 'equipped'>;

export interface OptimizerInput {
  items: OptimizerItem[];
  /** 0 Titan, 1 Hunter, 2 Warlock. */
  classType: number;
  /** Lowest value wanted for each stat (0-200). Unlisted stats have no minimum. */
  targets: Partial<Record<ArmorStat, number>>;
  /** Stats in order of importance: decides how leftover mods and points are valued. */
  priority?: ArmorStat[];
  /** 'any' allows at most one exotic, 'none' allows none, a number requires that exotic (item hash). */
  exotic?: 'any' | 'none' | number;
  /** Require this many pieces (2 or 4) of an armor set. */
  set?: { hash: number; pieces: number };
  /** How many +10 stat mods to plan (one per piece, so 0-5). */
  modSlots?: number;
  /** How many results to return. */
  limit?: number;
}

export interface OptimizerPiece {
  instanceId: string;
  itemHash: number;
  name: string;
  slot: (typeof ARMOR_SLOT_NAMES)[number];
  exotic: boolean;
  /** Stats as the piece rolled, before mods, masterwork, and tuning. */
  stats: number[];
}

export interface OptimizerResult {
  pieces: OptimizerPiece[];
  /** Sum of the pieces' base stats, in ARMOR_STATS order. */
  base: number[];
  /** Stat mods to slot: how many +10 mods go to each stat, in ARMOR_STATS order. */
  mods: number[];
  /** Base plus mods. Masterwork and tuning come on top in game. */
  total: number[];
  /** Points over 200 that do nothing. */
  wasted: number;
  score: number;
  /** Sets with 2+ pieces in this combination. */
  sets: { hash: number; name?: string; count: number }[];
}

export interface OptimizerOutput {
  results: OptimizerResult[];
  /** Combinations checked. */
  checked: number;
  /** Candidates per slot after dropping pieces another piece beats in every stat. */
  candidates: number[];
  /** Why nothing came back, when nothing did. */
  reason?: string;
  /** True when the search stopped at its safety limit before trying everything. */
  truncated?: boolean;
}

interface Cand {
  piece: OptimizerPiece;
  set?: number;
}

const MAX_CHECKS = 20_000_000;

/** A piece's stats before mods, masterwork, and tuning: what it rolled with. */
export function baseStats(item: Pick<ItemRow, 'stats' | 'statDetails'>): number[] {
  return ARMOR_STATS.map((name) => {
    const d = item.statDetails?.find((s) => s.name === name);
    if (d) return Math.max(0, d.value - d.bonus);
    return item.stats?.[name] ?? 0;
  });
}

/** True when `b` is at least as good as `a` in every stat. */
const covers = (b: number[], a: number[]) => a.every((v, i) => b[i]! >= v);

/**
 * Keeps only pieces no other piece beats in every stat. Pieces are only compared with ones that
 * play the same part (the same exotic, or legendaries; in the wanted set or not), so dropping one
 * never removes an option the constraints need.
 */
function prune(cands: Cand[], key: (c: Cand) => string): Cand[] {
  const groups = new Map<string, Cand[]>();
  for (const c of cands) {
    const k = key(c);
    const g = groups.get(k);
    if (g) g.push(c); else groups.set(k, [c]);
  }
  const out: Cand[] = [];
  for (const g of groups.values()) {
    // Highest totals first, so a piece only needs checking against those already kept.
    g.sort((a, b) => sum(b.piece.stats) - sum(a.piece.stats));
    const kept: Cand[] = [];
    for (const c of g) if (!kept.some((k) => covers(k.piece.stats, c.piece.stats))) kept.push(c);
    out.push(...kept);
  }
  return out;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Finds the armor combinations that meet the targets with the fewest mods, best first. */
export function optimizeArmor(input: OptimizerInput, sets?: Record<string, ArmorSet>): OptimizerOutput {
  const modSlots = Math.max(0, Math.min(5, input.modSlots ?? 5));
  const limit = input.limit ?? 20;
  const exotic = input.exotic ?? 'any';
  const targets = ARMOR_STATS.map((s) => Math.max(0, Math.min(STAT_MAX, Math.round(input.targets[s] ?? 0))));
  const priority = [...(input.priority ?? []), ...ARMOR_STATS].filter((s, i, a) => a.indexOf(s) === i);
  // Most important stat counts double, the least important counts once.
  const weight = ARMOR_STATS.map((s) => 1 + (ARMOR_STATS.length - 1 - priority.indexOf(s)) / (ARMOR_STATS.length - 1));
  const wantSet = input.set && input.set.pieces > 0 ? input.set : undefined;

  const slots: Cand[][] = ARMOR_BUCKETS.map((bucket, si) => {
    const all = input.items
      .filter((i) => i.itemType === 2 && i.bucketHash === bucket && i.instanceId && (i.classType === input.classType || i.classType === 3))
      .map((i): Cand => ({
        piece: { instanceId: i.instanceId!, itemHash: i.itemHash, name: i.name, slot: ARMOR_SLOT_NAMES[si]!, exotic: i.tier === 'Exotic', stats: baseStats(i) },
        set: i.setHash,
      }))
      .filter((c) => {
        if (!c.piece.exotic) return true;
        if (exotic === 'none') return false;
        return exotic === 'any' || c.piece.itemHash === exotic;
      });
    return prune(all, (c) => `${c.piece.exotic ? c.piece.itemHash : 'L'}|${wantSet && c.set === wantSet.hash ? 'S' : ''}`);
  });
  const candidates = slots.map((s) => s.length);
  const missing = slots.findIndex((s) => s.length === 0);
  if (missing >= 0) return { results: [], checked: 0, candidates, reason: `No ${ARMOR_SLOT_NAMES[missing]!.toLowerCase()} fits these choices.` };
  if (typeof exotic === 'number' && !slots.some((s) => s.some((c) => c.piece.itemHash === exotic))) {
    return { results: [], checked: 0, candidates, reason: 'You don\'t have that exotic for this class.' };
  }

  // Best possible stat from the slots still to fill, to give up early on hopeless branches.
  const ahead: number[][] = Array.from({ length: 6 }, () => ARMOR_STATS.map(() => 0));
  for (let si = 4; si >= 0; si--) {
    ahead[si] = ARMOR_STATS.map((_, k) => ahead[si + 1]![k]! + Math.max(...slots[si]!.map((c) => c.piece.stats[k]!)));
  }
  const modsNeeded = (stats: number[]) => {
    let n = 0;
    for (let k = 0; k < 6; k++) if (stats[k]! < targets[k]!) n += Math.ceil((targets[k]! - stats[k]!) / MOD_SIZE);
    return n;
  };
  // For ranking: a piece's stats weighted by priority. Trying the strongest first finds good results
  // early, and the most the remaining slots could add lets whole branches be skipped once they can't
  // beat what's already found. (Capping at 200 only lowers a score, so this never skips a better one.)
  const worth = (stats: number[]) => stats.reduce((a, v, k) => a + v * weight[k]!, 0);
  for (const s of slots) s.sort((a, b) => worth(b.piece.stats) - worth(a.piece.stats));
  const worthAhead = [0, 0, 0, 0, 0, 0];
  for (let si = 4; si >= 0; si--) worthAhead[si] = worthAhead[si + 1]! + worth(slots[si]![0]!.piece.stats);
  const modWorth = modSlots * MOD_SIZE * Math.max(...weight);
  let partial = 0;

  // Pieces of the wanted set each slot could still add.
  const setAhead = [0, 0, 0, 0, 0, 0];
  for (let si = 4; si >= 0; si--) setAhead[si] = setAhead[si + 1]! + (wantSet && slots[si]!.some((c) => c.set === wantSet.hash) ? 1 : 0);

  const best: OptimizerResult[] = [];
  let worst = -Infinity;
  let checked = 0;
  let truncated = false;
  const chosen: Cand[] = [];
  const totals = [0, 0, 0, 0, 0, 0];

  const finish = () => {
    checked++;
    const mods = [0, 0, 0, 0, 0, 0];
    const total = [...totals];
    let left = modSlots;
    for (let k = 0; k < 6; k++) {
      while (total[k]! < targets[k]!) { mods[k]!++; total[k]! += MOD_SIZE; left--; }
    }
    if (left < 0) return;
    // Spare mods go to the most important stat that still has room under 200.
    while (left > 0) {
      const k = priority.map((s) => ARMOR_STATS.indexOf(s)).find((i) => total[i]! + MOD_SIZE <= STAT_MAX);
      if (k === undefined) break;
      mods[k]!++; total[k]! += MOD_SIZE; left--;
    }
    const capped = total.map((v) => Math.min(v, STAT_MAX));
    const score = capped.reduce((a, v, k) => a + v * weight[k]!, 0);
    if (best.length >= limit && score <= worst) return;
    const setCounts = new Map<number, number>();
    for (const c of chosen) if (c.set) setCounts.set(c.set, (setCounts.get(c.set) ?? 0) + 1);
    const result: OptimizerResult = {
      pieces: chosen.map((c) => c.piece),
      base: [...totals],
      mods,
      total,
      wasted: total.reduce((a, v) => a + Math.max(0, v - STAT_MAX), 0),
      score: Math.round(score),
      sets: [...setCounts].filter(([, n]) => n >= 2).map(([hash, count]) => ({ hash, name: sets?.[hash]?.name, count })),
    };
    best.push(result);
    best.sort((a, b) => b.score - a.score);
    if (best.length > limit) best.pop();
    if (best.length >= limit) worst = best.at(-1)!.score;
  };

  const walk = (si: number, exotics: number, setCount: number) => {
    if (truncated) return;
    if (si === 5) {
      if (wantSet && setCount < wantSet.pieces) return;
      if (typeof exotic === 'number' && exotics === 0) return;
      finish();
      if (checked >= MAX_CHECKS) truncated = true;
      return;
    }
    if (best.length >= limit && partial + worthAhead[si]! + modWorth <= worst) return;
    // Hopeless if even the best remaining pieces can't reach the targets with the mods available.
    const reach = totals.map((v, k) => v + ahead[si]![k]!);
    if (modsNeeded(reach) > modSlots) return;
    if (wantSet && setCount + setAhead[si]! < wantSet.pieces) return;
    for (const c of slots[si]!) {
      const isExotic = c.piece.exotic ? 1 : 0;
      if (exotics + isExotic > 1) continue;
      const w = worth(c.piece.stats);
      // Sorted strongest first: once this piece can't lead to a better result, no later one can.
      if (best.length >= limit && partial + w + worthAhead[si + 1]! + modWorth <= worst) break;
      for (let k = 0; k < 6; k++) totals[k]! += c.piece.stats[k]!;
      partial += w;
      chosen.push(c);
      walk(si + 1, exotics + isExotic, setCount + (wantSet && c.set === wantSet.hash ? 1 : 0));
      chosen.pop();
      partial -= w;
      for (let k = 0; k < 6; k++) totals[k]! -= c.piece.stats[k]!;
    }
  };
  walk(0, 0, 0);

  const reason = best.length ? undefined
    : wantSet ? 'No combination reaches these targets with that set bonus. Try lower targets or more mods.'
    : 'No combination reaches these targets. Try lower targets or more mods.';
  return { results: best, checked, candidates, ...(reason ? { reason } : {}), ...(truncated ? { truncated } : {}) };
}
