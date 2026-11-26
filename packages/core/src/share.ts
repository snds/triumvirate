// Sharing a loadout with friends: a DIM link they can open with their own gear, and a plain-text
// summary for chat. (The image card is drawn in the browser; see the web app's ShareSheet.)
import type { EquippedSubclass, ItemRow } from './vault.ts';
import type { SavedLoadout } from './loadouts.ts';

const CLASS_NAME = ['Titan', 'Hunter', 'Warlock', 'Any class'] as const;
/** 'Titan', 'Hunter', 'Warlock', or 'Any class' (class type 3). */
export const shareClassName = (classType: number) => CLASS_NAME[classType] ?? 'Any class';
const DIM_LOADOUTS = 'https://app.destinyitemmanager.com/loadouts';

type ShareItem = Pick<ItemRow, 'itemHash' | 'instanceId' | 'name' | 'type' | 'itemType' | 'bucket' | 'tier'> & Partial<Pick<ItemRow, 'perks' | 'intrinsic'>>;
type ShareLoadout = Pick<SavedLoadout, 'name' | 'classType' | 'notes' | 'subclass' | 'artifact'>;

/**
 * A DIM loadout link. DIM reads the loadout from the URL and fills each slot from the viewer's own
 * inventory, matching by item hash when the exact copy isn't theirs, so a friend gets the same build.
 */
export function dimLoadoutLink(l: ShareLoadout, items: ShareItem[]): string {
  const gear = items.filter((i) => i.bucket !== 'Subclass');
  const loadout = {
    id: 'triumvirate-share',
    name: l.name,
    classType: l.classType,
    clearSpace: false,
    equipped: gear.map((i) => ({ id: i.instanceId ?? '0', hash: i.itemHash })),
    unequipped: [],
    ...(l.notes ? { notes: l.notes } : {}),
  };
  return `${DIM_LOADOUTS}?loadout=${encodeURIComponent(JSON.stringify(loadout))}`;
}

const subclassLines = (s?: EquippedSubclass): string[] => {
  if (!s) return [];
  const names = (slot: string) => (s.parts[slot] ?? []).map((p) => p.name).filter(Boolean);
  const abilities = ['supers', 'grenades', 'melee', 'class_abilities', 'movement'].flatMap(names);
  return [
    `Subclass: ${s.name}${s.element && !s.name.toLowerCase().includes(s.element.toLowerCase()) ? ` (${s.element})` : ''}`,
    ...(abilities.length ? [`  Abilities: ${abilities.join(', ')}`] : []),
    ...(names('aspects').length ? [`  Aspects: ${names('aspects').join(', ')}`] : []),
    ...(names('fragments').length ? [`  Fragments: ${names('fragments').join(', ')}`] : []),
  ];
};

/** The slotted perks of a weapon, for the text summary. */
const perkLine = (i: ShareItem) => (i.perks ?? []).map((col) => col.find((p) => p.active)?.name).filter(Boolean).join(', ');

/** A plain-text build for Discord or a message: what to wear, the subclass, and the notes. */
export function loadoutShareText(l: ShareLoadout, items: ShareItem[]): string {
  const weapons = items.filter((i) => i.itemType === 3);
  const armor = items.filter((i) => i.itemType === 2);
  const lines = [
    `${l.name} · ${shareClassName(l.classType)}`,
    ...subclassLines(l.subclass),
    ...(weapons.length ? ['Weapons:', ...weapons.map((w) => `  ${w.name} (${w.type})${perkLine(w) ? `: ${perkLine(w)}` : ''}`)] : []),
    ...(armor.length ? ['Armor:', ...armor.map((a) => `  ${a.name}${a.tier === 'Exotic' ? ' (exotic)' : ''}`)] : []),
    ...(l.artifact?.length ? [`Artifact: ${l.artifact.map((p) => p.name).join(', ')}`] : []),
    ...(l.notes ? ['', l.notes] : []),
  ];
  return lines.join('\n');
}
