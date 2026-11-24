// Downloads only the manifest tables we need and caches them on disk,
// keyed by manifest version so a Bungie patch triggers a fresh download.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HttpClient } from 'bungie-api-ts/http';
import {
  getDestinyManifest,
  type DestinyInventoryBucketDefinition,
  type DestinyInventoryItemLiteDefinition,
  type DestinyStatDefinition,
  type DestinyDamageTypeDefinition,
  type DestinyInventoryItemDefinition,
  type DestinyObjectiveDefinition,
  type DestinyStatGroupDefinition,
  type DestinyBreakerTypeDefinition,
  type DestinyPlugSetDefinition,
} from 'bungie-api-ts/destiny2';
import { BUNGIE_ROOT } from './bungie.ts';

export interface ManifestTables {
  version: string;
  items: Record<string, DestinyInventoryItemLiteDefinition>;
  buckets: Record<string, DestinyInventoryBucketDefinition>;
  stats: Record<string, DestinyStatDefinition>;
  /** Element names and icons (Kinetic, Arc, Solar...). Optional so test fixtures can skip it. */
  damageTypes?: Record<string, DestinyDamageTypeDefinition>;
  /** Fields the lite item table leaves out, trimmed from the full table. Optional for fixtures. */
  extras?: Record<string, ItemExtra>;
  /** Stat display order and which stats are plain numbers (RPM, Magazine). */
  statGroups?: Record<string, Pick<DestinyStatGroupDefinition, 'scaledStats'>>;
  /** Objective styles, to find crafted level and kill tracker counts. */
  objectives?: Record<string, ObjectiveExtra>;
  /** Champion stun types (Anti-Barrier, Overload, Unstoppable) with their icons. */
  breakerTypes?: Record<string, Pick<DestinyBreakerTypeDefinition, 'displayProperties'>>;
  /** Plug sets: the plugs each can roll (used for "every possible roll"). */
  plugSets?: Record<string, number[]>;
}

/** The parts of the full item definition the app needs (the full table is hundreds of MB). */
export interface ItemExtra {
  statGroupHash?: number;
  /** e.g. "frames", "barrels", "v400.plugs.weapons.masterworks.stat.stability". */
  plugCategory?: string;
  /** Always-on stat bonuses this item gives when plugged in: [statHash, value]. */
  investment?: [number, number][];
  /** Socket category hash and the socket indexes in it. */
  socketCategories?: [number, number[]][];
  flavorText?: string;
  /** Built-in champion stun (exotics and some legendaries). */
  breakerTypeHash?: number;
  /** Weapons: 1 Primary, 2 Special, 3 Heavy. */
  ammoType?: number;
  /** Weapons: the definition's stats before any perks, [statHash, value]. */
  baseStats?: [number, number][];
  /** Weapons: per socket, [plug set hash (0 if none), the plug it starts with]. */
  socketEntries?: [number, number][];
}

export interface ObjectiveExtra {
  /** DestinyObjectiveUiStyle: 2 = crafted weapon level. */
  uiStyle: number;
  progressDescription?: string;
}

/** Keeps only what ItemExtra needs, for gear and for plugs. */
export function slimItems(full: Record<string, DestinyInventoryItemDefinition>): Record<string, ItemExtra> {
  const out: Record<string, ItemExtra> = {};
  for (const [hash, d] of Object.entries(full)) {
    const gear = d.itemType === 2 || d.itemType === 3;
    if (!gear && !d.plug) continue;
    const x: ItemExtra = {};
    if (gear) {
      if (d.stats?.statGroupHash) x.statGroupHash = d.stats.statGroupHash;
      const cats = d.sockets?.socketCategories;
      if (cats?.length) x.socketCategories = cats.map((c) => [c.socketCategoryHash, c.socketIndexes]);
      if (d.flavorText) x.flavorText = d.flavorText;
      if (d.breakerTypeHash) x.breakerTypeHash = d.breakerTypeHash;
      if (d.itemType === 3) {
        if (d.equippingBlock?.ammoType) x.ammoType = d.equippingBlock.ammoType;
        const base = Object.values(d.stats?.stats ?? {}).filter((st) => st.value !== 0);
        if (base.length) x.baseStats = base.map((st) => [st.statHash, st.value]);
        const entries = d.sockets?.socketEntries ?? [];
        if (entries.length) {
          x.socketEntries = entries.map((e) => [e.randomizedPlugSetHash ?? e.reusablePlugSetHash ?? 0, e.singleInitialItemHash ?? 0]);
        }
      }
    }
    if (d.plug?.plugCategoryIdentifier) x.plugCategory = d.plug.plugCategoryIdentifier;
    const inv = (d.investmentStats ?? []).filter((st) => !st.isConditionallyActive && st.value !== 0);
    if (inv.length) x.investment = inv.map((st) => [st.statTypeHash, st.value]);
    if (Object.keys(x).length) out[hash] = x;
  }
  return out;
}

const TABLES = {
  items: 'DestinyInventoryItemLiteDefinition',
  buckets: 'DestinyInventoryBucketDefinition',
  stats: 'DestinyStatDefinition',
  damageTypes: 'DestinyDamageTypeDefinition',
  statGroups: 'DestinyStatGroupDefinition',
  objectives: 'DestinyObjectiveDefinition',
  fullItems: 'DestinyInventoryItemDefinition',
  breakerTypes: 'DestinyBreakerTypeDefinition',
  plugSets: 'DestinyPlugSetDefinition',
} as const;

/** Bump when a slim table keeps new fields, so cached slim files are rebuilt. */
const SLIM_VERSION = 3;

/**
 * Returns the manifest tables, or undefined when `currentVersion` is already the
 * live version (so a caller holding the tables in memory can skip re-parsing).
 */
export async function loadManifest(http: HttpClient, cacheDir: string, lang?: string): Promise<ManifestTables>;
export async function loadManifest(
  http: HttpClient, cacheDir: string, lang: string, currentVersion: string | undefined,
): Promise<ManifestTables | undefined>;
export async function loadManifest(
  http: HttpClient, cacheDir: string, lang = 'en', currentVersion?: string,
): Promise<ManifestTables | undefined> {
  const { Response: m } = await getDestinyManifest(http);
  if (currentVersion && currentVersion === m.version) return undefined;
  const dir = join(cacheDir, m.version.replace(/[^\w.-]/g, '_'));
  await mkdir(dir, { recursive: true });
  const paths = m.jsonWorldComponentContentPaths[lang];
  if (!paths) throw new Error(`Manifest has no "${lang}" language`);

  const download = async (table: string) => {
    const path = paths[table];
    if (!path) throw new Error(`Manifest has no ${table} table`);
    const res = await fetch(BUNGIE_ROOT + path);
    if (!res.ok) throw new Error(`Manifest download failed for ${table}: ${res.status}`);
    return res.text();
  };
  // Cached as-is, or (when `slim` is given) trimmed first so only the small file is kept.
  const load = async <T>(table: string, slim?: (full: any) => T): Promise<T> => {
    const file = join(dir, `${table}${slim ? `.slim${SLIM_VERSION}` : ''}.json`);
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch {
      const text = await download(table);
      if (!slim) {
        await writeFile(file, text);
        return JSON.parse(text);
      }
      const trimmed = slim(JSON.parse(text));
      await writeFile(file, JSON.stringify(trimmed));
      return trimmed;
    }
  };

  const [items, buckets, stats, damageTypes, statGroups, objectives, breakerTypes, plugSets] = await Promise.all([
    load<ManifestTables['items']>(TABLES.items),
    load<ManifestTables['buckets']>(TABLES.buckets),
    load<ManifestTables['stats']>(TABLES.stats),
    load<NonNullable<ManifestTables['damageTypes']>>(TABLES.damageTypes),
    load(TABLES.statGroups, (full: Record<string, DestinyStatGroupDefinition>) =>
      Object.fromEntries(Object.entries(full).map(([h, g]) => [h, { scaledStats: g.scaledStats }]))),
    load(TABLES.objectives, (full: Record<string, DestinyObjectiveDefinition>) =>
      Object.fromEntries(Object.entries(full).map(([h, o]) => [h, { uiStyle: o.uiStyle, progressDescription: o.progressDescription }]))),
    load(TABLES.breakerTypes, (full: Record<string, DestinyBreakerTypeDefinition>) =>
      Object.fromEntries(Object.entries(full).map(([h, b]) => [h, { displayProperties: b.displayProperties }]))),
    // Plugs that can currently drop; retired ones (currentlyCanRoll false) are left out.
    load(TABLES.plugSets, (full: Record<string, DestinyPlugSetDefinition>) =>
      Object.fromEntries(Object.entries(full).map(([h, ps]) => [h, ps.reusablePlugItems.filter((p) => p.currentlyCanRoll).map((p) => p.plugItemHash)]))),
  ]);
  // The full item table is huge; load it after the others so peak memory stays lower.
  const extras = await load(TABLES.fullItems, slimItems);
  return { version: m.version, items, buckets, stats, damageTypes, statGroups, objectives, breakerTypes, plugSets, extras };
}
