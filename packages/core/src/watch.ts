// Watch list: weapons you want a particular roll of. Each check looks at what vendors sell and at
// what has dropped, and anything matching a watch becomes a "hit". New hits trigger a phone alert
// once each; the list keeps the latest ones so the app can show them. Pure, so it tests offline.
import type { Grade } from './community.ts';
import type { PerkOption } from './vault.ts';

export interface WatchEntry {
  id: string;
  itemHash: number;
  name: string;
  icon?: string;
  type?: string;
  /**
   * Wanted perks, one group per column. A roll matches when every group has at least one of its
   * perks on it (in any column, active or switchable). Empty means any roll of the weapon.
   */
  perks: string[][];
  /** Only alert for rolls the community grades this well or better. */
  minGrade?: Grade;
  createdAt: string;
  /** Set once the first check has run, so copies you already owned when you added it don't alert. */
  primed?: boolean;
}

export interface WatchHit {
  /** Dedupe key: the same vendor offer or the same drop never alerts twice. */
  key: string;
  entryId: string;
  itemHash: number;
  name: string;
  icon?: string;
  source: 'vendor' | 'drop';
  /** Vendor name, or where the drop is now. */
  where: string;
  instanceId?: string;
  /** The wanted perks this roll has. */
  matched: string[];
  grade?: Grade;
  foundAt: string;
}

export interface WatchState {
  entries: WatchEntry[];
  /** Latest hits, newest first. */
  hits: WatchHit[];
  /** Keys already alerted (or seen while priming). */
  alerted: string[];
  checkedAt?: string;
}

export const emptyWatchState = (): WatchState => ({ entries: [], hits: [], alerted: [] });

const GRADE_RANK: Record<Grade, number> = { S: 0, A: 1, B: 2, C: 3, D: 4, F: 5 };
const MAX_HITS = 60;
const MAX_ALERTED = 1000;

/** "Kill Clip Enhanced" and "Kill Clip" are the same choice. */
export const perkBase = (name: string) => name.replace(/\s+Enhanced$/i, '').trim();

/** Cleans wanted perks from a request: trimmed names, no empty groups, no repeats. */
export function cleanWantedPerks(raw: unknown): string[][] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((g) => (Array.isArray(g) ? [...new Set(g.filter((n): n is string => typeof n === 'string').map(perkBase).filter(Boolean))].slice(0, 20) : []))
    .filter((g) => g.length > 0)
    .slice(0, 8);
}

/** The wanted perks this roll has, or undefined when it doesn't match the watch. */
export function matchWatch(
  entry: Pick<WatchEntry, 'itemHash' | 'perks' | 'minGrade'>,
  item: { itemHash: number; perks?: PerkOption[][] },
  grade?: Grade,
): string[] | undefined {
  if (item.itemHash !== entry.itemHash) return undefined;
  if (entry.minGrade && (!grade || GRADE_RANK[grade] > GRADE_RANK[entry.minGrade])) return undefined;
  const has = new Set((item.perks ?? []).flat().map((p) => perkBase(p.name)));
  const matched: string[] = [];
  for (const group of entry.perks) {
    const hit = group.filter((n) => has.has(n));
    if (!hit.length) return undefined;
    matched.push(...hit);
  }
  return matched;
}

type Roll = { itemHash: number; instanceId?: string; name: string; icon?: string; perks?: PerkOption[][] };
type Grades = Record<string, { grade?: Grade } | undefined>;

export interface WatchInput {
  vendors?: { items: (Roll & { vendorHash?: number; vendorName?: string })[]; grades: Grades };
  owned: { items: (Roll & { location?: string })[]; grades: Grades };
  now?: Date;
}

/** Everything that matches a watch right now: vendor offers first, then owned copies. */
export function findWatchHits(entries: WatchEntry[], input: WatchInput): WatchHit[] {
  const foundAt = (input.now ?? new Date()).toISOString();
  const byHash = new Map<number, WatchEntry[]>();
  for (const e of entries) byHash.set(e.itemHash, [...(byHash.get(e.itemHash) ?? []), e]);
  const out: WatchHit[] = [];
  const add = (source: WatchHit['source'], item: Roll, where: string, grade: Grade | undefined, key: (e: WatchEntry) => string) => {
    for (const e of byHash.get(item.itemHash) ?? []) {
      const matched = matchWatch(e, item, grade);
      if (!matched) continue;
      out.push({
        key: key(e), entryId: e.id, itemHash: item.itemHash, name: item.name, ...(item.icon ? { icon: item.icon } : {}),
        source, where, ...(source === 'drop' && item.instanceId ? { instanceId: item.instanceId } : {}), matched, ...(grade ? { grade } : {}), foundAt,
      });
    }
  };
  for (const v of input.vendors?.items ?? []) {
    const grade = v.instanceId ? input.vendors!.grades[v.instanceId]?.grade : undefined;
    // Vendor ids change with each reset, so the key is the offer itself: vendor, weapon, and perks.
    const perks = (v.perks ?? []).flat().map((p) => perkBase(p.name)).sort().join('+');
    add('vendor', v, v.vendorName ?? 'Vendor', grade, (e) => `v:${e.id}:${v.vendorHash ?? v.vendorName}:${v.itemHash}:${perks}`);
  }
  for (const i of input.owned.items) {
    if (!i.instanceId) continue;
    add('drop', i, i.location ?? '', input.owned.grades[i.instanceId]?.grade, (e) => `d:${e.id}:${i.instanceId}`);
  }
  return out;
}

/**
 * Folds a check into the state. Returns the new state and the hits worth an alert: ones not
 * alerted before, leaving out owned copies of a watch on its first check (you already had those).
 */
export function applyWatchCheck(state: WatchState, hits: WatchHit[], now = new Date()): { state: WatchState; fresh: WatchHit[] } {
  const alerted = new Set(state.alerted);
  const unprimed = new Set(state.entries.filter((e) => !e.primed).map((e) => e.id));
  const fresh: WatchHit[] = [];
  for (const h of hits) {
    if (alerted.has(h.key)) continue;
    alerted.add(h.key);
    if (h.source === 'drop' && unprimed.has(h.entryId)) continue;
    fresh.push(h);
  }
  // The list is what matches now (gone offers and dismantled copies drop off); a hit keeps the
  // time it was first found.
  const prior = new Map(state.hits.map((h) => [h.key, h.foundAt]));
  const list = hits.map((h) => ({ ...h, foundAt: prior.get(h.key) ?? h.foundAt }))
    .sort((a, b) => b.foundAt.localeCompare(a.foundAt) || (a.source === b.source ? 0 : a.source === 'vendor' ? -1 : 1))
    .slice(0, MAX_HITS);
  return {
    state: {
      entries: state.entries.map((e) => (e.primed ? e : { ...e, primed: true })),
      hits: list,
      alerted: [...alerted].slice(-MAX_ALERTED),
      checkedAt: now.toISOString(),
    },
    fresh,
  };
}

/** Drops hits and alert keys for a watch that was removed or changed, so a changed watch alerts afresh. */
export function forgetWatch(state: WatchState, entryId: string): WatchState {
  const mine = (k: string) => k.split(':')[1] === entryId;
  return { ...state, hits: state.hits.filter((h) => h.entryId !== entryId), alerted: state.alerted.filter((k) => !mine(k)) };
}

/** One alert for a batch of new hits: vendor offers lead, since they leave at the next reset. */
export function watchNotice(fresh: WatchHit[]): { title: string; body: string } | undefined {
  if (!fresh.length) return undefined;
  const sorted = [...fresh].sort((a, b) => (a.source === b.source ? 0 : a.source === 'vendor' ? -1 : 1));
  const top = sorted[0]!;
  const title = top.source === 'vendor' ? `${top.where} is selling ${top.name}` : `Watched roll dropped: ${top.name}`;
  const perks = top.matched.length ? `with ${top.matched.join(' and ')}` : 'a roll you wanted';
  const more = fresh.length > 1 ? ` Plus ${fresh.length - 1} more on your watch list.` : '';
  return { title, body: `${top.name} ${perks}${top.grade ? `, ${top.grade} grade` : ''}.${more}` };
}
