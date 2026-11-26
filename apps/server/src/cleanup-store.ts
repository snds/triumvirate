// Cleanup autopilot decisions (dismantle queue, keeps, cleared history): one small JSON file.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { emptyCleanupState, type CleanupState } from '@triumvirate/core';

export function createCleanupStore(dataDir: string) {
  const file = join(dataDir, 'cleanup.json');
  let cache: CleanupState | undefined;
  return {
    async get(): Promise<CleanupState> {
      if (cache) return cache;
      try {
        const s = JSON.parse(await readFile(file, 'utf8')) as Partial<CleanupState>;
        cache = { decisions: s.decisions ?? {}, cleared: s.cleared ?? [] };
      } catch { cache = emptyCleanupState(); }
      return cache;
    },
    /** Writes a side file, then swaps it in, so a crash never leaves half a file. */
    async set(next: CleanupState) {
      cache = next;
      await mkdir(dataDir, { recursive: true });
      await writeFile(`${file}.tmp`, JSON.stringify(next));
      await rename(`${file}.tmp`, file);
    },
  };
}
