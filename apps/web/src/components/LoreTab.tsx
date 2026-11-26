// The item dialog's Lore tab: the entry's subtitle as a pull quote, then the full text at reading
// width. Loaded on first open (the lore table is large, so the server fetches one entry at a time).
import { useEffect, useState } from 'react';
import { fetchLore, type Lore } from '../api.ts';
import { Icon } from './Icon.tsx';
import { Reveal, SkText } from './Skeleton.tsx';

export function LoreTab({ loreHash, flavorText }: { loreHash: number; flavorText?: string }) {
  const [lore, setLore] = useState<Lore>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    setLore(undefined); setError(undefined);
    let live = true;
    fetchLore(loreHash)
      .then((l) => live && setLore(l))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'The lore didn\'t load.'));
    return () => { live = false; };
  }, [loreHash]);

  if (error) return <p className="lore__error" role="alert"><Icon name="warning" /> {error}</p>;
  return (
    <Reveal loading={!lore} skeleton={<SkText groups={3} lines={3} />} label="Loading lore">
      {lore && (
        <article className="lore">
          <h3 className="drawer__section lore__name">{lore.name}</h3>
          {/* The subtitle is often the flavor text the header already shows; quote it only when new. */}
          {lore.subtitle && lore.subtitle.trim() !== flavorText?.trim() && <blockquote className="lore__quote">{lore.subtitle}</blockquote>}
          {/* Bungie separates paragraphs with blank lines; single breaks inside one (verse, lists) stay. */}
          {lore.text.split(/\n\s*\n/).map((p, i) => <p key={i} className="lore__para">{p.trim()}</p>)}
        </article>
      )}
    </Reveal>
  );
}
