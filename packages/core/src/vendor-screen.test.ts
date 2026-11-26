import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balancesFrom, filterVendors, SILVER_HASH, vendorScreen, type VendorInfo } from './vendor-screen.ts';

const items: Record<string, unknown> = {
  1: { displayProperties: { name: 'Fatebringer', icon: '/f.png' }, itemType: 3, itemTypeDisplayName: 'Hand Cannon', inventory: { tierTypeName: 'Legendary' }, collectibleHash: 11 },
  2: { displayProperties: { name: 'Shiny Shader', icon: '/s.png' }, itemType: 19, itemTypeDisplayName: 'Shader', collectibleHash: 22 },
  3: { displayProperties: { name: 'Eververse Ghost', icon: '/g.png' }, itemType: 24, itemTypeDisplayName: 'Ghost Shell' },
  4: { displayProperties: { name: '', icon: '' } }, // classified
  900: { displayProperties: { name: 'Glimmer', icon: '/gl.png' } },
  [SILVER_HASH]: { displayProperties: { name: 'Silver', icon: '/si.png' } },
};
const info: Record<number, VendorInfo> = {
  100: { name: 'Banshee-44', subtitle: 'Gunsmith', locations: ['The Last City, Earth'], categories: ['Weapons', 'Cosmetics'], failures: ['', 'Requires Gunsmith rank 5'] },
  200: { name: 'Tess Everis', locations: ['Tower'], categories: ['Featured'], failures: [] },
  300: { name: 'Hidden vendor', locations: [], categories: [], failures: [] },
};
const res = {
  vendorGroups: { data: { groups: [{ vendorGroupHash: 7, vendorHashes: [100, 200] }] } },
  vendors: { data: {
    100: { vendorHash: 100, enabled: true, vendorLocationIndex: 0, nextRefreshDate: '2026-11-27T17:00:00Z',
      progression: { progressionHash: 55, level: 2, progressToNextLevel: 120, nextLevelAt: 500, currentResetCount: 1 } },
    200: { vendorHash: 200, enabled: true, vendorLocationIndex: 0, nextRefreshDate: '9999-12-31T23:59:59Z' },
    300: { vendorHash: 300, enabled: true, vendorLocationIndex: 0 },
  } },
  categories: { data: {
    100: { categories: [{ displayCategoryIndex: 0, itemIndexes: [5] }, { displayCategoryIndex: 1, itemIndexes: [6, 7] }] },
    200: { categories: [{ displayCategoryIndex: 0, itemIndexes: [1, 2] }] },
  } },
  sales: { data: {
    100: { saleItems: {
      5: { vendorItemIndex: 5, itemHash: 1, quantity: 1, augments: 0, costs: [{ itemHash: 900, quantity: 10000 }], failureIndexes: [] },
      6: { vendorItemIndex: 6, itemHash: 2, quantity: 1, augments: 0, costs: [{ itemHash: 900, quantity: 500 }], failureIndexes: [1] },
      7: { vendorItemIndex: 7, itemHash: 4, quantity: 1, augments: 0, costs: [], failureIndexes: [] },
    } },
    200: { saleItems: {
      1: { vendorItemIndex: 1, itemHash: 3, quantity: 1, augments: 128, costs: [{ itemHash: SILVER_HASH, quantity: 800 }], failureIndexes: [] },
      2: { vendorItemIndex: 2, itemHash: 2, quantity: 1, augments: 0, costs: [{ itemHash: 900, quantity: 1 }], failureIndexes: [] },
    } },
  } },
} as never;

const screen = () => vendorScreen({
  vendors: res, manifest: { items } as never,
  info: (h) => info[h], group: (h) => (h === 7 ? { name: 'Tower', order: 0 } : undefined),
  rank: (h) => (h === 55 ? { name: 'Gunsmith', steps: [{ name: 'Guardian I', total: 100 }, { name: 'Brave', total: 200 }, { name: 'Heroic', total: 500 }, { name: 'Legend', total: 500 }] } : undefined),
  balances: new Map([[900, 5000]]),
  collectibles: { 11: { state: 0 }, 22: { state: 1 } },
  rowIds: new Set(['vendor-100-5']),
});

test('vendors come out in the game group with categories, costs, ranks, and ownership', () => {
  const [tower, ...rest] = screen();
  assert.equal(tower!.name, 'Tower');
  assert.equal(rest.length, 0); // the hidden vendor sells nothing and has no rank
  const [banshee, tess] = tower!.vendors;
  assert.equal(banshee!.location, 'The Last City, Earth');
  assert.equal(banshee!.refreshesAt, '2026-11-27T17:00:00Z');
  assert.deepEqual(banshee!.rank, { name: 'Gunsmith', rank: 'Heroic', step: 3, steps: 4, progress: 120, next: 500, resets: 1 });
  assert.deepEqual(banshee!.categories.map((c) => [c.name, c.sales.map((s) => s.name)]), [['Weapons', ['Fatebringer']], ['Cosmetics', ['Shiny Shader']]]);
  const [fate] = banshee!.categories[0]!.sales;
  assert.equal(fate!.owned, true);
  assert.equal(fate!.short, true); // 10,000 glimmer, 5,000 held
  assert.equal(fate!.rowId, 'vendor-100-5');
  const shader = banshee!.categories[1]!.sales[0]!;
  assert.equal(shader.owned, false);
  assert.equal(shader.failure, 'Requires Gunsmith rank 5');
  assert.equal(tess!.refreshesAt, undefined); // never refreshes
  assert.equal(tess!.categories[0]!.sales[0]!.silver, true);
  assert.equal(tess!.categories[0]!.sales[0]!.owned, true); // no collectible, but the game says owned
});

test('filters hide owned and silver items, and search matches vendor or item', () => {
  const g = screen();
  const unowned = filterVendors(g, { unowned: true, noSilver: true });
  assert.deepEqual(unowned[0]!.vendors.map((v) => [v.name, v.categories.flatMap((c) => c.sales.map((s) => s.name))]),
    [['Banshee-44', ['Shiny Shader']], ['Tess Everis', ['Shiny Shader']]]);
  assert.deepEqual(filterVendors(g, { query: 'tess' })[0]!.vendors.map((v) => v.name), ['Tess Everis']);
  assert.deepEqual(filterVendors(g, { query: 'hand cannon' })[0]!.vendors.map((v) => v.name), ['Banshee-44']);
  assert.equal(filterVendors(g, { query: 'nothing like this' }).length, 0);
  // The app's Weapons / Armor scope narrows sales by item type.
  assert.deepEqual(filterVendors(g, { itemTypes: [3] })[0]!.vendors.map((v) => [v.name, v.categories.flatMap((c) => c.sales.map((s) => s.name))]),
    [['Banshee-44', ['Fatebringer']]]);
});

test('balances add up currencies and stacks; the character lookup wins', () => {
  const b = balancesFrom({
    profileCurrencies: { data: { items: [{ itemHash: 900, quantity: 100 }] } },
    profileInventory: { data: { items: [{ itemHash: 5, quantity: 10 }, { itemHash: 5, quantity: 3 }] } },
    characterInventories: { data: { c1: { items: [{ itemHash: 5, quantity: 1 }] } } },
    characterCurrencyLookups: { data: { c1: { itemQuantities: { 900: 250 } } } },
  }, 'c1');
  assert.equal(b.get(5), 14);
  assert.equal(b.get(900), 250);
});

test('live-manifest shapes: help pages hidden, placeholders dropped, sub-pages folded into their vendor', () => {
  const its: Record<string, unknown> = {
    ...items,
    50: { displayProperties: { name: 'Xûr' }, itemType: 0, inventory: { tierTypeName: 'Common' } }, // portrait on the help page
    51: { displayProperties: { name: 'Weapons' }, itemType: 0 }, // link to the "Weapons" page
    52: { displayProperties: { name: 'Vanguard Ops' }, itemType: 0 }, // free placeholder, no link
  };
  const v: Record<number, VendorInfo> = {
    1: { name: 'Commander Zavala', locations: [], categories: ['Gear', 'Commander Zavala', 'Pages'], hiddenCategories: [1], failures: [] },
    2: { name: 'Weapons', locations: [], categories: ['Weapons'], failures: [] },
  };
  const r = {
    vendorGroups: { data: { groups: [{ vendorGroupHash: 7, vendorHashes: [1, 2] }] } },
    vendors: { data: { 1: { vendorHash: 1, enabled: true, vendorLocationIndex: 0 }, 2: { vendorHash: 2, enabled: true, vendorLocationIndex: 0 } } },
    categories: { data: {
      1: { categories: [{ displayCategoryIndex: 0, itemIndexes: [1, 3] }, { displayCategoryIndex: 1, itemIndexes: [2] }, { displayCategoryIndex: 2, itemIndexes: [4] }] },
      2: { categories: [{ displayCategoryIndex: 0, itemIndexes: [1] }] },
    } },
    sales: { data: {
      1: { saleItems: {
        1: { vendorItemIndex: 1, itemHash: 2, quantity: 1, augments: 0, costs: [], failureIndexes: [] },
        2: { vendorItemIndex: 2, itemHash: 50, quantity: 1, augments: 0, costs: [], failureIndexes: [] },
        3: { vendorItemIndex: 3, itemHash: 52, quantity: 1, augments: 0, costs: [], failureIndexes: [] },
        4: { vendorItemIndex: 4, itemHash: 51, quantity: 1, augments: 0, costs: [], failureIndexes: [] },
      } },
      2: { saleItems: { 1: { vendorItemIndex: 1, itemHash: 1, quantity: 1, augments: 0, costs: [{ itemHash: 900, quantity: 5 }], failureIndexes: [] } } },
    } },
  } as never;
  const g = vendorScreen({ vendors: r, manifest: { items: its } as never, info: (h) => v[h], group: () => ({ name: 'Tower', order: 0 }), balances: new Map(), links: (h) => (h === 51 ? 2 : undefined) });
  assert.deepEqual(g[0]!.vendors.map((x) => x.name), ['Commander Zavala']);
  assert.deepEqual(g[0]!.vendors[0]!.categories.map((c) => [c.name, c.sales.map((s) => s.name)]), [['Gear', ['Shiny Shader']], ['Weapons', ['Fatebringer']]]);
});
