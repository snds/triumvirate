// Daily digests: one JSON file per day under .data/digests, the last 30 kept.
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Digest } from '@triumvirate/core';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const validDigestDate = (d: string) => DAY.test(d);
const KEEP = 30;

/** Local date as YYYY-MM-DD (the server runs in your time zone, so "today" is yours). */
export const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function createDigestStore(dataDir: string) {
  const dir = join(dataDir, 'digests');
  const dates = async () => {
    try { return (await readdir(dir)).map((f) => f.replace(/\.json$/, '')).filter(validDigestDate).sort().reverse(); } catch { return []; }
  };
  const get = async (date: string): Promise<Digest | undefined> => {
    if (!validDigestDate(date)) return undefined;
    try { return JSON.parse(await readFile(join(dir, `${date}.json`), 'utf8')) as Digest; } catch { return undefined; }
  };
  return {
    dates,
    get,
    async latest() { const [d] = await dates(); return d ? get(d) : undefined; },
    /** The most recent digest from before `date`, to tell what's new since. */
    async before(date: string) { const d = (await dates()).find((x) => x < date); return d ? get(d) : undefined; },
    async save(digest: Digest) {
      await mkdir(dir, { recursive: true });
      const file = join(dir, `${digest.date}.json`);
      await writeFile(`${file}.tmp`, JSON.stringify(digest));
      await rename(`${file}.tmp`, file);
      for (const old of (await dates()).slice(KEEP)) await rm(join(dir, `${old}.json`), { force: true });
    },
  };
}
