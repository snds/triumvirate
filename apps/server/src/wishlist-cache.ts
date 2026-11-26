// Wish list sources: the community "voltron" list plus any DIM-format lists you add by URL.
// Each source is downloaded at most once a day and kept on disk; the enabled ones are merged into
// one parsed list in memory. The source list itself lives in .data/wishlists.json.
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parseWishList, VOLTRON_URL, type WishList } from '@triumvirate/core';

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface WishListSource {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

export interface WishListSourceInfo extends WishListSource {
  /** Rolls in this list (0 until it has loaded once). */
  rolls: number;
  /** When the copy on disk was downloaded. */
  updatedAt?: string;
  /** Why the last download failed, if it did. */
  error?: string;
}

const VOLTRON: WishListSource = { id: 'voltron', name: 'Voltron (community)', url: VOLTRON_URL, enabled: true };

/** Only plain https URLs; a wish list is a text file, nothing else gets fetched. */
export function validWishListUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password;
  } catch { return false; }
}

/** A readable name from a URL: "Just Another Team" from .../just-another-team.txt. */
function nameFromUrl(url: string): string {
  const base = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '').replace(/\.txt$/i, '');
  const words = base.replace(/[-_]+/g, ' ').trim();
  return words ? words.replace(/\b\w/g, (c) => c.toUpperCase()) : new URL(url).hostname;
}

/** Ids become file names, so only the shapes we make are allowed. */
const validId = (id: unknown): id is string => typeof id === 'string' && /^(voltron|wl-[a-f0-9]{10})$/.test(id);

const countRolls = (list: WishList) => { let n = 0; for (const r of list.values()) n += r.length; return n; };

export function createWishListCache(dataDir: string, fetchImpl: typeof fetch = fetch) {
  const dir = join(dataDir, 'wishlist');
  const sourcesFile = join(dataDir, 'wishlists.json');
  // voltron keeps its old file name, so existing installs reuse the copy they have.
  const textFile = (id: string) => join(dir, `${id}.txt`);

  let sources: WishListSource[] | undefined;
  const parsed = new Map<string, { list: WishList; loadedAt: number; updatedAt?: string }>();
  const errors = new Map<string, string>();
  let merged: WishList | undefined;
  let version = 0;

  async function readSources(): Promise<WishListSource[]> {
    if (sources) return sources;
    try {
      const raw = JSON.parse(await readFile(sourcesFile, 'utf8')) as { sources?: WishListSource[] };
      const ok = (raw.sources ?? []).filter((s) => s && validId(s.id) && validWishListUrl(s.url));
      sources = ok.some((s) => s.id === VOLTRON.id) ? ok : [VOLTRON, ...ok];
    } catch { sources = [VOLTRON]; }
    return sources;
  }
  async function saveSources(next: WishListSource[]) {
    sources = next;
    merged = undefined;
    version++;
    await mkdir(dataDir, { recursive: true });
    await writeFile(`${sourcesFile}.tmp`, JSON.stringify({ sources: next }, null, 2));
    await rename(`${sourcesFile}.tmp`, sourcesFile);
  }

  async function download(s: WishListSource): Promise<string> {
    const res = await fetchImpl(s.url);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const text = await res.text();
    await mkdir(dir, { recursive: true });
    await writeFile(textFile(s.id), text);
    return text;
  }

  /** Parses one source, downloading it when the disk copy is missing, a day old, or `force` is set. */
  async function load(s: WishListSource, force = false): Promise<WishList> {
    const have = parsed.get(s.id);
    if (have && !force && Date.now() - have.loadedAt < MAX_AGE_MS) return have.list;
    let text: string;
    let mtime: number | undefined;
    try { mtime = (await stat(textFile(s.id))).mtimeMs; } catch { /* no copy yet */ }
    try {
      if (mtime !== undefined && !force && Date.now() - mtime < MAX_AGE_MS) text = await readFile(textFile(s.id), 'utf8');
      else { text = await download(s); mtime = Date.now(); }
      errors.delete(s.id);
    } catch (e) {
      errors.set(s.id, (e as Error).message);
      if (mtime === undefined) throw e; // nothing to fall back on
      text = await readFile(textFile(s.id), 'utf8'); // keep using yesterday's copy
    }
    const list = parseWishList(text);
    parsed.set(s.id, { list, loadedAt: Date.now(), updatedAt: new Date(mtime!).toISOString() });
    merged = undefined;
    return list;
  }

  /** Every enabled list merged into one. A source that fails is skipped; voltron failing with no copy throws. */
  async function get(): Promise<WishList> {
    const enabled = (await readSources()).filter((s) => s.enabled);
    // Reload any list that's gone stale, then rebuild the merge if something changed.
    for (const s of enabled) {
      const have = parsed.get(s.id);
      if (!have || Date.now() - have.loadedAt >= MAX_AGE_MS) {
        try { await load(s); } catch (e) { if (enabled.length === 1) throw e; }
      }
    }
    if (merged) return merged;
    const out: WishList = new Map();
    for (const s of enabled) {
      const list = parsed.get(s.id)?.list;
      if (!list) continue;
      for (const [hash, rolls] of list) out.set(hash, [...(out.get(hash) ?? []), ...rolls]);
    }
    merged = out;
    return merged;
  }

  async function info(): Promise<WishListSourceInfo[]> {
    const all = await readSources();
    return Promise.all(all.map(async (s) => {
      let p = parsed.get(s.id);
      // A disabled list was never loaded; read its disk copy (if any) so the count still shows.
      if (!p) {
        try {
          const mtime = (await stat(textFile(s.id))).mtimeMs;
          p = { list: parseWishList(await readFile(textFile(s.id), 'utf8')), loadedAt: 0, updatedAt: new Date(mtime).toISOString() };
        } catch { /* never downloaded */ }
      }
      return { ...s, rolls: p ? countRolls(p.list) : 0, updatedAt: p?.updatedAt, error: errors.get(s.id) };
    }));
  }

  const api = {
    info,
    /** Downloads every enabled list again now. */
    async refresh() {
      for (const s of (await readSources()).filter((x) => x.enabled)) await load(s, true).catch(() => {});
      merged = undefined;
      version++;
      return info();
    },
    /** Adds a list by URL and downloads it, so a bad URL is caught right away. */
    async add(url: string, name?: string) {
      if (!validWishListUrl(url)) throw new Error('Use an https link to a DIM wish list text file.');
      const all = await readSources();
      if (all.some((s) => s.url === url)) throw new Error('That wish list is already added.');
      const s: WishListSource = {
        id: `wl-${createHash('sha1').update(url).digest('hex').slice(0, 10)}`,
        name: name?.trim().slice(0, 60) || nameFromUrl(url), url, enabled: true,
      };
      const list = await load(s, true).catch((e) => { throw new Error(`Couldn't load that list: ${(e as Error).message}`); });
      if (!list.size) throw new Error('That file has no wish list rolls in it.');
      await saveSources([...all, s]);
      return info();
    },
    async setEnabled(id: string, enabled: boolean) {
      const all = await readSources();
      if (!all.some((s) => s.id === id)) return undefined;
      const next = all.map((s) => (s.id === id ? { ...s, enabled } : s));
      if (!next.some((s) => s.enabled)) throw new Error('Keep at least one wish list on.');
      await saveSources(next);
      return info();
    },
    async remove(id: string) {
      if (id === VOLTRON.id) throw new Error('Voltron can be turned off, not removed.');
      const all = await readSources();
      if (!all.some((s) => s.id === id)) return undefined;
      const next = all.filter((s) => s.id !== id);
      if (!next.some((s) => s.enabled)) next[0] = { ...next[0]!, enabled: true };
      parsed.delete(id);
      await saveSources(next);
      return info();
    },
    /** The source list as saved, for backups. */
    sources: readSources,
    /** Replaces the source list (from a backup). Lists download on next use. */
    async restore(next: WishListSource[]) {
      const ok = next.filter((s) => s && validId(s.id) && typeof s.name === 'string' && validWishListUrl(s.url))
        .map((s) => ({ id: s.id, name: s.name, url: s.url, enabled: !!s.enabled }));
      if (!ok.some((s) => s.id === VOLTRON.id)) ok.unshift({ ...VOLTRON, enabled: !ok.some((s) => s.enabled) });
      await saveSources(ok);
    },
  };
  // Object.assign would copy a getter's value once, so the live version is defined separately.
  Object.defineProperty(get, 'version', { get: () => version, enumerable: true });
  /** `version` bumps whenever the merged list may have changed, so anything graded with it is redone. */
  return Object.assign(get, api) as typeof get & typeof api & { readonly version: number };
}

export type WishListCache = ReturnType<typeof createWishListCache>;
