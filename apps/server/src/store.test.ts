import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, type Snapshot } from './store.ts';

const snap = (t: string) => ({ syncedAt: t, membershipType: 3, membershipId: '1', displayName: 'x', profile: {} }) as unknown as Snapshot;

test('returns the newest snapshot and caps how many are kept', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tri-'));
  const store = createStore(dir);
  assert.equal(await store.latestSnapshot(), undefined);
  for (let i = 0; i < 55; i++) {
    await store.saveSnapshot(snap(new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()));
  }
  assert.equal((await store.latestSnapshot())?.syncedAt, '2026-01-01T00:54:00.000Z');
  assert.equal((await readdir(join(dir, 'snapshots'))).length, 50);
});

test('token file round-trips and clears', async () => {
  const store = createStore(await mkdtemp(join(tmpdir(), 'tri-')));
  await store.writeTokens({ accessToken: 'a', refreshToken: 'r', accessExpiresAt: 1, refreshExpiresAt: 2, bungieMembershipId: 'm' });
  assert.equal((await store.readTokens())?.accessToken, 'a');
  await store.clearTokens();
  assert.equal(await store.readTokens(), undefined);
});
