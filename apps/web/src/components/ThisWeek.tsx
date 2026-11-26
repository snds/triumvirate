// Today's "This week": the weekly rotation as key-art cards and the event running now.
// Desktop lays the cards two across; a phone shows the lead card full width and the rest in a row
// that scrolls sideways. Selecting a card opens its modifiers with what each one does.
import { useEffect, useState } from 'react';
import type { WeekActivity, WeekEvent } from '@triumvirate/core/browser';
import { fetchWeek } from '../api.ts';
import { gameText } from '../game-text.ts';
import { Sheet } from '../ui/Sheet.tsx';
import { Icon } from './Icon.tsx';
import { Sk } from './Skeleton.tsx';

/** Modifier glyphs a card shows before "+N"; the sheet lists all of them. */
const CARD_MODIFIERS = 6;

export function ThisWeek() {
  const [week, setWeek] = useState<{ activities: WeekActivity[]; event?: WeekEvent }>();
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<WeekActivity>();
  useEffect(() => { fetchWeek().then(setWeek, () => setFailed(true)); }, []);

  if (failed) return <section className="digest__section week"><h4 className="drawer__section"><Icon name="week" /> This week</h4><p className="muted digest__none">Couldn't read this week's rotation from Bungie.</p></section>;
  if (!week) return (
    <section className="digest__section week" aria-busy>
      <h4 className="drawer__section"><Icon name="week" /> This week</h4>
      <div className="week__cards"><span className="week-card week-card--ghost"><Sk kind="block" /></span><span className="week-card week-card--ghost"><Sk kind="block" /></span></div>
    </section>
  );
  if (!week.activities.length && !week.event) return null;
  const [lead, ...rest] = week.activities;

  return (
    <section className="digest__section week">
      <h4 className="drawer__section"><Icon name="week" /> This week</h4>
      {week.event && <EventBanner event={week.event} />}
      {lead && (
        <div className="week__cards">
          <WeekCard a={lead} lead onOpen={setOpen} />
          {rest.length > 0 && <ul className="week__more">{rest.map((a) => <li key={a.hash}><WeekCard a={a} onOpen={setOpen} /></li>)}</ul>}
        </div>
      )}
      {open && <ActivitySheet a={open} onClose={() => setOpen(undefined)} />}
    </section>
  );
}

function WeekCard({ a, lead, onOpen }: { a: WeekActivity; lead?: boolean; onOpen: (a: WeekActivity) => void }) {
  const [broken, setBroken] = useState(false);
  const shown = a.modifiers.slice(0, CARD_MODIFIERS);
  const more = a.modifiers.length - shown.length;
  return (
    <button type="button" className={`week-card${lead ? ' week-card--lead' : ''}${a.image && !broken ? ' has-art' : ''}`} onClick={() => onOpen(a)} aria-haspopup="dialog">
      {a.image && !broken && <img className="week-card__art" src={a.image} alt="" loading="lazy" onError={() => setBroken(true)} />}
      <span className="week-card__body">
        <span className="week-card__eyebrow">{a.milestone}</span>
        <span className="week-card__name">{a.name}</span>
        {a.detail && <span className="week-card__detail">{a.detail}</span>}
        {shown.length > 0 && (
          <span className="week-card__mods" aria-label={`${a.modifiers.length} modifiers`}>
            {shown.map((m) => <img key={m.name} src={m.icon} alt="" title={m.name} />)}
            {more > 0 && <span className="week-card__more">+{more}</span>}
          </span>
        )}
      </span>
    </button>
  );
}

function EventBanner({ event }: { event: WeekEvent }) {
  return (
    <div className="week-event" style={event.color ? { ['--event-color' as string]: event.color } : undefined}>
      {event.background && <img className="week-event__art" src={event.background} alt="" />}
      <div className="week-event__body">
        {event.icon && <img className="week-event__icon" src={event.icon} alt="" />}
        <div>
          <p className="week-event__eyebrow">Event</p>
          <p className="week-event__name">{event.name}</p>
          {event.description && <p className="week-event__text">{event.description}</p>}
        </div>
      </div>
    </div>
  );
}

function ActivitySheet({ a, onClose }: { a: WeekActivity; onClose: () => void }) {
  const ends = a.endDate ? new Date(a.endDate) : undefined;
  return (
    <Sheet title={a.name} onClose={onClose} className="activity-sheet">
      {a.image && <figure className="activity-sheet__art"><img src={a.image} alt="" /></figure>}
      <p className="ability-sheet__eyebrow">
        {a.milestone}{a.detail ? ` · ${a.detail}` : ''}
        {ends && <> · ends {ends.toLocaleDateString(undefined, { weekday: 'short' })} {ends.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</>}
      </p>
      {a.modifiers.length === 0 ? <p className="muted">No modifiers this week.</p> : (
        <ul className="activity-sheet__mods">
          {a.modifiers.map((m) => (
            <li key={m.name} className="activity-mod">
              {m.icon && <img src={m.icon} alt="" />}
              <div>
                <p className="activity-mod__name">{m.name}</p>
                {m.description && gameText(m.description).map((p, n) => <p key={n} className="activity-mod__text">{p.label && <strong>{p.label}: </strong>}{p.text}</p>)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
