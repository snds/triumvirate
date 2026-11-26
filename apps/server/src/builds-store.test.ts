import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_BUILDS } from '@triumvirate/core';
import { createBuildStore } from './builds-store.ts';

test('starts from the default list, saves edits, and resets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'builds-'));
  const s = createBuildStore(dir);
  assert.deepEqual(await s.get(), { builds: DEFAULT_BUILDS, custom: false });
  const v = s.version;
  await s.set([{ id: 'x', name: 'Mine', classType: 1, activities: ['pvp'], stats: ['Weapons'] }]);
  assert.equal(s.version, v + 1);
  assert.equal((await createBuildStore(dir).get()).builds[0]!.name, 'Mine');
  await s.set(null);
  assert.equal(JSON.parse(await readFile(join(dir, 'builds.json'), 'utf8')).builds.length, DEFAULT_BUILDS.length);
});

test('a hand-edited file with bad entries still loads the good ones', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'builds-'));
  await writeFile(join(dir, 'builds.json'), JSON.stringify({ builds: [{ name: 'ok', classType: 0, activities: ['casual'], stats: ['Melee'] }, { name: 'bad' }] }));
  assert.deepEqual((await createBuildStore(dir).get()).builds.map((b) => b.name), ['ok']);
});
