// Single Bungie definitions, fetched on demand and kept on disk per manifest version. Used for
// tables the app reads only a few dozen rows of (vendors, vendor groups, destinations), where
// downloading the whole table would cost megabytes for nothing.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDestinyEntityDefinition } from 'bungie-api-ts/destiny2';
import type { HttpClient } from 'bungie-api-ts/http';

export type DefType = 'DestinyVendorDefinition' | 'DestinyVendorGroupDefinition' | 'DestinyDestinationDefinition' | 'DestinyProgressionDefinition' | 'DestinyInventoryItemDefinition' | 'DestinyLoreDefinition'
  | 'DestinyMilestoneDefinition' | 'DestinyActivityDefinition' | 'DestinyActivityModifierDefinition' | 'DestinyEventCardDefinition';

export function createDefsCache(dataDir: string) {
  const mem = new Map<string, unknown>();
  const misses = new Map<string, number>();
  const file = (version: string, type: DefType, hash: number) => join(dataDir, 'defs', version.replace(/[^\w.-]/g, '_'), `${type}-${hash >>> 0}.json`);

  /** One definition, or undefined when Bungie doesn't have it (remembered for an hour). */
  async function get<T>(http: HttpClient, version: string, type: DefType, hash: number): Promise<T | undefined> {
    const key = `${version}:${type}:${hash >>> 0}`;
    if (mem.has(key)) return mem.get(key) as T;
    if ((misses.get(key) ?? 0) > Date.now()) return undefined;
    const f = file(version, type, hash);
    try {
      const d = JSON.parse(await readFile(f, 'utf8')) as T;
      mem.set(key, d);
      return d;
    } catch { /* not cached yet */ }
    try {
      const d = (await getDestinyEntityDefinition(http, { entityType: type, hashIdentifier: hash >>> 0 })).Response as T;
      mem.set(key, d);
      await mkdir(join(f, '..'), { recursive: true });
      await writeFile(f, JSON.stringify(d));
      return d;
    } catch {
      misses.set(key, Date.now() + 60 * 60_000);
      return undefined;
    }
  }

  /** Several at once, a few in flight at a time (Bungie throttles bursts). */
  async function many<T>(http: HttpClient, version: string, type: DefType, hashes: number[]): Promise<Map<number, T>> {
    const out = new Map<number, T>();
    const queue = [...new Set(hashes)];
    const worker = async () => {
      for (let h = queue.shift(); h !== undefined; h = queue.shift()) {
        const d = await get<T>(http, version, type, h);
        if (d) out.set(h, d);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    return out;
  }

  return { get, many };
}
