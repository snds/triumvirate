import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWishListCache } from './wishlist-cache.ts';

test('downloads once, then serves the parsed copy from memory', async () => {
  let calls = 0;
  const fakeFetch = (async () => {
    calls++;
    return new Response('dimwishlist:item=5&perks=1\n');
  }) as unknown as typeof fetch;
  const get = createWishListCache(await mkdtemp(join(tmpdir(), 'tri-')), fakeFetch);
  assert.equal((await get()).get(5)?.length, 1);
  await get();
  assert.equal(calls, 1);
});

test('extra wish lists merge with voltron, toggle off, and are removed', async () => {
  const files: Record<string, string> = {
    'https://example.com/voltron.txt': 'dimwishlist:item=5&perks=1\n',
    'https://example.com/just-another-team.txt': 'dimwishlist:item=5&perks=2\ndimwishlist:item=6&perks=3\n',
    'https://example.com/empty.txt': 'nothing here\n',
  };
  const fakeFetch = (async (url: string) => {
    const u = url.includes('48klocs') ? 'https://example.com/voltron.txt' : url;
    return files[u] ? new Response(files[u]) : new Response('no', { status: 404 });
  }) as unknown as typeof fetch;
  const dir = await mkdtemp(join(tmpdir(), 'tri-'));
  const lists = createWishListCache(dir, fakeFetch);
  assert.equal((await lists()).get(5)?.length, 1);

  const v0 = lists.version;
  const added = await lists.add('https://example.com/just-another-team.txt');
  assert.ok(lists.version > v0);
  const extra = added.find((s) => s.id !== 'voltron')!;
  assert.equal(extra.name, 'Just Another Team');
  assert.equal(extra.rolls, 2);
  assert.equal((await lists()).get(5)?.length, 2);
  assert.equal((await lists()).get(6)?.length, 1);

  await assert.rejects(lists.add('http://example.com/x.txt'), /https/);
  await assert.rejects(lists.add('https://example.com/empty.txt'), /no wish list rolls/);
  await assert.rejects(lists.add('https://example.com/just-another-team.txt'), /already added/);

  await lists.setEnabled('voltron', false);
  assert.equal((await lists()).get(5)?.length, 1);
  await assert.rejects(lists.setEnabled(extra.id, false), /at least one/);
  await assert.rejects(lists.remove('voltron'), /turned off/);

  // A fresh cache reads the saved sources back.
  const again = createWishListCache(dir, fakeFetch);
  assert.deepEqual((await again.sources()).map((s) => [s.id, s.enabled]), [['voltron', false], [extra.id, true]]);

  // Removing the only enabled list turns voltron back on.
  await again.remove(extra.id);
  assert.deepEqual((await again.sources()).map((s) => [s.id, s.enabled]), [['voltron', true]]);
});

test('restoring sources drops ids that could escape the folder', async () => {
  const lists = createWishListCache(await mkdtemp(join(tmpdir(), 'tri-')), (async () => new Response('dimwishlist:item=5&perks=1\n')) as unknown as typeof fetch);
  await lists.restore([{ id: '../../etc', name: 'x', url: 'https://example.com/a.txt', enabled: true }, { id: 'wl-0123456789', name: 'Mine', url: 'https://example.com/b.txt', enabled: true }]);
  assert.deepEqual((await lists.sources()).map((s) => s.id), ['voltron', 'wl-0123456789']);
});
