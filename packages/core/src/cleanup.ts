// Vault cleanup suggestions. The API can't dismantle, so this only recommends;
// locked and equipped items are never suggested.
import type { ItemRow } from './vault.ts';
import type { Appraisal, Verdict } from './wishlist.ts';
import type { Grade } from './community.ts';
import type { ArmorSet } from './manifest.ts';
import { ARMOR_BUCKETS, ARMOR_SLOT_NAMES, baseStats } from './optimizer.ts';
import { bestInSlot, fitActivities, type BuildActivity, type BuildFit, type PopularBuild } from './builds.ts';

export type AppraisedItem = ItemRow & { appraisal?: Appraisal };

/** Community popularity grade per weapon instance id (see appraiseCommunity). Absent = no data. */
export type GradeLookup = Record<string, { grade?: Grade } | undefined>;

export interface CleanupCandidate {
  item: AppraisedItem;
  reason: string;
  /** high = safe by the numbers; medium = judgment call worth a glance. */
  confidence: 'high' | 'medium';
  /** What the pick is based on, for the chips on each row. */
  signals?: { verdict?: Verdict; grade?: Grade; set?: string };
  /** For duplicates: the copy that stays. */
  keeperId?: string;
}

const WEAPON = 3;
const ARMOR = 2;
const RANK: Record<Verdict, number> = { god: 4, good: 3, unrated: 2, meh: 1, trash: 0 };

const GRADE_RANK: Record<Grade, number> = { S: 5, A: 4, B: 3, C: 2, D: 1, F: 0 };
/** Players run these perks a lot: never call it junk on popularity alone. */
const popular = (g?: Grade) => g === 'S' || g === 'A';
/** Few players run these perks. */
const unpopular = (g?: Grade) => g === 'D' || g === 'F';

const protectedItem = (i: ItemRow) => i.locked || i.equipped;
const where = (i: ItemRow) => (i.owner === 'vault' ? 'in the vault' : `on your ${i.location.split(' ')[0]}`);

function weaponCandidates(items: AppraisedItem[], grades: GradeLookup): CleanupCandidate[] {
  const out: CleanupCandidate[] = [];
  const byHash = new Map<number, AppraisedItem[]>();
  for (const w of items.filter((i) => i.itemType === WEAPON && i.instanceId)) {
    byHash.set(w.itemHash, [...(byHash.get(w.itemHash) ?? []), w]);
  }
  for (const copies of byHash.values()) {
    const rank = (i: AppraisedItem) => RANK[i.appraisal?.verdict ?? 'unrated'];
    const grade = (i: AppraisedItem) => grades[i.instanceId ?? '']?.grade;
    const gradeRank = (i: AppraisedItem) => { const g = grade(i); return g ? GRADE_RANK[g] : 2.5; };
    const signals = (i: AppraisedItem) => {
      const s: NonNullable<CleanupCandidate['signals']> = {};
      if (i.appraisal) s.verdict = i.appraisal.verdict;
      const g = grade(i);
      if (g) s.grade = g;
      return s;
    };
    // Best copy first: locked/equipped count as the player's own pick, then the wish list,
    // then community popularity, then power.
    const sorted = [...copies].sort(
      (a, b) => Number(protectedItem(b)) - Number(protectedItem(a)) || rank(b) - rank(a) || gradeRank(b) - gradeRank(a) || (b.power ?? 0) - (a.power ?? 0),
    );
    const keeper = sorted[0]!;
    for (const w of sorted.slice(1)) {
      if (protectedItem(w)) continue;
      const v = w.appraisal?.verdict ?? 'unrated';
      if (v === 'god' || v === 'good') continue; // a second good roll may serve a different job
      const g = grade(w);
      if (popular(g)) continue; // players love these perks, so it may serve a different job too
      out.push({
        item: w,
        reason: `Duplicate. You have a better copy ${where(keeper)}.`,
        // A middling community grade is still worth a glance before it goes.
        confidence: g === 'B' ? 'medium' : 'high',
        signals: signals(w),
        ...(keeper.instanceId ? { keeperId: keeper.instanceId } : {}),
      });
    }
    // A lone copy that no curated roll wants is a softer suggestion, unless players agree it's weak.
    if (sorted.length === 1 && !protectedItem(keeper) && keeper.tier !== 'Exotic') {
      const v = keeper.appraisal?.verdict;
      const g = grade(keeper);
      if (v === 'trash') {
        out.push(popular(g)
          ? { item: keeper, reason: `The wish list marks this roll as trash, but players run these perks a lot (grade ${g}).`, confidence: 'medium', signals: signals(keeper) }
          : { item: keeper, reason: 'The wish list marks this roll as trash.', confidence: 'high', signals: signals(keeper) });
      } else if (v === 'meh' && !popular(g)) {
        out.push({
          item: keeper,
          reason: unpopular(g)
            ? `None of the ${keeper.appraisal!.rollCount} recommended rolls match, and few players run these perks (grade ${g}).`
            : `None of the ${keeper.appraisal!.rollCount} recommended rolls match this one.`,
          confidence: unpopular(g) ? 'high' : 'medium',
          signals: signals(keeper),
        });
      } else if ((v === undefined || v === 'unrated') && unpopular(g)) {
        out.push({ item: keeper, reason: `No wish list rolls for it, and few players run these perks (grade ${g}).`, confidence: 'medium', signals: signals(keeper) });
      }
    }
  }
  return out;
}

type ArmorOptions = {
  /** Popular builds: a piece that's best in slot for one is never picked. */
  builds?: PopularBuild[];
  /** Armor sets by hash, for names in the reasons. */
  sets?: Record<string, ArmorSet>;
};

const sumOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const slotName = (i: ItemRow) => ARMOR_SLOT_NAMES[ARMOR_BUCKETS.indexOf(i.bucketHash as (typeof ARMOR_BUCKETS)[number])] ?? i.type;

/**
 * True when `a` is at least as good a roll as `b`: no lower tier and no lower base stat (as rolled,
 * before mods and masterwork). Equal rolls count, so one of two identical copies can go; `tie`
 * decides which (the one that sorts first stays).
 */
function rollCovers(a: ItemRow, b: ItemRow): boolean {
  if ((a.gearTier ?? 0) < (b.gearTier ?? 0)) return false;
  const as = baseStats(a);
  const bs = baseStats(b);
  if (!as.every((v, k) => v >= bs[k]!)) return false;
  if (sumOf(as) > sumOf(bs) || (a.gearTier ?? 0) > (b.gearTier ?? 0)) return true;
  return tie(a, b) < 0;
}
/** For identical rolls: the one you locked or wear stays, then higher power, then a stable order. */
const tie = (a: ItemRow, b: ItemRow) =>
  Number(protectedItem(b)) - Number(protectedItem(a)) || (b.power ?? 0) - (a.power ?? 0) || (a.instanceId ?? '').localeCompare(b.instanceId ?? '');

/** Pieces that play the same part: copies of one exotic, the same set, or (for loose legendaries) any legendary. */
function sameJob(piece: ItemRow, other: ItemRow): boolean {
  if (other === piece || other.classType !== piece.classType || other.bucketHash !== piece.bucketHash) return false;
  if (piece.tier === 'Exotic') return other.itemHash === piece.itemHash;
  if (other.tier === 'Exotic') return false;
  // A set piece only gives way to another piece of its set: anything else loses the set bonus.
  if (piece.setHash) return other.setHash === piece.setHash;
  return true;
}

/** The copy that replaces `piece`: the strongest one that covers it. */
function betterCopy(piece: ItemRow, armor: ItemRow[], fits: Map<string, BuildFit[]>, job = sameJob): ItemRow | undefined {
  const better = armor.filter((o) => job(piece, o) && rollCovers(o, piece));
  // Prefer a keeper that's itself staying: in a build, then the biggest roll.
  return better.sort((a, b) =>
    Number(fits.has(b.instanceId ?? '')) - Number(fits.has(a.instanceId ?? ''))
    || sumOf(baseStats(b)) - sumOf(baseStats(a)) || tie(a, b))[0];
}

const isArmor = (i: ItemRow) => i.itemType === ARMOR && !!i.stats && Object.keys(i.stats).length > 0;

function armorCandidates(items: AppraisedItem[], opts: ArmorOptions): CleanupCandidate[] {
  const out: CleanupCandidate[] = [];
  const armor = items.filter(isArmor);
  const fits = bestInSlot(armor, opts.builds ?? [], opts.sets);
  const setName = (i: ItemRow) => (i.setHash ? opts.sets?.[i.setHash]?.name ?? 'armor' : undefined);
  for (const piece of armor) {
    if (protectedItem(piece) || fits.has(piece.instanceId ?? '')) continue;
    const better = betterCopy(piece, armor, fits);
    if (!better) continue;
    const set = setName(piece);
    const same = sumOf(baseStats(better)) === sumOf(baseStats(piece)) && (better.gearTier ?? 0) === (piece.gearTier ?? 0);
    out.push({
      item: piece,
      reason: set
        ? `Spare ${set} ${slotName(piece).toLowerCase()}. ${better.name} ${where(better)} has ${same ? 'the same' : 'a better'} roll, so the set stays whole.`
        : `${better.name} ${where(better)} ${same ? 'has the same roll' : 'beats it in every stat'}.`,
      confidence: 'high',
      signals: set ? { set } : {},
      ...(better.instanceId ? { keeperId: better.instanceId } : {}),
    });
  }
  return out;
}

/** An armor piece cleanup keeps on purpose, with why. */
export interface ArmorKeep {
  item: AppraisedItem;
  /** Plain sentences, most important first. */
  reasons: string[];
  /** Activities it's best in slot for. */
  activities: BuildActivity[];
  builds: BuildFit[];
  /** The set it belongs to, and how many of the set's slots you own for that class. */
  set?: { name: string; pieces: number };
  /**
   * True when a plain stat check would have picked it (another piece beats it in every stat),
   * so the set or a build is what saved it.
   */
  saved: boolean;
}

const joinNames = (xs: string[]) => (xs.length > 2 ? `${xs.slice(0, -1).join(', ')}, and ${xs.at(-1)}` : xs.join(' and '));

/**
 * Armor that cleanup keeps because of sets and builds: every piece that's best in slot for a
 * popular build, plus set pieces that only a piece from outside the set beats. Locked and equipped
 * pieces are left out (cleanup never picks them anyway).
 */
export function armorKeeps(items: AppraisedItem[], opts: ArmorOptions = {}): ArmorKeep[] {
  const armor = items.filter(isArmor);
  const fits = bestInSlot(armor, opts.builds ?? [], opts.sets);
  const out: ArmorKeep[] = [];
  for (const piece of armor) {
    if (protectedItem(piece)) continue;
    const f = fits.get(piece.instanceId ?? '') ?? [];
    const looseJob = (p: ItemRow, o: ItemRow) => sameJob({ ...p, setHash: undefined }, o);
    // Would the old stat-only check have picked it?
    const saved = !!betterCopy(piece, armor, new Map(), looseJob);
    const inSet = !!piece.setHash && saved && !betterCopy(piece, armor, fits);
    if (!f.length && !inSet) continue;
    const reasons: string[] = [];
    if (f.length) {
      const names = [...new Set(f.map((x) => x.build))];
      const what = f[0]!.exotic ? 'copy of this exotic' : slotName(piece).toLowerCase();
      reasons.push(`Best ${what} you have for the ${joinNames(names)} ${names.length === 1 ? 'build' : 'builds'}.`);
    }
    let set: ArmorKeep['set'];
    if (piece.setHash) {
      const name = opts.sets?.[piece.setHash]?.name ?? 'armor set';
      const pieces = new Set(armor.filter((o) => o.setHash === piece.setHash && o.classType === piece.classType).map((o) => o.bucketHash)).size;
      set = { name, pieces };
      if (inSet) {
        const bonus = pieces >= 4 ? 'enough for both set bonuses' : pieces >= 2 ? 'enough for the 2-piece bonus' : 'not a bonus yet';
        reasons.push(`Your best ${name} ${slotName(piece).toLowerCase()} (${pieces} of 5 pieces, ${bonus}). Only pieces outside the set beat it.`);
      }
    }
    out.push({ item: piece, reasons, activities: fitActivities(f), builds: f, ...(set ? { set } : {}), saved });
  }
  return out.sort((a, b) => Number(b.saved) - Number(a.saved) || a.item.name.localeCompare(b.item.name));
}

/**
 * Items worth dismantling. `grades` adds community popularity: it protects popular rolls and
 * firms up picks that both the wish list and other players pass on. `armor` makes armor picks
 * set- and build-aware.
 */
export function cleanupCandidates(items: AppraisedItem[], grades: GradeLookup = {}, armor: ArmorOptions = {}): CleanupCandidate[] {
  return [...weaponCandidates(items, grades), ...armorCandidates(items, armor)].sort(
    (a, b) => (a.confidence === b.confidence ? a.item.name.localeCompare(b.item.name) : a.confidence === 'high' ? -1 : 1),
  );
}

/** A DIM search that selects exactly these items, for tagging or dismantling there. */
export const dimSearch = (c: CleanupCandidate[]) =>
  c.map((x) => x.item.instanceId).filter(Boolean).map((id) => `id:${id}`).join(' or ');
