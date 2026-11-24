// Downloads only the manifest tables we need and caches them on disk,
// keyed by manifest version so a Bungie patch triggers a fresh download.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HttpClient } from 'bungie-api-ts/http';
import {
  getDestinyManifest,
  type DestinyInventoryBucketDefinition,
  type DestinyInventoryItemLiteDefinition,
} from 'bungie-api-ts/destiny2';
import { BUNGIE_ROOT } from './bungie.ts';

export interface ManifestTables {
  version: string;
  items: Record<string, DestinyInventoryItemLiteDefinition>;
  buckets: Record<string, DestinyInventoryBucketDefinition>;
}

const TABLES = {
  items: 'DestinyInventoryItemLiteDefinition',
  buckets: 'DestinyInventoryBucketDefinition',
} as const;

export async function loadManifest(http: HttpClient, cacheDir: string, lang = 'en'): Promise<ManifestTables> {
  const { Response: m } = await getDestinyManifest(http);
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

  const [items, buckets] = await Promise.all([load(TABLES.items), load(TABLES.buckets)]);
  return { version: m.version, items, buckets };
}
