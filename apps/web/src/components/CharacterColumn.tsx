import { POSTMASTER_BUCKET, POSTMASTER_CAPACITY, type AppraisedItem, type CharacterRow } from '@triumvirate/core/browser';
import { groupBySlot } from '../inventory.ts';
import { ItemTile } from './ItemTile.tsx';
import { Icon } from './Icon.tsx';

interface Props {
  character: CharacterRow;
  /** Every item on this character (already filtered by search). */
  items: AppraisedItem[];
  /** Postmaster items, unfiltered, so the count is always the true one. */
  postmaster: AppraisedItem[];
  onSelect: (i: AppraisedItem) => void;
}

export function CharacterColumn({ character, items, postmaster, onSelect }: Props) {
  const groups = groupBySlot(items, false);
  // Lost items start being deleted when the postmaster is full; warn a few slots early.
  const pmLevel = postmaster.length >= POSTMASTER_CAPACITY ? 'full' : postmaster.length >= POSTMASTER_CAPACITY - 3 ? 'warn' : '';
  return (
    <section className="column" aria-label={`${character.className} gear`}>
      <header className="character">
        <div
          className="character__banner"
          style={character.emblemBackground ? { backgroundImage: `url(${character.emblemBackground})` } : undefined}
        >
          <span className="character__name">
            <span className="character__class">{character.className}</span>
            {character.title && <span className="character__title">{character.title}</span>}
          </span>
          <span className="character__light"><Icon name="power" filled />{character.light}</span>
        </div>
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
      </header>
      {groups.map((g) => {
        const equipped = g.items.find((i) => i.equipped);
        const carried = g.items.filter((i) => !i.equipped);
        return (
          <div className="slot" key={g.slot}>
            <div className="slot__equipped">{equipped && <ItemTile item={equipped} size="lg" onSelect={onSelect} />}</div>
            <div className="slot__carried">
              {carried.map((i, n) => <ItemTile key={i.instanceId ?? `${i.itemHash}-${n}`} item={i} onSelect={onSelect} />)}
            </div>
          </div>
        );
      })}
      <div className={`postmaster${pmLevel ? ` postmaster--${pmLevel}` : ''}`}>
        <h3 className="postmaster__title">
          Postmaster <span className="vault__count">{postmaster.length}/{POSTMASTER_CAPACITY}</span>
          {pmLevel === 'full' && <span className="postmaster__note">Full. New drops will be lost.</span>}
          {pmLevel === 'warn' && <span className="postmaster__note">Almost full</span>}
        </h3>
        {postmaster.length > 0 && (
          <div className="grid">
            {postmaster.map((i, n) => <ItemTile key={i.instanceId ?? `${i.itemHash}-${n}`} item={i} onSelect={onSelect} />)}
          </div>
        )}
      </div>
    </section>
  );
}

export const isPostmaster = (i: AppraisedItem) => i.bucketHash === POSTMASTER_BUCKET;
