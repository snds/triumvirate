// Cleanup autopilot. Picks come from the wish list, community popularity, and armor stat
// comparisons; each takes one tap to queue for dismantling or to keep (which locks it in game).
// Bungie's API can't dismantle, so the queue is pulled onto a character and shards in game,
// then leaves the list on its own at the next sync.
import { useCallback, useEffect, useState } from 'react';
import { dimSearch, type AppraisedItem, type CharacterRow, type CleanupCandidate } from '@triumvirate/core/browser';
import { decideCleanup, fetchCleanup, pullCleanup, type CleanupStatus } from '../api.ts';
import { Icon } from './Icon.tsx';
import { ItemTile } from './ItemTile.tsx';

const VERDICT_LABEL = { god: 'God roll', good: 'Good roll', meh: 'No match', trash: 'Trash roll', unrated: 'Unrated' } as const;

export function CleanupView({ characters, characterId, onCharacter, filter, onSelect, onPatch, onChanged, onToast }: {
  characters: CharacterRow[];
  characterId: string;
  onCharacter: (id: string) => void;
  /** The app's search and item-kind filter. */
  filter: (i: AppraisedItem) => boolean;
  onSelect: (i: AppraisedItem) => void;
  /** Items whose lock or place changed. */
  onPatch: (items: AppraisedItem[]) => void;
  /** The pick count in the tabs is out of date. */
  onChanged: () => void;
  onToast: (text: string) => void;
}) {
  const [status, setStatus] = useState<CleanupStatus | null>(null);
  const [error, setError] = useState<string>();
  /** Instance ids with a request in flight, or 'all' / 'pull' for the bulk actions. */
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => fetchCleanup().then((s) => { setStatus(s); setError(undefined); }, (e: Error) => setError(e.message)), []);
  useEffect(() => { void load(); }, [load]);

  const mark = (ids: string[], on: boolean) => setBusy((b) => {
    const next = new Set(b);
    for (const id of ids) on ? next.add(id) : next.delete(id);
    return next;
  });

  const decide = async (ids: string[], action: 'dismantle' | 'keep' | 'undo', key = ids) => {
    mark(key, true);
    const res = await decideCleanup(ids, action);
    mark(key, false);
    if (res.picks && res.queue) setStatus((s) => ({ ...(s ?? res as CleanupStatus), ...res } as CleanupStatus));
    if (res.items?.length) onPatch(res.items);
    if (res.error) onToast(`Couldn't ${action === 'keep' ? 'lock' : 'update'}: ${res.error}`);
    onChanged();
  };

  const pull = async () => {
    mark(['pull'], true);
    const res = await pullCleanup(characterId);
    mark(['pull'], false);
    if (res.picks && res.queue) setStatus((s) => ({ ...(s ?? res as CleanupStatus), ...res } as CleanupStatus));
    if (res.items?.length) onPatch(res.items);
    const skipped = res.skipped ?? [];
    const moved = res.items?.length ?? 0;
    if (res.error) onToast(`Couldn't pull the queue: ${res.error}`);
    else if (skipped.length) onToast(`${moved ? `Pulled ${moved}. ` : ''}${skipped.length} stayed in the vault: ${skipped[0]!.reason}`);
    else onToast(moved ? `Pulled ${moved} ${moved === 1 ? 'item' : 'items'}. Dismantle them in game.` : 'Everything in the queue is already on a character.');
  };

  const copy = async (list: { item: AppraisedItem }[]) => {
    await navigator.clipboard.writeText(dimSearch(list as CleanupCandidate[]));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (error) return <section className="cleanup"><p className="empty">{error}</p></section>;
  if (!status) return <section className="cleanup"><p className="empty">Looking for things to clean up…</p></section>;

  const picks = status.picks.filter((p) => filter(p.item));
  const safe = picks.filter((p) => p.confidence === 'high');
  const check = picks.filter((p) => p.confidence === 'medium');
  const queue = status.queue;
  const inVault = queue.filter((i) => i.owner === 'vault').length;
  const character = characters.find((c) => c.id === characterId) ?? characters[0];
  const safeIds = safe.map((p) => p.item.instanceId!).filter(Boolean);

  return (
    <section className="cleanup">
      <header className="cleanup__header">
        <div>
          <h2 className="vault__title"><Icon name="autopilot" /> Cleanup autopilot</h2>
          <p className="muted">
            {picks.length === 0
              ? 'Nothing new to decide on.'
              : `${safe.length} safe ${safe.length === 1 ? 'pick' : 'picks'} and ${check.length} worth a look, from your wish list${status.community ? ', community popularity,' : ''} and armor stats.`}
            {' '}Locked and equipped items are never picked.
          </p>
        </div>
        {safeIds.length > 0 && (
          <button className="button button--primary" disabled={busy.has('all')} onClick={() => void decide(safeIds, 'dismantle', ['all'])}>
            <Icon name="delete" /> Queue {safeIds.length} safe {safeIds.length === 1 ? 'pick' : 'picks'}
          </button>
        )}
      </header>

      {queue.length > 0 && (
        <section className="cleanup-queue" aria-label="Dismantle queue">
          <div className="cleanup-queue__head">
            <h3>Dismantle queue <span className="muted">{queue.length}</span></h3>
            <p className="muted">
              Bungie doesn't let apps dismantle. {inVault
                ? `Pull brings the ${inVault} in your vault onto your ${character?.className ?? 'character'}, so you can shard them in game.`
                : 'Everything is on a character now. Shard them in game.'} They leave this list once they're gone.
            </p>
          </div>
          <ul className="cleanup-queue__items">
            {queue.map((i) => (
              <li key={i.instanceId} className="cleanup-queue__item">
                <ItemTile item={i} onSelect={onSelect} />
                <button
                  className="cleanup-queue__undo"
                  aria-label={`Take ${i.name} off the queue`}
                  title="Take off the queue"
                  disabled={busy.has(i.instanceId!)}
                  onClick={() => void decide([i.instanceId!], 'undo')}
                ><Icon name="close" /></button>
              </li>
            ))}
          </ul>
          <div className="cleanup-queue__actions">
            {characters.length > 1 && (
              <div className="segmented" role="group" aria-label="Pull to">
                {characters.map((c) => (
                  <button key={c.id} className={`segmented__option${c.id === character?.id ? ' is-selected' : ''}`} aria-pressed={c.id === character?.id} onClick={() => onCharacter(c.id)}>
                    {c.className}
                  </button>
                ))}
              </div>
            )}
            <button className="button button--primary" disabled={!inVault || busy.has('pull')} onClick={() => void pull()}>
              <Icon name={busy.has('pull') ? 'autorenew' : 'pull'} /> {inVault ? `Pull ${inVault} to ${character?.className ?? 'character'}` : 'All pulled'}
            </button>
            <button className="button" onClick={() => void copy(queue.map((item) => ({ item })))}>
              {copied ? 'Copied' : 'Copy DIM search'}
            </button>
          </div>
        </section>
      )}

      {picks.length === 0 && queue.length === 0 && <p className="empty">Nothing to clean up. Nice.</p>}
      <PickGroup title="Safe picks" note="Duplicates you have a better copy of, armor beaten in every stat, and rolls both the wish list and players pass on." picks={safe} busy={busy} onSelect={onSelect} decide={decide} />
      <PickGroup title="Worth a look" note="Judgment calls: check these before they go." picks={check} busy={busy} onSelect={onSelect} decide={decide} />

      {(status.kept > 0 || status.cleared.length > 0) && (
        <footer className="cleanup__footer muted">
          {status.clearedWeek > 0 && <span><Icon name="check" /> {status.clearedWeek} cleared this week</span>}
          {status.kept > 0 && <span><Icon name="lock" filled /> {status.kept} kept and locked, so they won't come back</span>}
        </footer>
      )}
    </section>
  );
}

function PickGroup({ title, note, picks, busy, onSelect, decide }: {
  title: string;
  note: string;
  picks: CleanupCandidate[];
  busy: Set<string>;
  onSelect: (i: AppraisedItem) => void;
  decide: (ids: string[], action: 'dismantle' | 'keep') => Promise<void>;
}) {
  if (picks.length === 0) return null;
  return (
    <section className="cleanup__group">
      <h3 className="cleanup__group-head">{title} <span className="muted">{picks.length}</span></h3>
      <p className="cleanup__group-note muted">{note}</p>
      <ul className="cleanup__list">
        {picks.map((c, n) => {
          const id = c.item.instanceId;
          const v = c.signals?.verdict;
          const g = c.signals?.grade;
          return (
            <li className="cleanup__row" key={id ?? n}>
              <ItemTile item={c.item} onSelect={onSelect} />
              <div className="cleanup__body">
                <strong>{c.item.name}</strong> <span className="muted">· {c.item.type} · {c.item.location}</span>
                <p className="cleanup__reason">{c.reason}</p>
                {(v || g) && (
                  <div className="cleanup__signals">
                    {v && <span className={`pill pill--wish-${v === 'god' || v === 'good' ? v : 'none'}`}>{VERDICT_LABEL[v]}</span>}
                    {g && <span className={`grade grade--xs grade--${g.toLowerCase()}`} title={`Community popularity grade ${g}`} aria-label={`Community grade ${g}`}>{g}</span>}
                  </div>
                )}
              </div>
              {id && (
                <div className="cleanup__actions">
                  <button className="button button--quiet" disabled={busy.has(id)} onClick={() => void decide([id], 'keep')} aria-label={`Keep ${c.item.name} and lock it`}>
                    <Icon name="lock" /> <span className="cleanup__label">Keep</span>
                  </button>
                  <button className="button" disabled={busy.has(id)} onClick={() => void decide([id], 'dismantle')} aria-label={`Queue ${c.item.name} to dismantle`}>
                    <Icon name="delete" /> <span className="cleanup__label">Dismantle</span>
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
