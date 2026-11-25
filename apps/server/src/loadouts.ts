// Triumvirate's own loadouts: one JSON file under .data, since there are only ever a few dozen.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { SavedLoadout } from '@triumvirate/core';

const ID = /^lo-[a-z0-9]{6,32}$/;
export const validLoadoutId = (id: string) => ID.test(id);

export function createLoadoutStore(dataDir: string) {
  const file = join(dataDir, 'loadouts.json');
  const read = async (): Promise<SavedLoadout[]> => {
    try { return JSON.parse(await readFile(file, 'utf8')) as SavedLoadout[]; } catch { return []; }
  };
  // Write to a side file, then swap it in, so a crash mid-write never leaves half a file.
  const write = async (list: SavedLoadout[]) => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(list, null, 1));
    await rename(`${file}.tmp`, file);
  };
  // One change at a time, so two quick saves can't overwrite each other.
  let queue: Promise<unknown> = Promise.resolve();
  const locked = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  };
  return {
    list: read,
    async get(id: string) { return (await read()).find((l) => l.id === id); },
    create: (data: Pick<SavedLoadout, 'name' | 'classType' | 'items' | 'notes' | 'subclass' | 'artifact'>) => locked(async () => {
      const now = new Date().toISOString();
      const loadout: SavedLoadout = { id: `lo-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`, ...data, createdAt: now, updatedAt: now };
      await write([loadout, ...(await read())]);
      return loadout;
    }),
    update: (id: string, data: Partial<Pick<SavedLoadout, 'name' | 'classType' | 'items' | 'notes' | 'subclass' | 'artifact'>>) => locked(async () => {
      const list = await read();
      const n = list.findIndex((l) => l.id === id);
      if (n < 0) return undefined;
      const next: SavedLoadout = { ...list[n]!, ...data, updatedAt: new Date().toISOString() };
      // A field sent as undefined is cleared.
      for (const [k, v] of Object.entries(data)) if (v === undefined) delete (next as unknown as Record<string, unknown>)[k];
      list[n] = next;
      await write(list);
      return next;
    }),
    remove: (id: string) => locked(async () => {
      await write((await read()).filter((l) => l.id !== id));
    }),
  };
}
