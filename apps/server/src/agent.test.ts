import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTools, enrichBuilds, type AgentContext } from './agent.ts';

const ctx: AgentContext = {
  displayName: 'Guardian',
  characters: [{ id: 'c1', className: 'Warlock', classType: 2, light: 2010, lastPlayed: '2026-11-24' }],
  items: [
    { location: 'Vault', owner: 'vault', name: 'Sunshot', type: 'Hand Cannon', bucket: 'Energy Weapons', equipped: false,
      itemHash: 1, instanceId: 'a', tier: 'Exotic', itemType: 3, classType: 3, locked: false, damage: 'Solar',
      perks: [[{ name: 'Sun Blast', active: true }]], appraisal: { verdict: 'unrated', pve: false, pvp: false, rollCount: 0 } },
    { location: 'Vault', owner: 'vault', name: 'Fatebringer', type: 'Hand Cannon', bucket: 'Kinetic Weapons', equipped: false,
      itemHash: 2, instanceId: 'b', tier: 'Legendary', itemType: 3, classType: 3, locked: false, damage: 'Kinetic',
      appraisal: { verdict: 'god', pve: true, pvp: false, rollCount: 9 } },
  ],
  cleanup: [],
};
const tools = Object.fromEntries(buildTools(() => ctx).map((t) => [t.name, t]));
// Each tool's input type differs; tests call them through one loose signature.
const run = async (name: string, input: object) =>
  JSON.parse(String(await (tools[name]!.run as (i: object) => Promise<unknown>)(input)));

test('search_items matches every word and filters by verdict', async () => {
  const solar = await run('search_items', { query: 'solar hand' });
  assert.deepEqual(solar.items.map((i: { name: string }) => i.name), ['Sunshot']);
  const god = await run('search_items', { query: '', verdict: 'god' });
  assert.deepEqual(god.items.map((i: { name: string }) => i.name), ['Fatebringer']);
});

test('get_item returns perks, and a clear error for an unknown id', async () => {
  const item = await run('get_item', { id: 'a' });
  assert.deepEqual(item.perks, [['Sun Blast (slotted)']]);
  const missing = await run('get_item', { id: 'zzz' });
  assert.match(missing.error, /No item/);
});

test('inventory_summary lists exotics and counts', async () => {
  const s = await run('inventory_summary', {});
  assert.equal(s.itemCounts.Vault, 2);
  assert.deepEqual(s.exotics.map((i: { name: string }) => i.name), ['Sunshot']);
});

test('enrichBuilds adds subclass icons and drops items the player does not own', () => {
  const c: AgentContext = {
    ...ctx,
    characters: [{ ...ctx.characters[0]!, stats: [{ name: 'Grenade', value: 100, icon: 'g.png' }] }],
    subclass: { options: new Map(), byName: new Map([['nova bomb', { name: 'Nova Bomb', icon: 'n.png' }]]) },
  };
  const out = enrichBuilds(
    'Try this:\n```build\n{"name":"Nova","super":"nova bomb","aspects":["Made Up"],"weapons":[{"id":"a"},{"id":"nope"}],"statPriority":["Grenade"]}\n```',
    c,
  );
  const json = JSON.parse(/```build\n(.*)\n```/.exec(out)![1]!);
  assert.deepEqual(json.super, { name: 'Nova Bomb', icon: 'n.png' }); // JSON drops undefined
  assert.deepEqual(json.aspects, [{ name: 'Made Up' }]);
  assert.deepEqual(json.weapons, [{ id: 'a' }]);
  assert.deepEqual(json.statPriority, [{ name: 'Grenade', icon: 'g.png' }]);
});

test('subclass_options explains when data is missing', async () => {
  const r = await run('subclass_options', { class: 'Warlock', element: 'Void' });
  assert.match(r.error, /loading/);
});
