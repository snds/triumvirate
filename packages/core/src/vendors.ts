// Weapons for sale at vendors, read like inventory rows so the roll appraiser can grade them.
// Bungie returns vendor sale items with the same socket and plug components as owned items,
// keyed by sale index instead of instance id, so we dress them up as a vault and reuse summarizeProfile.
import type { DestinyProfileResponse, DestinyVendorsResponse } from 'bungie-api-ts/destiny2';
import type { ManifestTables } from './manifest.ts';
import { summarizeProfile, VAULT_BUCKET, type ItemRow } from './vault.ts';

export interface VendorRow extends ItemRow {
  vendorHash: number;
  vendorName: string;
  /** The character whose vendor list this came from (offers can differ per class). */
  characterId: string;
}

/** Legendary and exotic weapons on offer, one row per distinct roll (characters often see the same one). */
export function vendorWeapons(
  responses: { characterId: string; vendors: DestinyVendorsResponse }[],
  manifest: ManifestTables,
  vendorName: (hash: number) => string,
  /** Also read rolled armor (stats), for the Vendors screen. Off for the roll appraiser. */
  opts: { armor?: boolean; dedupe?: boolean } = {},
): VendorRow[] {
  const dedupe = opts.dedupe ?? true;
  const out: VendorRow[] = [];
  const seen = new Set<string>();
  for (const { characterId, vendors } of responses) {
    for (const [vh, set] of Object.entries(vendors.sales?.data ?? {})) {
      const vendorHash = Number(vh);
      const comps = vendors.itemComponents?.[vendorHash];
      const items: DestinyProfileResponse['profileInventory'] = { data: { items: [] }, privacy: 1 } as never;
      const ids = new Map<string, string>();
      const fake = { instances: {}, sockets: {}, reusablePlugs: {}, stats: {} } as Record<string, Record<string, unknown>>;
      for (const [idx, sale] of Object.entries(set.saleItems ?? {})) {
        const def = manifest.items[sale.itemHash];
        // Only weapons that roll perks (and, when asked, armor that rolls stats).
        const wanted = def?.itemType === 3 || (opts.armor && def?.itemType === 2);
        if (!wanted || !comps?.sockets?.data?.[Number(idx)]) continue;
        const id = `vendor-${vendorHash}-${idx}`;
        ids.set(id, idx);
        (items.data!.items as unknown[]).push({ itemHash: sale.itemHash, itemInstanceId: id, bucketHash: VAULT_BUCKET, state: 0, transferStatus: 2, quantity: 1 });
        fake.instances![id] = comps.instances?.data?.[Number(idx)];
        fake.sockets![id] = comps.sockets.data[Number(idx)];
        fake.reusablePlugs![id] = comps.reusablePlugs?.data?.[Number(idx)];
        fake.stats![id] = comps.stats?.data?.[Number(idx)];
      }
      if (!ids.size) continue;
      const profile = {
        profileInventory: items,
        itemComponents: Object.fromEntries(Object.entries(fake).map(([k, data]) => [k, { data }])),
      } as unknown as DestinyProfileResponse;
      for (const row of summarizeProfile(profile, manifest)) {
        if (row.tier !== 'Legendary' && row.tier !== 'Exotic') continue;
        const key = `${row.itemHash}:${(row.perks ?? []).map((c) => c.map((p) => p.hash).join(',')).join('|')}:${JSON.stringify(row.stats ?? {})}`;
        if (dedupe && seen.has(key)) continue;
        seen.add(key);
        const name = vendorName(vendorHash);
        const { movable: _m, pullOnly: _p, ...rest } = row;
        out.push({ ...rest, location: name, owner: `vendor:${vendorHash}`, vendorHash, vendorName: name, characterId });
      }
    }
  }
  return out;
}
