// Pure view logic: filtering and grouping items for display. No React here, so it's easy to test.
import type { AppraisedItem, ItemRow } from '@triumvirate/core';

export type Kind = 'all' | 'weapons' | 'armor';

/** Gear slots in in-game order. Anything else is grouped under "Other". */
export const SLOT_ORDER = [
  'Kinetic Weapons', 'Energy Weapons', 'Power Weapons',
  'Helmet', 'Gauntlets', 'Chest Armor', 'Leg Armor', 'Class Armor', 'Ghost',
];
const WEAPON = 3;
const ARMOR = 2;

export function matches(item: AppraisedItem, query: string, kind: Kind): boolean {
  if (kind === 'weapons' && item.itemType !== WEAPON) return false;
  if (kind === 'armor' && item.itemType !== ARMOR) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  // Every word must appear somewhere, so "solar hand" finds Solar hand cannons and "god" finds god rolls.
  const hay = `${item.name} ${item.type} ${item.tier} ${item.damage ?? ''} ${item.appraisal?.verdict ?? ''}`.toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

export interface SlotGroup<T extends ItemRow = ItemRow> {
  slot: string;
  items: T[];
}

/**
 * Groups items by slot in game order; "Other" collects the rest when `includeOther`.
 * Within a slot: equipped first, then highest power, then name.
 */
/**
 * `recent` maps instance id to when you last moved it. Recently moved items sort to the front of
 * their slot (newest first), like DIM, since moves usually mean you're about to use them.
 */
export function groupBySlot<T extends ItemRow>(items: T[], includeOther: boolean, recent: Record<string, number> = {}): SlotGroup<T>[] {
  const movedAt = (i: T) => (i.instanceId && recent[i.instanceId]) || 0;
  const bySlot = new Map<string, T[]>();
  for (const item of items) {
    const slot = SLOT_ORDER.includes(item.bucket) ? item.bucket : 'Other';
    if (slot === 'Other' && !includeOther) continue;
    bySlot.set(slot, [...(bySlot.get(slot) ?? []), item]);
  }
  return [...SLOT_ORDER, 'Other']
    .filter((slot) => bySlot.has(slot))
    .map((slot) => ({
      slot,
      items: bySlot.get(slot)!.sort(
        (a, b) => Number(b.equipped) - Number(a.equipped) || movedAt(b) - movedAt(a)
          || (b.power ?? 0) - (a.power ?? 0) || a.name.localeCompare(b.name),
      ),
    }));
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} hr ago` : `${Math.round(h / 24)} days ago`;
}
