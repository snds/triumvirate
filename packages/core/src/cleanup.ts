// Vault cleanup suggestions. The API can't dismantle, so this only recommends;
// locked and equipped items are never suggested.
import type { ItemRow } from './vault.ts';
import type { Appraisal, Verdict } from './wishlist.ts';

export type AppraisedItem = ItemRow & { appraisal?: Appraisal };

export interface CleanupCandidate {
  item: AppraisedItem;
  reason: string;
  /** high = safe by the numbers; medium = judgment call worth a glance. */
  confidence: 'high' | 'medium';
}

const WEAPON = 3;
const ARMOR = 2;
const RANK: Record<Verdict, number> = { god: 4, good: 3, unrated: 2, meh: 1, trash: 0 };

const protectedItem = (i: ItemRow) => i.locked || i.equipped;
const where = (i: ItemRow) => (i.owner === 'vault' ? 'in the vault' : `on your ${i.location.split(' ')[0]}`);

function weaponCandidates(items: AppraisedItem[]): CleanupCandidate[] {
  const out: CleanupCandidate[] = [];
  const byHash = new Map<number, AppraisedItem[]>();
  for (const w of items.filter((i) => i.itemType === WEAPON && i.instanceId)) {
    byHash.set(w.itemHash, [...(byHash.get(w.itemHash) ?? []), w]);
  }
  for (const copies of byHash.values()) {
    const rank = (i: AppraisedItem) => RANK[i.appraisal?.verdict ?? 'unrated'];
    // Best copy first: locked/equipped count as the player's own pick, then roll quality, then power.
    const sorted = [...copies].sort(
      (a, b) => Number(protectedItem(b)) - Number(protectedItem(a)) || rank(b) - rank(a) || (b.power ?? 0) - (a.power ?? 0),
    );
    const keeper = sorted[0]!;
    for (const w of sorted.slice(1)) {
      if (protectedItem(w)) continue;
      const v = w.appraisal?.verdict ?? 'unrated';
      if (v === 'god' || v === 'good') continue; // a second good roll may serve a different job
      out.push({ item: w, reason: `Duplicate. You have a better copy ${where(keeper)}.`, confidence: 'high' });
    }
    // A lone copy that no curated roll wants is a softer suggestion.
    if (sorted.length === 1 && !protectedItem(keeper) && keeper.tier !== 'Exotic') {
      const v = keeper.appraisal?.verdict;
      if (v === 'trash') out.push({ item: keeper, reason: 'The wish list marks this roll as trash.', confidence: 'high' });
      if (v === 'meh') {
        out.push({
          item: keeper,
          reason: `None of the ${keeper.appraisal!.rollCount} recommended rolls match this one.`,
          confidence: 'medium',
        });
      }
    }
  }
  return out;
}

/** True when `a` is at least as good as `b` in every stat and better in total. */
function dominates(a: ItemRow, b: ItemRow): boolean {
  if (!a.stats || !b.stats) return false;
  if ((a.gearTier ?? 0) < (b.gearTier ?? 0)) return false;
  const names = new Set([...Object.keys(a.stats), ...Object.keys(b.stats)]);
  let aTotal = 0;
  let bTotal = 0;
  for (const n of names) {
    const av = a.stats[n] ?? 0;
    const bv = b.stats[n] ?? 0;
    if (av < bv) return false;
    aTotal += av;
    bTotal += bv;
  }
  return aTotal > bTotal;
}

function armorCandidates(items: AppraisedItem[]): CleanupCandidate[] {
  const out: CleanupCandidate[] = [];
  const armor = items.filter((i) => i.itemType === ARMOR && i.stats && Object.keys(i.stats).length > 0);
  for (const piece of armor) {
    if (protectedItem(piece)) continue;
    // Exotics only compete with copies of the same exotic; legendaries with the same slot and class.
    const better = armor.find(
      (other) =>
        other !== piece &&
        other.classType === piece.classType &&
        other.bucketHash === piece.bucketHash &&
        (piece.tier === 'Exotic' ? other.itemHash === piece.itemHash : other.tier !== 'Exotic') &&
        dominates(other, piece),
    );
    if (better) {
      out.push({ item: piece, reason: `${better.name} ${where(better)} beats it in every stat.`, confidence: 'high' });
    }
  }
  return out;
}

export function cleanupCandidates(items: AppraisedItem[]): CleanupCandidate[] {
  return [...weaponCandidates(items), ...armorCandidates(items)].sort(
    (a, b) => (a.confidence === b.confidence ? a.item.name.localeCompare(b.item.name) : a.confidence === 'high' ? -1 : 1),
  );
}

/** A DIM search that selects exactly these items, for tagging or dismantling there. */
export const dimSearch = (c: CleanupCandidate[]) =>
  c.map((x) => x.item.instanceId).filter(Boolean).map((id) => `id:${id}`).join(' or ');
