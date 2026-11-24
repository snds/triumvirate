import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HttpClientConfig } from 'bungie-api-ts/http';
import type { ManifestTables } from '@triumvirate/core';
import { createCommunity } from './community.ts';

const GUN = 100;
const manifest = {
  version: 't',
  items: { [GUN]: { displayProperties: { name: 'Gun' }, itemTypeDisplayName: 'Hand Cannon', inventory: { tierType: 5 } }, 5: { displayProperties: { name: 'Firefly' } } },
  buckets: {}, stats: {},
  extras: { [GUN]: { socketCategories: [[4241085061, [0]]], socketEntries: [[13, 0]] }, 5: { plugCategory: 'frames' } },
  plugSets: { 13: [5] },
} as unknown as ManifestTables;

const NOW = new Date('2026-11-24T22:00:00Z');
const v = (value: number) => ({ basic: { value } });

/** A tiny fake Bungie: two players who were in the same raid an hour ago. */
function fakeBungie() {
  const calls: string[] = [];
  const profile = (charId: string, inst: string) => ({
    profile: { data: { characterIds: [charId] } },
    characterEquipment: { data: { [charId]: { items: [{ itemHash: GUN, itemInstanceId: inst }] } } },
    itemComponents: { sockets: { data: { [inst]: { sockets: [{ plugHash: 5 }] } } } },
  });
  const http = async <T>(c: HttpClientConfig): Promise<T> => {
    calls.push(c.url);
    let Response: unknown;
    if (c.url.includes('/Profile/p1/')) Response = profile('c1', 'i1');
    else if (c.url.includes('/Profile/p2/')) Response = profile('c2', 'i2');
    else if (c.url.includes('/Activities/')) Response = { activities: [{ period: '2026-11-24T21:00:00Z', activityDetails: { instanceId: 'm1' } }] };
    else if (c.url.includes('PostGameCarnageReport/m1')) {
      const entry = (id: string, ch: string) => ({
        standing: 0, characterId: ch, values: { completed: v(1) },
        player: { destinyUserInfo: { membershipType: 3, membershipId: id, crossSaveOverride: 0 } },
        extended: { weapons: [{ referenceId: GUN, values: { uniqueWeaponKills: v(20) } }] },
      });
      Response = { period: '2026-11-24T21:00:00Z', activityDetails: { instanceId: 'm1', mode: 4, modes: [7, 4] }, entries: [entry('p1', 'c1'), entry('p2', 'c2')] };
    } else throw new Error(`Bungie API error 7: unexpected ${c.url}`);
    return { ErrorCode: 1, Response } as T;
  };
  return { http, calls };
}

test('a crawl samples rolls from recent matches and writes a rollup', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'tri-community-'));
  const { http, calls } = fakeBungie();
  const c = createCommunity({
    dataDir, http, manifest: async () => manifest, seed: async () => ({ membershipType: 3, membershipId: 'p1' }),
    sleep: async () => {}, now: () => NOW,
  });
  const status = await c.crawl({ ratePerSecond: 1000 });
  assert.equal(status.error, undefined);
  assert.equal(status.matches, 1);
  assert.equal(status.samples, 2);
  // Each profile is fetched once even though both players are visited.
  assert.equal(calls.filter((u) => u.includes('/Profile/')).length, 2);

  const w = await c.weapon(GUN);
  const raid = w.weapon!.roles[0]!;
  assert.equal(raid.role, 'pve-endgame');
  assert.equal(raid.copies, 2);
  assert.equal(raid.columns[0]![0]!.share, 1);
  assert.deepEqual(w.trend, [{ month: '2026-11', roles: [{ role: 'pve-endgame', copies: 2, shareOfRole: 1 }] }]);

  // A second crawl skips the match it already saw.
  const again = await c.crawl({ ratePerSecond: 1000 });
  assert.equal(again.matches, 0);
  const lines = (await readFile(join(dataDir, 'community', 'samples-2026-11.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 2);
  assert.doesNotMatch(lines.join(), /p1|p2/); // no player ids on disk in samples
});

test('a crawl stops at its request budget and keeps what it found', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'tri-community-'));
  const { http, calls } = fakeBungie();
  const c = createCommunity({
    dataDir, http, manifest: async () => manifest, seed: async () => ({ membershipType: 3, membershipId: 'p1' }),
    sleep: async () => {}, now: () => NOW,
  });
  const status = await c.crawl({ maxRequests: 3, ratePerSecond: 1000 });
  assert.equal(calls.length, 3);
  assert.equal(status.running, false);
  assert.equal(status.lastRun?.requests, 3);
});

test('a crawl without item data reports why and keeps saved state', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'tri-community-'));
  const c = createCommunity({
    dataDir, http: fakeBungie().http, manifest: async () => undefined, seed: async () => undefined, sleep: async () => {}, now: () => NOW,
  });
  const status = await c.crawl();
  assert.match(status.error ?? '', /not loaded/);
});
