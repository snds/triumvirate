import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDigestStore, localDate } from './digests.ts';
import type { Digest } from '@triumvirate/core';

const digest = (date: string): Digest => ({ date, builtAt: '', drops: { weapons: [], armor: [], total: 0 }, vendors: [], cleanup: { count: 0, high: 0 }, vault: { used: 0, capacity: 0 }, seen: [date] });

test('digest store: latest, before, and keeps 30', async () => {
  const store = createDigestStore(await mkdtemp(join(tmpdir(), 'digests-')));
  assert.equal(await store.latest(), undefined);
  for (let d = 1; d <= 32; d++) await store.save(digest(`2026-10-${String(d).padStart(2, '0')}`.replace('10-32', '11-01').replace('10-31', '10-31')));
  const dates = await store.dates();
  assert.equal(dates.length, 30);
  assert.equal((await store.latest())!.date, '2026-11-01');
  assert.equal((await store.before('2026-11-01'))!.date, '2026-10-31');
  assert.equal(await store.get('../etc'), undefined);
  assert.match(localDate(new Date(2026, 0, 5)), /^2026-01-05$/);
});
