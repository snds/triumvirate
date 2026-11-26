// Triumphs you track in this app (the game tracks only one), kept in .data/tracked-records.json.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const MAX = 200;
const valid = (h: unknown): h is number => typeof h === 'number' && Number.isInteger(h) && h > 0 && h <= 0xffffffff;

export function createTrackedStore(dataDir: string) {
  const file = join(dataDir, 'tracked-records.json');
  let cached: number[] | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const read = async (): Promise<number[]> => {
    if (cached) return cached;
    try {
      const raw = JSON.parse(await readFile(file, 'utf8')) as { hashes?: unknown[] };
      cached = (raw.hashes ?? []).filter(valid);
    } catch { cached = []; }
    return cached;
  };
  const save = (next: number[]) => {
    const run = queue.then(async () => {
      cached = [...new Set(next.filter(valid))].slice(0, MAX);
      await mkdir(dataDir, { recursive: true });
      await writeFile(`${file}.tmp`, JSON.stringify({ hashes: cached }));
      await rename(`${file}.tmp`, file);
      return cached;
    });
    queue = run.catch(() => {});
    return run;
  };
  return {
    read,
    /** Turns tracking on or off for one record; returns the list. */
    async set(hash: number, on: boolean) {
      const now = await read();
      return save(on ? [hash, ...now.filter((h) => h !== hash)] : now.filter((h) => h !== hash));
    },
    /** Replaces the list (from a backup). */
    replace: (hashes: unknown[]) => save(hashes.filter(valid)),
    valid,
  };
}
