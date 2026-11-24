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
  if (f.locations.size && !f.locations.has(item.location)) return false;
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

export interface TypeGroup { type: string; items: AppraisedItem[] }

/** Groups by weapon type (A to Z); inside a group, best grade first, then name. */
export function groupByType(items: AppraisedItem[], grades: Record<string, CommunityAppraisal | undefined>): TypeGroup[] {
  const rank = (i: AppraisedItem) => {
    const g = i.instanceId ? grades[i.instanceId]?.grade : undefined;
    return g ? GRADE_ORDER.indexOf(g) : -1;
  };
  const by = new Map<string, AppraisedItem[]>();
  for (const i of items) by.set(i.type, [...(by.get(i.type) ?? []), i]);
  return [...by.keys()].sort().map((type) => ({
    type,
    items: by.get(type)!.sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name)),
  }));
}

/** "26%" style, with one decimal under 10%. */
export const pct = (x: number) => `${x < 0.1 ? (x * 100).toFixed(1) : Math.round(x * 100)}%`;
