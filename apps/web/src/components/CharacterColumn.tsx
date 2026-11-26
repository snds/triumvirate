import { useMemo, useState } from 'react';
import { ENGRAM_BUCKET, ENGRAM_CAPACITY, POSTMASTER_CAPACITY, type AppraisedItem, type CharacterRow } from '@triumvirate/core/browser';
import { PowerBreakdown, SetBadges } from './CharacterCards.tsx';
import { groupBySlot, rowOf } from '../inventory.ts';
import { ItemTile } from './ItemTile.tsx';
import { Icon } from './Icon.tsx';
import { useDropZone } from '../drag.ts';
import { useInventory } from '../inventory-context.ts';

interface Props {
  character: CharacterRow;
  /** Guardian Rank (account-wide), shown as a small badge beside the class. */
  rank?: { number: number; name: string; icon?: string };
  /** Every item on this character (already filtered by search). */
  items: AppraisedItem[];
  /** Postmaster items, unfiltered, so the count is always the true one. */
  postmaster: AppraisedItem[];
  onSelect: (i: AppraisedItem) => void;
}

export function CharacterColumn({ character, items, postmaster, rank, onSelect }: Props) {
  const { recentMoves, allItems, collectPostmaster, select } = useInventory();
  const mine = useMemo(() => allItems.filter((i) => i.owner === character.id), [allItems, character.id]);
  const worn = useMemo(() => mine.filter((i) => i.equipped), [mine]);
  const engrams = useMemo(() => mine.filter((i) => i.bucketHash === ENGRAM_BUCKET), [mine]);
  const [collecting, setCollecting] = useState(false);
  const collect = async () => {
    setCollecting(true);
    try { await collectPostmaster(character.id); } finally { setCollecting(false); }
  };
  const groups = groupBySlot(items, false, recentMoves);
  // Lost items start being deleted when the postmaster is full; warn a few slots early.
  const drop = useDropZone(character.id);
  const pmLevel = postmaster.length >= POSTMASTER_CAPACITY ? 'full' : postmaster.length >= POSTMASTER_CAPACITY - 3 ? 'warn' : '';
  return (
    <section className={`column${drop.className}`} aria-label={`${character.className} gear`} {...drop.props}>
      {drop.note && <p className="drop-note" role="status">{drop.note}</p>}
      <header className="character" style={{ gridRow: rowOf('header') }}>
        {/* The emblem's wide banner when it has one (its motif is centered, so it crops evenly at any
            column width) with the crest on the left; otherwise the 474-px nameplate as before. */}
        <div
          className={`character__banner${character.emblemBanner ? ' has-wide' : ''}`}
          style={character.emblemBanner || character.emblemBackground ? { backgroundImage: `url(${character.emblemBanner ?? character.emblemBackground})` } : undefined}
        >
          {character.emblemBanner && character.emblemCrest && <img className="character__crest" src={character.emblemCrest} alt="" />}
          <span className="character__name">
            <span className="character__class">
              {character.className}
              {rank && (
                <span className="rank-badge" title={`Guardian Rank ${rank.number}: ${rank.name}`}>
                  {rank.icon && <img src={rank.icon} alt="" />}
                  <span className="visually-hidden">Guardian Rank </span>{rank.number}
                </span>
              )}
            </span>
            {character.title && <span className="character__title">{character.title}</span>}
          </span>
          <PowerBreakdown character={character} />
        </div>
        <div className="character__meta">
          {character.stats && character.stats.length > 0 && (
            <dl className="character__stats">
              {character.stats.map((s) => (
                <div className="character__stat" key={s.name} title={`${s.name} ${s.value}`}>
                  <dt>{s.icon ? <img src={s.icon} alt={s.name} /> : s.name}</dt>
                  <dd>{s.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <SetBadges items={worn} />
        </div>
      </header>
      {groups.map((g) => {
        const equipped = g.items.find((i) => i.equipped);
        const carried = g.items.filter((i) => !i.equipped);
        return (
          <div className="slot" key={g.slot} style={{ gridRow: rowOf(g.slot) }}>
            <div className="slot__equipped">{equipped && <ItemTile item={equipped} size="lg" onSelect={onSelect} />}</div>
            <div className="slot__carried">
              {carried.map((i, n) => <ItemTile key={i.instanceId ?? `${i.itemHash}-${n}`} item={i} onSelect={onSelect} />)}
            </div>
          </div>
        );
      })}
      <div className={`postmaster${pmLevel ? ` postmaster--${pmLevel}` : ''}`} style={{ gridRow: rowOf('postmaster') }}>
        <h3 className="postmaster__title">
          Postmaster <span className="vault__count">{postmaster.length}/{POSTMASTER_CAPACITY}</span>
          {pmLevel === 'full' && <span className="postmaster__note">Full. New drops will be lost.</span>}
          {pmLevel === 'warn' && <span className="postmaster__note">Almost full</span>}
          <span className="postmaster__engrams">Engrams <span className="vault__count">{engrams.length}/{ENGRAM_CAPACITY}</span></span>
        </h3>
        {/* Engram slots: filled ones show the engram, empty ones an outline. A full row sends new drops to the postmaster. */}
        <div className="engrams" role="list" aria-label={`Engrams ${engrams.length} of ${ENGRAM_CAPACITY}`}>
          {Array.from({ length: Math.max(ENGRAM_CAPACITY, engrams.length) }, (_, n) => {
            const e = engrams[n];
            return e ? (
              <button key={e.instanceId ?? n} type="button" role="listitem" className="engram" title={e.name} aria-label={e.name} onClick={() => select(e)}>
                {e.icon && <img src={e.icon} alt="" />}
              </button>
            ) : <span key={`empty-${n}`} role="listitem" className="engram engram--empty" aria-label="Empty engram slot" />;
          })}
        </div>
        {postmaster.length > 0 && (
          <>
            <div className="grid">
              {postmaster.map((i, n) => <ItemTile key={i.instanceId ?? `${i.itemHash}-${n}`} item={i} onSelect={onSelect} />)}
            </div>
            <button type="button" className="button postmaster__collect" onClick={() => void collect()} disabled={collecting}>
              <Icon name={collecting ? 'autorenew' : 'pull'} />
              {collecting ? 'Collecting…' : 'Collect postmaster'}
              <span className="postmaster__badge">{postmaster.length}</span>
            </button>
          </>
        )}
      </div>
    </section>
  );
}

