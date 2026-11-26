// Popular builds for set- and build-aware armor cleanup: one small JSON file, seeded with the
// starting list. Hand edits to .data/builds.json are fine; bad entries are skipped on read.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanBuilds, DEFAULT_BUILDS, type PopularBuild } from '@triumvirate/core';

export function createBuildStore(dataDir: string) {
  const file = join(dataDir, 'builds.json');
  let cache: { builds: PopularBuild[]; custom: boolean } | undefined;
  let version = 0;
  return {
    /** Bumps on every save, so views built from the old list are rebuilt. */
    get version() { return version; },
    async get(): Promise<{ builds: PopularBuild[]; custom: boolean }> {
      if (cache) return cache;
      try {
        const raw = JSON.parse(await readFile(file, 'utf8')) as { builds?: unknown };
        cache = { builds: cleanBuilds(raw.builds), custom: true };
      } catch { cache = { builds: DEFAULT_BUILDS, custom: false }; }
      return cache;
    },
    /** Saves a new list; `null` goes back to the starting list. */
    async set(next: PopularBuild[] | null) {
      version++;
      await mkdir(dataDir, { recursive: true });
      if (next === null) {
        cache = { builds: DEFAULT_BUILDS, custom: false };
        await writeFile(`${file}.tmp`, JSON.stringify({ builds: DEFAULT_BUILDS }, null, 2));
      } else {
        cache = { builds: cleanBuilds(next), custom: true };
        await writeFile(`${file}.tmp`, JSON.stringify({ builds: cache.builds }, null, 2));
      }
      await rename(`${file}.tmp`, file);
      return cache;
    },
  };
}
