// Downloads the community wish list at most once a day and keeps the parsed copy in memory.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseWishList, VOLTRON_URL, type WishList } from '@triumvirate/core';

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function createWishListCache(dataDir: string, fetchImpl: typeof fetch = fetch) {
  const file = join(dataDir, 'wishlist', 'voltron.txt');
  let parsed: { list: WishList; loadedAt: number } | undefined;

  async function download(): Promise<string> {
    const res = await fetchImpl(VOLTRON_URL);
    if (!res.ok) throw new Error(`Wish list download failed: ${res.status}`);
    const text = await res.text();
    await mkdir(join(dataDir, 'wishlist'), { recursive: true });
    await writeFile(file, text);
    return text;
  }

  return async function get(): Promise<WishList> {
    if (parsed && Date.now() - parsed.loadedAt < MAX_AGE_MS) return parsed.list;
    let text: string;
    try {
      const age = Date.now() - (await stat(file)).mtimeMs;
      text = age < MAX_AGE_MS ? await readFile(file, 'utf8') : await download().catch(() => readFile(file, 'utf8'));
    } catch {
      text = await download(); // no cached copy yet
    }
    parsed = { list: parseWishList(text), loadedAt: Date.now() };
    return parsed.list;
  };
}
