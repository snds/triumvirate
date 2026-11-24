// File-backed storage for a single-user app: one token file plus timestamped
// profile snapshots. Snapshots are kept so later steps can diff them over time.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DestinyProfileResponse } from 'bungie-api-ts/destiny2';
import type { Tokens } from '@triumvirate/core';

const KEEP_SNAPSHOTS = 50;

export interface Snapshot {
  syncedAt: string;
  membershipType: number;
  membershipId: string;
  displayName: string;
  profile: DestinyProfileResponse;
}

export function createStore(dataDir: string) {
  const tokenFile = join(dataDir, 'tokens.json');
  const snapDir = join(dataDir, 'snapshots');

  return {
    dataDir,
    async readTokens(): Promise<Tokens | undefined> {
      try { return JSON.parse(await readFile(tokenFile, 'utf8')); } catch { return undefined; }
    },
    async writeTokens(t: Tokens) {
      await mkdir(dataDir, { recursive: true });
      await writeFile(tokenFile, JSON.stringify(t));
    },
    async clearTokens() {
      await rm(tokenFile, { force: true });
    },
    async saveSnapshot(s: Snapshot) {
      await mkdir(snapDir, { recursive: true });
      // ISO time with ':' swapped out so the name is valid on Windows; names sort by time.
      await writeFile(join(snapDir, `${s.syncedAt.replace(/:/g, '-')}.json`), JSON.stringify(s));
      const files = (await readdir(snapDir)).filter((f) => f.endsWith('.json')).sort();
      for (const old of files.slice(0, Math.max(0, files.length - KEEP_SNAPSHOTS))) {
        await rm(join(snapDir, old), { force: true });
      }
    },
    async latestSnapshot(): Promise<Snapshot | undefined> {
      let files: string[];
      try { files = (await readdir(snapDir)).filter((f) => f.endsWith('.json')).sort(); } catch { return undefined; }
      const last = files.at(-1);
      return last ? JSON.parse(await readFile(join(snapDir, last), 'utf8')) : undefined;
    },
  };
}
export type Store = ReturnType<typeof createStore>;
