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

test('a fresh start with only older matches uses them to find players, then samples recent ones', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'tri-community-'));
  const base = fakeBungie();
  // p1 (you) last played two days ago with p2. p2 played a raid an hour ago (m1).
  const http = async <T>(c: HttpClientConfig): Promise<T> => {
    if (c.url.includes('/Account/p1/') && c.url.includes('/Activities/')) {
      return { ErrorCode: 1, Response: { activities: [{ period: '2026-11-22T21:00:00Z', activityDetails: { instanceId: 'old1' } }] } } as T;
    }
    if (c.url.includes('PostGameCarnageReport/old1')) {
      const entry = (id: string) => ({ player: { destinyUserInfo: { membershipType: 3, membershipId: id, crossSaveOverride: 0 } } });
      return { ErrorCode: 1, Response: { entries: [entry('p1'), entry('p2')] } } as T;
    }
    return base.http<T>(c);
  };
  const logs: string[] = [];
  const c = createCommunity({
    dataDir, http, manifest: async () => manifest, seed: async () => ({ membershipType: 3, membershipId: 'p1' }),
    sleep: async () => {}, now: () => NOW, log: (m) => logs.push(m),
  });
  const status = await c.crawl({ ratePerSecond: 1000 });
  assert.equal(status.error, undefined);
  assert.equal(status.matches, 1); // m1 only: the old match found players but wasn't sampled
  assert.equal(status.samples, 2);
  assert.match(logs[0]!, /fresh start/);
  assert.match(logs.at(-1)!, /1 matches, 2 samples, 1 older matches used to find players/);
});

test('a failed crawl is logged, not only kept in the status', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'tri-community-'));
  const errors: string[] = [];
  const c = createCommunity({
    dataDir, http: fakeBungie().http, manifest: async () => undefined, seed: async () => undefined,
    sleep: async () => {}, now: () => NOW, log: () => {}, logError: (m, e) => errors.push(`${m} ${(e as Error)?.message ?? ''}`),
  });
  await c.crawl({}, 'schedule');
  assert.deepEqual(errors, ['Crawl (schedule) failed: Item data is not loaded yet.']);
});

test('a Bungie call that hangs is given up on, so the crawl finishes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dataDir = await mkdtemp(join(tmpdir(), 'tri-community-'));
  const c = createCommunity({
    dataDir, http: () => new Promise(() => {}), manifest: async () => manifest, seed: async () => ({ membershipType: 3, membershipId: 'p1' }),
    sleep: async () => {}, now: () => NOW, log: () => {},
  });
  const run = c.crawl({ ratePerSecond: 1000 });
  for (let i = 0; i < 5; i++) { await new Promise<void>((r) => setImmediate(r)); t.mock.timers.tick(30_000); }
  const status = await run;
  assert.equal(status.running, false);
  assert.equal(status.matches, 0);
});

test('the schedule says when it will run, fires once in its hour, and rejects a bad hour', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const dataDir = await mkdtemp(join(tmpdir(), 'tri-community-'));
  let clock = new Date('2026-11-25T16:30:00Z');
  const logs: string[] = [];
  const errors: string[] = [];
  const { http } = fakeBungie();
  const c = createCommunity({
    dataDir, http, manifest: async () => manifest, seed: async () => ({ membershipType: 3, membershipId: 'p1' }),
    sleep: async () => {}, now: () => clock, timeZone: 'UTC', log: (m) => logs.push(m), logError: (m) => errors.push(m),
  });
  // Bad values never schedule anything, and say why.
  c.schedule(Number('3am'));
  assert.match(errors[0]!, /must be a whole hour/);

  // getHours() follows the process time zone, so pick the hour the clock will read locally.
  const hour = new Date('2026-11-26T03:00:00Z').getHours();
  const stop = c.schedule(hour);
  assert.match(logs[0]!, /Nightly crawl scheduled for/);
  assert.match(logs[0]!, /Next run:/);

  t.mock.timers.tick(5 * 60_000); // not the hour yet
  assert.equal(logs.length, 1);
  clock = new Date('2026-11-26T03:02:00Z');
  t.mock.timers.tick(5 * 60_000);
  clock = new Date('2026-11-26T03:07:00Z');
  t.mock.timers.tick(5 * 60_000); // same hour again: no second run
  // The crawl writes files, so give it real time to finish (only setInterval is faked).
  for (let i = 0; i < 100 && !logs.some((m) => m.startsWith('Next nightly crawl')); i++) await new Promise<void>((r) => setTimeout(r, 10));
  assert.equal(logs.filter((m) => m.startsWith('Crawl (schedule) started')).length, 1);
  assert.ok(logs.some((m) => m.startsWith('Crawl (schedule) finished')));
  assert.ok(logs.some((m) => m.startsWith('Next nightly crawl')));
  stop();
});
