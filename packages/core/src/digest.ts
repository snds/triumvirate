// Daily digest: what changed in your gear since yesterday, what's worth buying, and what needs a
// tidy. Pure, so the server builds it on a schedule and tests can check it without Bungie.
import type { ItemRow } from './vault.ts';
import type { CommunityAppraisal, Grade } from './community.ts';
import type { Verdict as WishListVerdict } from './wishlist.ts';

export interface DigestItem {
  /** Present for items you own; vendor offers have none worth keeping. */
  instanceId?: string;
  itemHash: number;
  name: string;
  icon?: string;
  tier: string;
  type: string;
  /** Community grade (weapons). */
  grade?: Grade;
  /** Wish list verdict (weapons). */
  verdict?: WishListVerdict;
  /** Where it is, or which vendor sells it. */
  where: string;
  /** One line on why it's here: "God roll", "Stat total 68: Grenade 30, Super 22". */
  note?: string;
}

export interface Digest {
  /** Local date it covers, YYYY-MM-DD. */
  date: string;
  builtAt: string;
  /** A few sentences written by the assistant, when it's turned on. */
  lede?: string;
  /** True for the very first digest: it only takes stock, so nothing counts as new. */
  firstRun?: boolean;
  /** New since the last digest, best first. */
  drops: { weapons: DigestItem[]; armor: DigestItem[]; total: number };
  /** Vendor weapons graded A or better, or on the wish list. */
  vendors: DigestItem[];
  cleanup: { count: number; high: number };
  vault: { used: number; capacity: number };
  /** The community data behind the grades. */
  crawl?: { builtAt?: string; samples: number };
  /** Every item instance seen today, so tomorrow knows what's new. */
  seen: string[];
}

type Item = Pick<ItemRow, 'instanceId' | 'itemHash' | 'name' | 'icon' | 'tier' | 'type' | 'itemType' | 'location' | 'stats' | 'statDetails' | 'gearTier'> & {
  appraisal?: { verdict?: WishListVerdict };
};

export interface DigestInput {
  date: string;
  now?: Date;
  items: Item[];
  /** `seen` from the last digest; absent on the first run. */
  prevSeen?: string[];
  grades: Record<string, Pick<CommunityAppraisal, 'grade'> | undefined>;
  vendors?: { items: (Item & { vendorName?: string })[]; grades: Record<string, Pick<CommunityAppraisal, 'grade'> | undefined> };
  cleanup: { confidence: string }[];
  vault: { used: number; capacity: number };
  crawl?: { builtAt?: string; samples: number };
}

const GRADE_RANK: Record<Grade, number> = { S: 0, A: 1, B: 2, C: 3, D: 4, F: 5 };
const VERDICT_RANK: Record<string, number> = { god: 0, good: 1, meh: 3, unrated: 4, trash: 5 };
const TIER_RANK: Record<string, number> = { Exotic: 0, Legendary: 1 };
/** Armor stats as the game names them (Armor 3.0). */
const ARMOR_STATS = ['Weapons', 'Health', 'Class', 'Grenade', 'Super', 'Melee'];
const MAX_LIST = 12;

const gradeOf = (g?: Grade) => (g ? GRADE_RANK[g] : 6);

function weaponNote(grade?: Grade, verdict?: WishListVerdict): string | undefined {
  const parts = [verdict === 'god' ? 'God roll' : verdict === 'good' ? 'Recommended roll' : undefined, grade ? `${grade} grade` : undefined];
  return parts.filter(Boolean).join(' · ') || undefined;
}

/** "Stat total 68: Grenade 30, Super 22", from the base roll (no mods or masterwork). */
export function armorNote(item: Pick<ItemRow, 'stats' | 'statDetails' | 'gearTier'>): string | undefined {
  const base = ARMOR_STATS.map((name) => {
    const d = item.statDetails?.find((s) => s.name === name);
    return { name, value: d ? Math.max(0, d.value - d.bonus) : item.stats?.[name] ?? 0 };
  });
  const total = base.reduce((a, s) => a + s.value, 0);
  if (!total) return item.gearTier ? `Tier ${item.gearTier}` : undefined;
  const top = base.filter((s) => s.value > 0).sort((a, b) => b.value - a.value).slice(0, 2).map((s) => `${s.name} ${s.value}`);
  return `${item.gearTier ? `Tier ${item.gearTier} · ` : ''}Stat total ${total}: ${top.join(', ')}`;
}
const armorTotal = (i: Item) => ARMOR_STATS.reduce((a, name) => {
  const d = i.statDetails?.find((s) => s.name === name);
  return a + (d ? Math.max(0, d.value - d.bonus) : i.stats?.[name] ?? 0);
}, 0);

export function buildDigest(input: DigestInput): Digest {
  const ids = input.items.flatMap((i) => (i.instanceId ? [i.instanceId] : []));
  const firstRun = !input.prevSeen;
  const prev = new Set(input.prevSeen ?? ids);
  const fresh = input.items.filter((i) => i.instanceId && !prev.has(i.instanceId));

  const weapons = fresh.filter((i) => i.itemType === 3)
    .map((i): DigestItem & { rank: number[] } => {
      const grade = input.grades[i.instanceId!]?.grade;
      const verdict = i.appraisal?.verdict;
      return {
        instanceId: i.instanceId, itemHash: i.itemHash, name: i.name, icon: i.icon, tier: i.tier, type: i.type, where: i.location,
        ...(grade ? { grade } : {}), ...(verdict ? { verdict } : {}), note: weaponNote(grade, verdict),
        rank: [Math.min(gradeOf(grade), VERDICT_RANK[verdict ?? 'unrated'] ?? 4), TIER_RANK[i.tier] ?? 2],
      };
    })
    .sort((a, b) => a.rank[0]! - b.rank[0]! || a.rank[1]! - b.rank[1]!);
  const armor = fresh.filter((i) => i.itemType === 2)
    .map((i) => ({ item: i, total: armorTotal(i) }))
    .sort((a, b) => (TIER_RANK[a.item.tier] ?? 2) - (TIER_RANK[b.item.tier] ?? 2) || b.total - a.total)
    .map(({ item: i }): DigestItem => ({
      instanceId: i.instanceId, itemHash: i.itemHash, name: i.name, icon: i.icon, tier: i.tier, type: i.type, where: i.location, note: armorNote(i),
    }));

  const vendors = (input.vendors?.items ?? [])
    .map((i) => ({ i, grade: i.instanceId ? input.vendors!.grades[i.instanceId]?.grade : undefined, verdict: i.appraisal?.verdict }))
    .filter(({ grade, verdict }) => gradeOf(grade) <= GRADE_RANK.A || verdict === 'god' || verdict === 'good')
    .sort((a, b) => Math.min(gradeOf(a.grade), VERDICT_RANK[a.verdict ?? 'unrated'] ?? 4) - Math.min(gradeOf(b.grade), VERDICT_RANK[b.verdict ?? 'unrated'] ?? 4))
    .slice(0, MAX_LIST)
    .map(({ i, grade, verdict }): DigestItem => ({
      itemHash: i.itemHash, name: i.name, icon: i.icon, tier: i.tier, type: i.type, where: i.vendorName ?? i.location,
      ...(grade ? { grade } : {}), ...(verdict ? { verdict } : {}), note: weaponNote(grade, verdict),
    }));

  return {
    date: input.date,
    builtAt: (input.now ?? new Date()).toISOString(),
    ...(firstRun ? { firstRun } : {}),
    drops: { weapons: weapons.slice(0, MAX_LIST).map(({ rank: _r, ...d }) => d), armor: armor.slice(0, MAX_LIST), total: fresh.length },
    vendors,
    cleanup: { count: input.cleanup.length, high: input.cleanup.filter((c) => c.confidence === 'high').length },
    vault: input.vault,
    ...(input.crawl ? { crawl: input.crawl } : {}),
    seen: ids,
  };
}

/** The digest as plain facts, for the assistant to turn into a short lede. */
export function digestFacts(d: Digest): string {
  const line = (i: DigestItem) => `${i.name} (${i.type}${i.note ? `, ${i.note}` : ''}, ${i.where})`;
  return [
    d.firstRun ? 'First digest: no comparison yet, everything owned is the starting point.' : `New items since yesterday: ${d.drops.total}.`,
    d.drops.weapons.length ? `New weapons, best first: ${d.drops.weapons.slice(0, 5).map(line).join('; ')}.` : '',
    d.drops.armor.length ? `New armor, best first: ${d.drops.armor.slice(0, 4).map(line).join('; ')}.` : '',
    d.vendors.length ? `Worth buying from vendors: ${d.vendors.slice(0, 4).map(line).join('; ')}.` : 'No vendor weapons worth buying today.',
    `Vault: ${d.vault.used} of ${d.vault.capacity}. Cleanup suggestions: ${d.cleanup.count} (${d.cleanup.high} high confidence).`,
  ].filter(Boolean).join('\n');
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Cuts text to about `max` characters at a sentence (or word) end, so a lock screen shows whole thoughts. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (stop > max / 3) return cut.slice(0, stop + 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : max).replace(/[,;:]$/, '')}…`;
}

/**
 * The morning alert: a title that names the best news, and a short body.
 * Lock screens show about two lines, so the body is the lede (when the assistant wrote one) or the counts.
 */
export function digestNotice(d: Pick<Digest, 'firstRun' | 'lede' | 'drops' | 'vendors' | 'vault' | 'cleanup' | 'seen'>): { title: string; body: string } {
  if (d.firstRun) {
    return { title: 'Your first digest is ready', body: `It took stock of ${plural(d.seen.length, 'item')}. New drops show up from tomorrow on.` };
  }
  const best = d.drops.weapons[0];
  const title = best?.verdict === 'god' ? `New god roll: ${best.name}`
    : best?.grade === 'S' ? `New S-grade ${best.type}: ${best.name}`
    : d.vendors[0] ? `Worth buying today: ${d.vendors[0].name}`
    : 'Your daily digest';
  const counts = [
    d.drops.total ? `${plural(d.drops.total, 'new item')}` : 'No new items',
    d.vendors.length ? plural(d.vendors.length, 'vendor pick') : '',
    `vault ${d.vault.used}/${d.vault.capacity}`,
  ].filter(Boolean).join(' · ');
  return { title: clip(title, 60), body: d.lede ? clip(d.lede, 170) : counts };
}
