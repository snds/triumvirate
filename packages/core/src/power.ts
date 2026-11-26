// Max power: the best gear a character could wear right now, slot by slot, like the game's own
// number. Pure logic so the character header can show it without asking the server.
import type { ItemRow } from './vault.ts';
import { GEAR_BUCKETS } from './loadouts.ts';

type Row = Pick<ItemRow, 'bucketHash' | 'power' | 'tier' | 'classType' | 'itemType' | 'name' | 'icon' | 'instanceId' | 'owner'>;

/** Weapon slots, then armor, in game order (ghosts have no power). */
export const WEAPON_POWER_BUCKETS = GEAR_BUCKETS.slice(0, 3) as readonly number[];
export const ARMOR_POWER_BUCKETS = GEAR_BUCKETS.slice(3, 8) as readonly number[];
export const POWER_SLOT_NAMES: Record<number, string> = {
  1498876634: 'Kinetic', 2465295065: 'Energy', 953998645: 'Power',
  3448274439: 'Helmet', 3551918588: 'Gauntlets', 14239492: 'Chest', 20886954: 'Legs', 1585787867: 'Class item',
};

export interface PowerSlot {
  bucketHash: number;
  slot: string;
  power: number;
  /** The item that sets this slot's number; absent when you own nothing for the slot. */
  item?: Pick<Row, 'name' | 'icon' | 'instanceId' | 'tier' | 'owner'>;
}

export interface PowerBreakdown {
  weapons: PowerSlot[];
  armor: PowerSlot[];
  /** Average over the eight slots, unrounded. The game shows the whole number. */
  total: number;
}

/**
 * Best item per slot, with at most one exotic: the exotic goes in the slot where it adds the most.
 * Slots where only an exotic exists still get one, since there's nothing else to wear.
 */
function bestSlots(buckets: readonly number[], pool: Row[]): PowerSlot[] {
  const pick = (b: number, exotic: boolean) => pool
    .filter((i) => i.bucketHash === b && (i.tier === 'Exotic') === exotic)
    .reduce<Row | undefined>((best, i) => (!best || (i.power ?? 0) > (best.power ?? 0) ? i : best), undefined);
  const legend = buckets.map((b) => pick(b, false));
  const exotic = buckets.map((b) => pick(b, true));
  let swap = -1;
  let gain = 0;
  buckets.forEach((_, n) => {
    const e = exotic[n]?.power;
    if (e === undefined) return;
    // A slot with no legendary must take its exotic; that always wins the one exotic spot.
    const g = legend[n] ? e - (legend[n]!.power ?? 0) : Infinity;
    if (g > gain) { gain = g; swap = n; }
  });
  return buckets.map((b, n) => {
    const item = n === swap ? exotic[n] : legend[n] ?? exotic[n];
    return {
      bucketHash: b,
      slot: POWER_SLOT_NAMES[b] ?? '',
      power: item?.power ?? 0,
      ...(item ? { item: { name: item.name, icon: item.icon, instanceId: item.instanceId, tier: item.tier, owner: item.owner } } : {}),
    };
  });
}

/**
 * The highest power a character of `classType` can reach with gear you own anywhere (vault and
 * other characters included; postmaster items don't count until pulled).
 */
export function maxPower(items: Row[], classType: number): PowerBreakdown {
  const usable = items.filter((i) => i.power && (i.classType === 3 || i.classType === classType));
  const weapons = bestSlots(WEAPON_POWER_BUCKETS, usable.filter((i) => i.itemType === 3));
  const armor = bestSlots(ARMOR_POWER_BUCKETS, usable.filter((i) => i.itemType === 2));
  const all = [...weapons, ...armor];
  return { weapons, armor, total: all.reduce((s, x) => s + x.power, 0) / all.length };
}
