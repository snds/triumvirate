import { useState } from 'react';
import type { EquippedSubclass, SubclassPartView } from '@triumvirate/core/browser';
import { Sheet } from '../ui/Sheet.tsx';
import { gameText } from '../game-text.ts';

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

