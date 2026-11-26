// The watch list and its latest hits, kept in .data/watch.json. Writes go through one queue so a
// check finishing while you add a watch can't drop either change.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { emptyWatchState, type WatchState } from '@triumvirate/core';

export function createWatchStore(dataDir: string) {
  const file = join(dataDir, 'watch.json');
  const read = async (): Promise<WatchState> => {
    try { return { ...emptyWatchState(), ...(JSON.parse(await readFile(file, 'utf8')) as Partial<WatchState>) }; } catch { return emptyWatchState(); }
  };
  let queue: Promise<unknown> = Promise.resolve();
  return {
    read,
    /** Reads, changes, and saves in one step; returns what `fn` returns. */
    update<T>(fn: (s: WatchState) => { state: WatchState; result: T } | Promise<{ state: WatchState; result: T }>): Promise<T> {
      const run = queue.then(async () => {
        const { state, result } = await fn(await read());
        await mkdir(dataDir, { recursive: true });
        await writeFile(`${file}.tmp`, JSON.stringify(state));
        await rename(`${file}.tmp`, file);
        return result;
      });
      queue = run.catch(() => {});
      return run;
    },
  };
}
