import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weaponOrnaments } from './ornaments.ts';

// Shapes from the live manifest: Ace of Spades' socket 6 starts on "Default Ornament"
// (exotic_all_skins) and draws from reusable plug set 1161538881.
const manifest = {
  items: {
    347366834: { displayProperties: { name: 'Ace of Spades', icon: '/ace.jpg' } },
    100: { displayProperties: { name: 'Default Ornament', icon: '/def.jpg' } },
    101: { displayProperties: { name: 'Last Hand', icon: '/lh.jpg' } },
    102: { displayProperties: { name: 'Salute to the Colonel', icon: '/sc.jpg' } },
    200: { displayProperties: { name: 'Some shader', icon: '/sh.jpg' } },
  },
  extras: {
    347366834: { screenshot: '/ace-shot.jpg', socketEntries: [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [1161538881, 100]] },
    100: { plugCategory: 'exotic_all_skins' },
    101: { plugCategory: 'v400_repackage_hand_cannon0_skins', screenshot: '/lh-shot.jpg' },
    102: { plugCategory: 'v400_repackage_hand_cannon0_skins', screenshot: '/sc-shot.jpg' },
    200: { plugCategory: 'shader' },
  },
  plugSets: { 1161538881: [101, 102, 100, 200] },
} as never;

test('ornaments: default first, unlocked from the account plug set, applied marked, renders kept', () => {
  const profile = {
    profilePlugSets: { data: { plugs: { 1161538881: [{ plugItemHash: 102, canInsert: true, enabled: true }, { plugItemHash: 101, canInsert: false, enabled: true }] } } },
    itemComponents: { sockets: { data: { gun: { sockets: [{}, {}, {}, {}, {}, {}, { plugHash: 102 }] } } } },
  } as never;
  const o = weaponOrnaments(profile, manifest, 'gun', 347366834)!;
  assert.equal(o.socketIndex, 6);
  assert.deepEqual(o.options.map((x) => [x.name, x.unlocked, !!x.applied]), [
    ['Default', true, false], ['Salute to the Colonel', true, true], ['Last Hand', false, false],
  ]);
  assert.equal(o.options[0]!.screenshot, 'https://www.bungie.net/ace-shot.jpg');
  assert.equal(o.options[2]!.screenshot, 'https://www.bungie.net/lh-shot.jpg');
});

test('no ornament socket, no strip', () => {
  const m = { ...(manifest as object), extras: { 5: { socketEntries: [[0, 0]] } } } as never;
  assert.equal(weaponOrnaments({} as never, m, 'x', 5), undefined);
});
