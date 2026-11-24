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
} from 'bungie-api-ts/destiny2';
import { BUNGIE_ROOT } from './bungie.ts';

export interface ManifestTables {
  version: string;
  items: Record<string, DestinyInventoryItemLiteDefinition>;
  buckets: Record<string, DestinyInventoryBucketDefinition>;
  stats: Record<string, DestinyStatDefinition>;
  /** Element names and icons (Kinetic, Arc, Solar...). Optional so test fixtures can skip it. */
  damageTypes?: Record<string, DestinyDamageTypeDefinition>;
}

const TABLES = {
  items: 'DestinyInventoryItemLiteDefinition',
  buckets: 'DestinyInventoryBucketDefinition',
  stats: 'DestinyStatDefinition',
  damageTypes: 'DestinyDamageTypeDefinition',
} as const;

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

  const load = async (table: string) => {
    const file = join(dir, `${table}.json`);
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch {
      const path = paths[table];
      if (!path) throw new Error(`Manifest has no ${table} table`);
      const res = await fetch(BUNGIE_ROOT + path);
      if (!res.ok) throw new Error(`Manifest download failed for ${table}: ${res.status}`);
      const text = await res.text();
      await writeFile(file, text);
      return JSON.parse(text);
    }
  };

  const [items, buckets, stats, damageTypes] = await Promise.all([
    load(TABLES.items), load(TABLES.buckets), load(TABLES.stats), load(TABLES.damageTypes),
  ]);
  return { version: m.version, items, buckets, stats, damageTypes };
}
