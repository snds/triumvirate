// Subclass building blocks (supers, abilities, aspects, fragments) read from the manifest,
// so the agent can suggest real options and build cards can show their icons.
import type { ManifestTables } from './manifest.ts';

export interface SubclassPart {
  name: string;
  icon?: string;
  description?: string;
}

export const SUBCLASS_SLOTS = ['supers', 'grenades', 'melee', 'class_abilities', 'movement', 'aspects', 'fragments'] as const;
export type SubclassSlot = (typeof SUBCLASS_SLOTS)[number];

/** Options for one class and element, e.g. Warlock Void. */
export type SubclassOptions = Partial<Record<SubclassSlot, SubclassPart[]>>;

export interface SubclassIndex {
  /** Key: "warlock.void". */
  options: Map<string, SubclassOptions>;
  /** Lowercase name → part, for turning names in a build into icons. */
  byName: Map<string, SubclassPart>;
}

const bungieUrl = (path?: string) => (path ? `https://www.bungie.net${path}` : undefined);
// Plug categories look like "warlock.void.aspects" or "shared.void.fragments".
const CATEGORY = /^(titan|hunter|warlock|shared)\.(\w+)\.(supers|grenades|melee|class_abilities|movement|aspects|fragments)$/;
const CLASSES = ['titan', 'hunter', 'warlock'];

export function buildSubclassIndex(manifest: Pick<ManifestTables, 'items' | 'extras'>): SubclassIndex {
  const shared = new Map<string, Map<SubclassSlot, Map<string, SubclassPart>>>(); // element → slot → parts
  const perClass = new Map<string, Map<SubclassSlot, Map<string, SubclassPart>>>(); // "warlock.void" → ...
  const byName = new Map<string, SubclassPart>();
  const add = (bucket: Map<string, Map<SubclassSlot, Map<string, SubclassPart>>>, key: string, slot: SubclassSlot, part: SubclassPart) => {
    const slots = bucket.get(key) ?? new Map();
    const parts = slots.get(slot) ?? new Map();
    // Same name appears under many hashes (old versions, empty sockets); keep the first with an icon.
    if (!parts.has(part.name) || (!parts.get(part.name).icon && part.icon)) parts.set(part.name, part);
    slots.set(slot, parts);
    bucket.set(key, slots);
  };

  for (const [hash, x] of Object.entries(manifest.extras ?? {})) {
    const m = x.plugCategory && CATEGORY.exec(x.plugCategory);
    if (!m) continue;
    const d = manifest.items[hash];
    const name = d?.displayProperties.name;
    if (!name || /^empty|deprecated|unknown/i.test(name)) continue;
    const part: SubclassPart = { name, icon: bungieUrl(d.displayProperties.icon), description: d.displayProperties.description || undefined };
    const [, owner, element, slot] = m as unknown as [string, string, string, SubclassSlot];
    if (owner === 'shared') add(shared, element, slot, part);
    else add(perClass, `${owner}.${element}`, slot, part);
    if (!byName.has(name.toLowerCase()) || !byName.get(name.toLowerCase())!.icon) byName.set(name.toLowerCase(), part);
  }

  // Each class gets its own parts plus the element's shared ones (grenades, fragments).
  const options = new Map<string, SubclassOptions>();
  const elements = new Set([...shared.keys(), ...[...perClass.keys()].map((k) => k.split('.')[1]!)]);
  for (const cls of CLASSES) {
    for (const element of elements) {
      const own = perClass.get(`${cls}.${element}`);
      if (!own) continue;
      const opts: SubclassOptions = {};
      for (const slot of SUBCLASS_SLOTS) {
        const parts = [...(own.get(slot)?.values() ?? []), ...(shared.get(element)?.get(slot)?.values() ?? [])];
        if (parts.length) opts[slot] = parts.sort((a, b) => a.name.localeCompare(b.name));
      }
      options.set(`${cls}.${element}`, opts);
    }
  }
  return { options, byName };
}
