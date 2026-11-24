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
