// Pure logic for the roll appraiser view: filters and grouping. No React, so it's easy to test.
import type { AppraisedItem, CommunityAppraisal, Grade, Role, Verdict } from '@triumvirate/core';

export const GRADE_ORDER: Grade[] = ['F', 'D', 'C', 'B', 'A', 'S'];
export const ROLE_LABEL: Record<Role, string> = {
  'pve-endgame': 'PvE endgame',
  pve: 'PvE',
  patrol: 'Patrols',
  'pvp-endgame': 'PvP endgame',
  pvp: 'PvP',
  gambit: 'Gambit',
};
export type RollType = 'both' | 'pve' | 'pvp' | 'none';
export const ROLL_TYPE_LABEL: Record<RollType, string> = {
  both: 'Community PvE & PvP',
  pve: 'Community PvE',
  pvp: 'Community PvP',
  none: 'No community pick',
};

export interface RollFilters {
  rollTypes: Set<RollType>;
  /** Empty = any. */
  usedFor: Set<Role>;
  /** Inclusive grade range on the slotted roll; ungraded copies pass only at the full range. */
  gradeMin: Grade;
  gradeMax: Grade;
  betterPossibleOnly: boolean;
  rarities: Set<string>;
  /** Empty = everywhere. */
  locations: Set<string>;
  verdicts: Set<Verdict>;
  /** Empty = every weapon type. */
  types: Set<string>;
}

export const defaultFilters = (): RollFilters => ({
  rollTypes: new Set<RollType>(['both', 'pve', 'pvp', 'none']),
  usedFor: new Set(),
  gradeMin: 'F',
  gradeMax: 'S',
  betterPossibleOnly: false,
  rarities: new Set(['Exotic', 'Legendary']),
  locations: new Set(),
  verdicts: new Set<Verdict>(['god', 'good', 'meh', 'trash', 'unrated']),
  types: new Set(),
});

/** Weapons only, legendary and up: that's all the community data covers. */
export const isAppraisable = (i: AppraisedItem) => i.itemType === 3 && (i.tier === 'Legendary' || i.tier === 'Exotic');

export function passes(item: AppraisedItem, c: CommunityAppraisal | undefined, f: RollFilters): boolean {
  if (!f.rarities.has(item.tier)) return false;
  if (f.locations.size && !f.locations.has(locationKey(item))) return false;
  if (f.types.size && !f.types.has(item.type)) return false;
  if (!f.verdicts.has(item.appraisal?.verdict ?? 'unrated')) return false;
  if (!f.rollTypes.has(c?.rollType ?? 'none')) return false;
  if (f.usedFor.size && !(c?.usedFor && f.usedFor.has(c.usedFor))) return false;
  if (f.betterPossibleOnly && !c?.betterPossible) return false;
  const fullRange = f.gradeMin === 'F' && f.gradeMax === 'S';
  if (!fullRange) {
    if (!c?.grade) return false;
    const g = GRADE_ORDER.indexOf(c.grade);
    if (g < GRADE_ORDER.indexOf(f.gradeMin) || g > GRADE_ORDER.indexOf(f.gradeMax)) return false;
  }
  return true;
}

/**
 * Where an item sits, as the location filter sees it: "Vault" or the class name. Row locations
 * carry the light level ("Titan (2010)"), which changes, so saved filters key on the class alone.
 */
export const locationKey = (i: Pick<AppraisedItem, 'location' | 'owner'>) =>
  i.owner === 'vault' ? 'Vault' : i.location.replace(/\s*\(\d+\)$/, '');

// Saved filters: Sets become arrays in storage, and keys added later fall back to the defaults.
export type SavedFilters = { [K in keyof RollFilters]?: RollFilters[K] extends Set<infer V> ? V[] : RollFilters[K] };
export const encodeFilters = (f: RollFilters): SavedFilters =>
  Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v instanceof Set ? [...v].sort() : v])) as SavedFilters;
export function decodeFilters(saved: SavedFilters | null | undefined): RollFilters {
  const f = defaultFilters();
  if (!saved || typeof saved !== 'object') return f;
  const out = f as unknown as Record<string, unknown>;
  for (const [k, def] of Object.entries(f)) {
    const v = (saved as Record<string, unknown>)[k];
    if (v === undefined) continue;
    if (def instanceof Set) { if (Array.isArray(v)) out[k] = new Set(v); }
    else if (typeof v === typeof def && (typeof v !== 'string' || GRADE_ORDER.includes(v as Grade))) out[k] = v;
  }
  return f;
}

/**
 * Follow the character you're playing: when it changes, a location filter that named the old
 * class names the new one instead. The vault and an empty ("everywhere") filter stay as they are.
 */
export function followCharacter(f: RollFilters, from: string | undefined, to: string | undefined): RollFilters {
  if (!from || !to || from === to || !f.locations.has(from)) return f;
  const locations = new Set(f.locations);
  locations.delete(from);
  locations.add(to);
  return { ...f, locations };
}

export type GroupBy = 'type' | 'slot' | 'element' | 'location' | 'grade' | 'use' | 'none';
export type SortBy = 'grade' | 'name' | 'power' | 'newest';
export const GROUP_LABEL: Record<GroupBy, string> = {
  type: 'Weapon type', slot: 'Slot', element: 'Element', location: 'Location', grade: 'Grade', use: 'Best activity', none: 'No grouping',
};
export const SORT_LABEL: Record<SortBy, string> = { grade: 'Grade', name: 'Item name', power: 'Power', newest: 'Newest first' };

/** `role` is set when grouped by best activity, so the head can show that mode's glyph and banner. */
export interface TypeGroup { type: string; items: AppraisedItem[]; role?: Role }

const NO_PICK = 'No clear pick';

const SLOT_ORDER = ['Kinetic Weapons', 'Energy Weapons', 'Power Weapons'];

/** Groups items (A to Z, or slot order, or best grade first) and sorts inside each group. */
export function groupItems(
  items: AppraisedItem[],
  grades: Record<string, CommunityAppraisal | undefined>,
  groupBy: GroupBy = 'type',
  sortBy: SortBy = 'grade',
): TypeGroup[] {
  const grade = (i: AppraisedItem) => (i.instanceId ? grades[i.instanceId]?.grade : undefined);
  const rank = (i: AppraisedItem) => { const g = grade(i); return g ? GRADE_ORDER.indexOf(g) : -1; };
  const key = (i: AppraisedItem): string => {
    switch (groupBy) {
      case 'slot': return i.bucket || 'Other';
      case 'element': return i.damage || 'Other';
      case 'location': return locationKey(i);
      case 'grade': return grade(i) ? `Grade ${grade(i)}` : 'Not graded';
      case 'use': { const r = i.instanceId ? grades[i.instanceId]?.usedFor : undefined; return r ? ROLE_LABEL[r] : NO_PICK; }
      case 'none': return 'All weapons';
      default: return i.type;
    }
  };
  const order = (a: string, b: string) => {
    if (groupBy === 'slot') return (SLOT_ORDER.indexOf(a) + 1 || 99) - (SLOT_ORDER.indexOf(b) + 1 || 99);
    if (groupBy === 'grade') {
      const g = (s: string) => (s.startsWith('Grade ') ? GRADE_ORDER.indexOf(s.slice(6) as Grade) : -1);
      return g(b) - g(a);
    }
    if (groupBy === 'use') {
      const r = (x: string) => { const n = Object.values(ROLE_LABEL).indexOf(x); return n < 0 ? 99 : n; };
      return r(a) - r(b);
    }
    if (groupBy === 'location') return (a === 'Vault' ? 1 : 0) - (b === 'Vault' ? 1 : 0) || a.localeCompare(b);
    return a.localeCompare(b);
  };
  // Instance ids grow over time, so a higher id is a newer drop.
  const newer = (a: AppraisedItem, b: AppraisedItem) => {
    const x = BigInt(a.instanceId && /^\d+$/.test(a.instanceId) ? a.instanceId : 0);
    const y = BigInt(b.instanceId && /^\d+$/.test(b.instanceId) ? b.instanceId : 0);
    return x === y ? 0 : x > y ? -1 : 1;
  };
  const byName = (a: AppraisedItem, b: AppraisedItem) => a.name.localeCompare(b.name);
  const cmp = (a: AppraisedItem, b: AppraisedItem) =>
    sortBy === 'name' ? byName(a, b) || rank(b) - rank(a)
      : sortBy === 'power' ? (b.power ?? 0) - (a.power ?? 0) || rank(b) - rank(a) || byName(a, b)
      : sortBy === 'newest' ? newer(a, b) || byName(a, b)
      : rank(b) - rank(a) || byName(a, b);
  const by = new Map<string, AppraisedItem[]>();
  for (const i of items) by.set(key(i), [...(by.get(key(i)) ?? []), i]);
  const roleOf = (label: string) => (Object.keys(ROLE_LABEL) as Role[]).find((r) => ROLE_LABEL[r] === label);
  return [...by.keys()].sort(order).map((type) => {
    const role = groupBy === 'use' ? roleOf(type) : undefined;
    return { type, items: by.get(type)!.sort(cmp), ...(role ? { role } : {}) };
  });
}

/** Groups by weapon type (A to Z); inside a group, best grade first, then name. */
export const groupByType = (items: AppraisedItem[], grades: Record<string, CommunityAppraisal | undefined>) =>
  groupItems(items, grades, 'type', 'grade');

/** True when a grade is at or above the bar. */
export const meetsGrade = (g: Grade | undefined, min: Grade) => !!g && GRADE_ORDER.indexOf(g) >= GRADE_ORDER.indexOf(min);

export interface StreamEntry { instanceId: string; itemHash: number; name: string; at: string }
/** What the activity stream remembers between visits. */
export interface StreamState {
  /** Every weapon instance seen so far; anything not in here is a new drop. */
  seen: string[];
  /** Newest first, capped. */
  drops: StreamEntry[];
}
export const STREAM_CAP = 60;

/**
 * Adds weapons that weren't there last time to the stream. The first run only takes stock,
 * so a fresh install doesn't call the whole vault "new". Ids that left (dismantled) are forgotten.
 */
export function updateStream(prev: StreamState | undefined, items: AppraisedItem[], now = new Date()): { state: StreamState; added: StreamEntry[] } {
  const ids = items.flatMap((i) => (i.instanceId ? [i.instanceId] : []));
  if (!prev) return { state: { seen: ids, drops: [] }, added: [] };
  const seen = new Set(prev.seen);
  const added = items
    .filter((i) => i.instanceId && !seen.has(i.instanceId))
    .map((i) => ({ instanceId: i.instanceId!, itemHash: i.itemHash, name: i.name, at: now.toISOString() }));
  const present = new Set(ids);
  const drops = [...added, ...prev.drops.filter((d) => present.has(d.instanceId))].slice(0, STREAM_CAP);
  return { state: { seen: ids, drops }, added };
}

/** "26%" style, with one decimal under 10%. */
export const pct = (x: number) => `${x < 0.1 ? (x * 100).toFixed(1) : Math.round(x * 100)}%`;
