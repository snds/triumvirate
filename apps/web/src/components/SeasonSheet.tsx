// Season tracker: one view of the season pass rank, the artifact, and the ritual ranks, with how
// far each is from its next step and how long the season has left.
import { useEffect, useState } from 'react';
import type { RankRow } from '@triumvirate/core/browser';
import { fetchSeason, type SeasonResponse } from '../api.ts';
import { timeAgo } from '../inventory.ts';
import { Icon } from './Icon.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { Reveal, SkCards } from './Skeleton.tsx';

const num = (n: number) => n.toLocaleString();

/** Bungie art that quietly becomes an empty frame if it doesn't load. */
function Art({ src, className }: { src?: string; className: string }) {
  const [broken, setBroken] = useState(false);
  return src && !broken
    ? <img src={src} alt="" className={className} onError={() => setBroken(true)} />
    : <span className={`${className} season-art--empty`} aria-hidden />;
}
const pct = (p: number, of: number) => (of > 0 ? Math.min(100, Math.round((p / of) * 100)) : 100);

function Meter({ progress, next, label }: { progress: number; next: number; label: string }) {
  const value = pct(progress, next);
  return (
    <div className="meter" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
      <span className="meter__fill" style={{ width: `${value}%` }} />
    </div>
  );
}

const daysText = (d?: number) => (d === undefined ? undefined : d === 0 ? 'Ends today' : `${d} ${d === 1 ? 'day' : 'days'} left`);

export function SeasonSheet({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<SeasonResponse>();
  const [error, setError] = useState('');
  useEffect(() => { fetchSeason().then(setData, (e: Error) => setError(e.message)); }, []);
  const s = data;

  return (
    <Sheet title="Season" onClose={onClose} wide>
      {error && <p className="error">{error}</p>}
      <Reveal loading={!s && !error} skeleton={<SkCards count={4} />} label="Loading season progress">
      {s && (
        <>
          <SeasonHero s={s} />
          <div className="season__cards">
            {!s.pass && <section className="season-card"><p className="muted">Season pass rank shows up after your next sync.</p></section>}
            {s.artifact && (
              <section className="season-card">
                <header className="season-card__head">
                  <Art src={s.artifact.icon} className="season-card__icon" />
                  <div>
                    <p className="season-card__label">Artifact · {s.artifact.name}</p>
                    <p className="season-card__big">+{s.artifact.powerBonus} <span className="season-card__unit">power</span></p>
                  </div>
                </header>
                {s.artifact.powerProgress && <Meter {...s.artifact.powerProgress} label="Artifact power bonus progress" />}
                <p className="season-card__note">
                  {s.artifact.powerProgress ? `${num(s.artifact.powerProgress.progress)} of ${num(s.artifact.powerProgress.next)} XP to +${s.artifact.powerBonus + 1}` : 'Power bonus'}
                </p>
                <p className="season-card__note">
                  {s.artifact.points} perk {s.artifact.points === 1 ? 'point' : 'points'} unlocked
                  {s.artifact.pointsUsed !== undefined ? `, ${s.artifact.pointsUsed} in use` : ''}
                  {s.artifact.pointProgress ? ` · next in ${num(Math.max(0, s.artifact.pointProgress.next - s.artifact.pointProgress.progress))} XP` : ''}
                </p>
              </section>
            )}
          </div>
          {s.ranks.length > 0 && (
            <section>
              <h3 className="season__heading">Ranks</h3>
              <ul className="season__ranks">{s.ranks.map((r) => <RankItem key={r.hash} r={r} />)}</ul>
            </section>
          )}
          {s.ranks.length === 0 && <p className="muted">Ranks show up after your next sync.</p>}
          <p className="muted season__synced">From your last sync, {timeAgo(s.syncedAt)}.</p>
        </>
      )}
      </Reveal>
    </Sheet>
  );
}

/**
 * The season's key art with its mark, name, and time left at the top (the art's soft, transparent
 * top edge leaves room), and the pass rank and XP bar on the scrim at the bottom. Older seasons have
 * no art: the same layout on a plain panel, led by the mark.
 */
function SeasonHero({ s }: { s: SeasonResponse }) {
  const [broken, setBroken] = useState(false);
  const art = s.season?.art && !broken ? s.season.art : undefined;
  if (!s.season && !s.pass) return null;
  return (
    <section className={`season-hero${art ? ' has-art' : ''}`} aria-label="Season and pass">
      {art && <img className="season-hero__art" src={art} alt="" onError={() => setBroken(true)} />}
      {s.season && (
        <div className="season-hero__top">
          <Art src={s.season.icon} className="season-hero__mark" />
          <div>
            <p className="season-hero__label">Season {s.season.number}</p>
            <h3 className="season-hero__name">{s.season.name}</h3>
            {daysText(s.season.daysLeft) && <p className="season-hero__ends"><Icon name="timer" /> {daysText(s.season.daysLeft)}</p>}
          </div>
        </div>
      )}
      {s.pass && (
        <div className="season-hero__pass">
          <div className="season-hero__rank">
            <span className="season-hero__label">{s.pass.name}</span>
            <span className="season-hero__big">Rank {s.pass.rank}</span>
          </div>
          <Meter progress={s.pass.progress} next={s.pass.next} label="Season pass rank progress" />
          <p className="season-hero__note">
            {num(s.pass.progress)} of {num(s.pass.next)} XP to rank {s.pass.rank + 1}
            {daysText(s.pass.daysLeft) && s.pass.daysLeft !== s.season?.daysLeft ? ` · Pass ${daysText(s.pass.daysLeft)!.toLowerCase()}` : ''}
          </p>
        </div>
      )}
    </section>
  );
}

function RankItem({ r }: { r: RankRow }) {
  const maxed = r.next === 0;
  return (
    <li className="season-rank">
      <Art src={r.icon} className="season-rank__icon" />
      <div className="season-rank__body">
        <p className="season-rank__title"><strong>{r.name}</strong> <span className="muted">{r.rank}</span>
          {r.resets > 0 && <span className="pill pill--neutral" title="Resets this season">{r.resets}× reset</span>}
        </p>
        <Meter progress={maxed ? 1 : r.progress} next={maxed ? 1 : r.next} label={`${r.name} progress`} />
        <p className="season-rank__note muted">{maxed ? 'Top rank. Reset it to start again.' : `${num(r.progress)} of ${num(r.next)} to the next rank · step ${r.step} of ${r.steps}`}</p>
      </div>
    </li>
  );
}
