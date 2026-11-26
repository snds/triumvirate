import { useState } from 'react';
import type { EquippedSubclass, SubclassPartView } from '@triumvirate/core/browser';
import { Sheet } from '../ui/Sheet.tsx';

/**
 * One subclass part up close: its 525×150 key art across the top (the banner art treatment), then
 * the icon, slot, and the full description. Without art, or if the image fails, the header is the
 * icon on an element-tinted panel so the sheet keeps its shape.
 */
export function AbilitySheet({ part, slot, subclass, onClose }: {
  part: SubclassPartView; slot: string; subclass: EquippedSubclass; onClose: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const element = (subclass.element || 'none').toLowerCase();
  const art = part.banner && !broken;
  return (
    <Sheet title={part.name} onClose={onClose} className={`ability-sheet glance--${element}`}>
      <figure className={`ability-sheet__art${art ? ' has-art' : ''}`}>
        {art
          ? <img src={part.banner} alt="" onError={() => setBroken(true)} />
          : part.icon && <img className="ability-sheet__fallback" src={part.icon} alt="" />}
      </figure>
      <div className="ability-sheet__head">
        {part.icon && <img className="ability-sheet__icon" src={part.icon} alt="" />}
        <p className="ability-sheet__eyebrow">{slot} · {subclass.name}</p>
      </div>
      {part.description
        ? <div className="ability-sheet__text">{gameText(part.description).map((para, n) => (
            <p key={n}>{para.label && <strong>{para.label}: </strong>}{para.text}</p>
          ))}</div>
        : <p className="ability-sheet__text muted">Bungie gives no description for this one.</p>}
    </Sheet>
  );
}

/**
 * Bungie's ability text marks in-game glyphs as "[Void]" or "[Grenade]". A glyph followed by its own
 * word ("[Void] Void shield") drops the glyph; a glyph used as a label ("[Super] : Create…") becomes
 * a bold label; any other glyph keeps its word without the brackets.
 */
export function gameText(text: string): { label?: string; text: string }[] {
  return text.split(/\n{2,}/).map((block) => {
    let t = block.trim().replace(/\[([A-Za-z][A-Za-z ]*)\]\s+(?=\1\b)/g, '');
    let label: string | undefined;
    const m = /^\[([A-Za-z][A-Za-z ]*)\]\s*:\s*/.exec(t);
    if (m) { label = m[1]; t = t.slice(m[0].length); }
    t = t.replace(/\[([A-Za-z][A-Za-z ]*)\]\s*:?\s*/g, (_, w: string, ) => `${w} `).replace(/ {2,}/g, ' ');
    return { label, text: t };
  }).filter((b) => b.text);
}
