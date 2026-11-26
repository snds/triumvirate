import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyWatchCheck, cleanWantedPerks, emptyWatchState, findWatchHits, forgetWatch, matchWatch, watchNotice, type WatchEntry } from './watch.ts';
import type { PerkOption } from './vault.ts';

const perk = (name: string, active = true): PerkOption => ({ name, active });
const entry = (over: Partial<WatchEntry> = {}): WatchEntry => ({
  id: 'w1', itemHash: 100, name: 'Fatebringer', perks: [['Explosive Payload'], ['Firefly', 'Kill Clip']], createdAt: '2026-11-01T00:00:00Z', ...over,
});
const roll = (id: string, names: string[][]) => ({ itemHash: 100, instanceId: id, name: 'Fatebringer', perks: names.map((c) => c.map((n, i) => perk(n, i === 0))) });

describe('matchWatch', () => {
  it('needs one perk from every wanted group, in any column, enhanced or not', () => {
    assert.deepEqual(matchWatch(entry(), roll('a', [['Explosive Payload'], ['Kill Clip Enhanced']])), ['Explosive Payload', 'Kill Clip']);
    assert.equal(matchWatch(entry(), roll('a', [['Explosive Payload'], ['Rampage']])), undefined);
  });
  it('counts switchable perks in multi-perk columns', () => {
    assert.ok(matchWatch(entry(), roll('a', [['Outlaw', 'Explosive Payload'], ['Firefly']])));
  });
  it('matches any roll when no perks are wanted, and checks the grade floor', () => {
    const any = entry({ perks: [], minGrade: 'A' });
    assert.deepEqual(matchWatch(any, roll('a', []), 'S'), []);
    assert.equal(matchWatch(any, roll('a', []), 'B'), undefined);
    assert.equal(matchWatch(any, roll('a', [])), undefined);
  });
  it('ignores other weapons', () => {
    assert.equal(matchWatch(entry({ perks: [] }), { ...roll('a', []), itemHash: 7 }), undefined);
  });
});

describe('cleanWantedPerks', () => {
  it('drops junk, empty groups, and enhanced suffixes', () => {
    assert.deepEqual(cleanWantedPerks([['Kill Clip Enhanced', 'Kill Clip', 3], [], 'x']), [['Kill Clip']]);
    assert.deepEqual(cleanWantedPerks('nope'), []);
  });
});

describe('watch checks', () => {
  const now = new Date('2026-11-26T18:00:00Z');
  const vendors = { items: [{ ...roll('vendor-1-4', [['Explosive Payload'], ['Firefly']]), vendorHash: 1, vendorName: 'Banshee-44' }], grades: { 'vendor-1-4': { grade: 'A' as const } } };
  const owned = { items: [{ ...roll('i1', [['Explosive Payload'], ['Kill Clip']]), location: 'Vault' }], grades: {} };

  it('finds vendor offers and owned copies', () => {
    const hits = findWatchHits([entry()], { vendors, owned, now });
    assert.deepEqual(hits.map((h) => [h.source, h.where, h.grade]), [['vendor', 'Banshee-44', 'A'], ['drop', 'Vault', undefined]]);
  });

  it('alerts each hit once, and skips copies you owned when the watch was added', () => {
    const s0 = { ...emptyWatchState(), entries: [entry()] };
    const first = applyWatchCheck(s0, findWatchHits(s0.entries, { vendors, owned, now }), now);
    assert.deepEqual(first.fresh.map((h) => h.source), ['vendor']);
    assert.equal(first.state.entries[0]!.primed, true);
    assert.equal(first.state.hits.length, 2);

    const drop = { items: [...owned.items, { ...roll('i2', [['Explosive Payload'], ['Firefly']]), location: 'Hunter' }], grades: {} };
    const later = new Date('2026-11-26T19:00:00Z');
    const second = applyWatchCheck(first.state, findWatchHits(first.state.entries, { vendors, owned: drop, now: later }), later);
    assert.deepEqual(second.fresh.map((h) => h.instanceId), ['i2']);
    // The vendor hit keeps the time it was first found.
    assert.equal(second.state.hits.find((h) => h.source === 'vendor')!.foundAt, now.toISOString());
  });

  it('forgets a watch so a changed one alerts again', () => {
    const s0 = { ...emptyWatchState(), entries: [entry()] };
    const { state } = applyWatchCheck(s0, findWatchHits(s0.entries, { vendors, owned, now }), now);
    const gone = forgetWatch(state, 'w1');
    assert.deepEqual(gone.hits, []);
    assert.deepEqual(gone.alerted, []);
  });

  it('writes one alert, vendor first', () => {
    const hits = findWatchHits([entry()], { vendors, owned, now });
    assert.deepEqual(watchNotice(hits), {
      title: 'Banshee-44 is selling Fatebringer',
      body: 'Fatebringer with Explosive Payload and Firefly, A grade. Plus 1 more on your watch list.',
    });
    assert.equal(watchNotice([]), undefined);
  });
});
