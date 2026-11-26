// The Records screen: titles (seals), the triumph tree, triumphs nearly done, and the ones you
// track. Search uses the app's search box; "Hide completed" trims every tab.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { filterNodes, filterRecords } from '@triumvirate/core/browser';
import type { CharacterRow, NodeView, RecordView, TitleView } from '@triumvirate/core';
import { fetchRecords, trackRecord, type RecordsResponse } from '../api.ts';
import { timeAgo } from '../inventory.ts';
import { usePref } from '../prefs.ts';
import { Icon } from './Icon.tsx';
import { Reveal, Sk } from './Skeleton.tsx';

type Tab = 'titles' | 'triumphs' | 'nearly' | 'tracked';
const TABS: { id: Tab; label: string }[] = [
  { id: 'titles', label: 'Titles' },
  { id: 'triumphs', label: 'Triumphs' },
  { id: 'nearly', label: 'Nearly done' },
  { id: 'tracked', label: 'Tracked' },
];

const pct = (progress: number, completion: number) => (completion > 0 ? Math.min(100, (progress / completion) * 100) : 0);

export function RecordsView({ characters, characterId, onCharacter, query, onToast }: {
  characters: CharacterRow[];
  characterId: string;
  onCharacter: (id: string) => void;
  /** The app's search box. */
  query: string;
  onToast: (text: string) => void;
}) {
  const [data, setData] = useState<RecordsResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = usePref<Tab>('records.tab', 'titles');
  const [hideComplete, setHideComplete] = usePref('records.hideComplete', false);
  const [mine, setMine] = useState<Set<number>>(new Set());
  const [openTitle, setOpenTitle] = useState<number>();
  const [category, setCategory] = useState<number>();

  const load = useCallback(async (refresh = false) => {
    setBusy(true);
    try {
      const next = await fetchRecords(characterId || undefined, refresh);
      setData(next);
      setMine(new Set(next.pinned ?? []));
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [characterId]);
  useEffect(() => { void load(); }, [load]);

  // Every record once, by hash, so a newly pinned one can show on the Tracked tab right away.
  const byHash = useMemo(() => {
    const m = new Map<number, RecordView>();
    if (!data) return m;
    const walk = (n: NodeView) => { for (const r of n.records ?? []) m.set(r.hash, r); for (const k of n.nodes ?? []) walk(k); };
    [...data.triumphs, ...data.legacy].forEach(walk);
    for (const t of data.titles) for (const r of t.records) if (!m.has(r.hash)) m.set(r.hash, r);
    for (const r of [...data.tracked, ...data.nearly]) if (!m.has(r.hash)) m.set(r.hash, r);
    return m;
  }, [data]);

  const toggleTrack = useCallback(async (r: RecordView) => {
    const on = !mine.has(r.hash);
    setMine((s) => { const n = new Set(s); if (on) n.add(r.hash); else n.delete(r.hash); return n; });
    const res = await trackRecord(r.hash, on);
    if (res.error) {
      onToast(res.error);
      setMine((s) => { const n = new Set(s); if (on) n.delete(r.hash); else n.add(r.hash); return n; });
    }
  }, [mine, onToast]);

  const f = { hideComplete, query };
  const inGame = data?.tracked.filter((r) => r.trackedInGame) ?? [];
  const tracked = [...inGame, ...[...mine].map((h) => byHash.get(h)).filter((r): r is RecordView => !!r && !r.trackedInGame)];
  const character = characters.find((c) => c.id === (data?.characterId ?? characterId));
  const shownFor = data && (!data.characterId || data.characterId === characterId || !characterId);
  const card = (r: RecordView, withPath = false) => (
    <RecordCard key={r.hash} record={r} tracked={mine.has(r.hash)} onTrack={toggleTrack} withPath={withPath} />
  );

  return (
    <section className="records" aria-label="Records">
      <header className="records__header">
        <div>
          <h2 className="records__title">Records</h2>
          <p className="muted records__lede">
            {data
              ? <>Triumph score <strong className="records__score">{data.score.active.toLocaleString()}</strong>{data.score.legacy ? ` · legacy ${data.score.legacy.toLocaleString()}` : ''}. Checked {timeAgo(data.fetchedAt)}{character ? `, as your ${character.className}` : ''}.</>
              : 'Titles, triumphs, and what you\'re closest to finishing.'}
          </p>
        </div>
        {characters.length > 1 && (
          <div className="records__picker" role="tablist" aria-label="Character">
            {characters.map((c) => (
              <button
                key={c.id}
                role="tab"
                aria-selected={c.id === characterId}
                className={`store-switcher__tab${c.id === characterId ? ' is-selected' : ''}`}
                onClick={() => onCharacter(c.id)}
              >
                <span className="store-switcher__emblem" style={c.emblemBackground ? { backgroundImage: `url(${c.emblemBackground})` } : undefined} aria-hidden />
                <span className="store-switcher__text">
                  <span className="store-switcher__name">{c.className}</span>
                  <span className="store-switcher__meta"><Icon name="power" filled />{c.light}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="records__tools">
        <div className="segmented" role="tablist" aria-label="Records section">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`segmented__option${tab === t.id ? ' is-selected' : ''}`}
              onClick={() => { setTab(t.id); setOpenTitle(undefined); }}
            >
              {t.label}
              {t.id === 'tracked' && tracked.length > 0 && <span className="muted"> {tracked.length}</span>}
            </button>
          ))}
        </div>
        <button className={`chip${hideComplete ? ' is-selected' : ''}`} aria-pressed={hideComplete} onClick={() => setHideComplete((v) => !v)}>
          <Icon name="checkCircle" /> Hide completed
        </button>
        <button className={`icon-button${busy ? ' is-busy' : ''}`} onClick={() => void load(true)} disabled={busy} aria-label="Check records again" title="Check records again">
          <Icon name="refresh" />
        </button>
      </div>

      {error && <p className="records__error" role="alert"><Icon name="warning" /> {error}</p>}

      <Reveal loading={!shownFor && !error} skeleton={<RecordsSkeleton />} label="Loading records">
        {data && tab === 'titles' && (
          openTitle !== undefined && data.titles.find((t) => t.hash === openTitle)
            ? <TitleDetail title={data.titles.find((t) => t.hash === openTitle)!} onBack={() => setOpenTitle(undefined)}>
              <RecordList records={filterRecords(data.titles.find((t) => t.hash === openTitle)!.records, f)} card={card} empty="Nothing left here." />
            </TitleDetail>
            : <Titles titles={data.titles} hideComplete={hideComplete} query={query} onOpen={setOpenTitle} />
        )}
        {data && tab === 'triumphs' && (
          <Triumphs
            active={filterNodes(data.triumphs, f)}
            legacy={filterNodes(data.legacy, f)}
            selected={category}
            onSelect={setCategory}
            card={card}
          />
        )}
        {data && tab === 'nearly' && (
          <>
            <p className="muted records__hint">Triumphs at least three-quarters done, closest first.</p>
            <RecordList records={filterRecords(data.nearly, f)} card={(r) => card(r, true)} empty="Nothing is that close right now." />
          </>
        )}
        {data && tab === 'tracked' && (
          <>
            <p className="muted records__hint">Pin a triumph to keep it here. The one you track in game shows too.</p>
            <RecordList records={filterRecords(tracked, f)} card={(r) => card(r, true)} empty="Nothing tracked yet." />
          </>
        )}
      </Reveal>
    </section>
  );
}

function RecordList({ records, card, empty }: { records: RecordView[]; card: (r: RecordView) => React.ReactNode; empty: string }) {
  if (!records.length) return <p className="empty">{empty}</p>;
  return <ul className="record-grid">{records.map((r) => <li key={r.hash}>{card(r)}</li>)}</ul>;
}

function Titles({ titles, hideComplete, query, onOpen }: { titles: TitleView[]; hideComplete: boolean; query: string; onOpen: (hash: number) => void }) {
  const q = query.trim().toLowerCase();
  const shown = titles.filter((t) => !(hideComplete && t.complete) && (!q || `${t.title} ${t.name} ${t.description ?? ''}`.toLowerCase().includes(q)));
  const groups = [
    { label: 'Titles', list: shown.filter((t) => !t.legacy) },
    { label: 'Legacy titles', list: shown.filter((t) => t.legacy) },
  ].filter((g) => g.list.length);
  if (!groups.length) return <p className="empty">No titles match.</p>;
  return (
    <>
      {groups.map((g) => (
        <section key={g.label} className="records__section" aria-label={g.label}>
          <h3 className="records__section-title">{g.label} <span className="muted">{g.list.filter((t) => t.complete).length}/{g.list.length}</span></h3>
          <ul className="title-grid">
            {g.list.map((t) => (
              <li key={t.hash}>
                <button className={`title-card${t.complete ? ' is-complete' : ''}`} onClick={() => onOpen(t.hash)}>
                  {t.icon ? <img className="title-card__icon" src={t.icon} alt="" /> : <span className="title-card__icon" aria-hidden><Icon name="title" /></span>}
                  <span className="title-card__text">
                    <span className="title-card__name">{t.title}</span>
                    {t.name !== t.title && <span className="title-card__seal">{t.name}</span>}
                    <span className="rec-bar" aria-hidden><span style={{ width: `${pct(t.progress, t.completion)}%` }} /></span>
                    <span className="title-card__meta">
                      {t.complete ? <span className="title-card__earned"><Icon name="checkCircle" filled /> Earned</span> : <span>{t.progress}/{t.completion}</span>}
                      {!!t.gilded && <span className={`title-card__gilded${t.gildedNow ? ' is-now' : ''}`} title={t.gildedNow ? 'Gilded this season' : 'Times gilded'}><Icon name="gilded" filled /> {t.gilded}</span>}
                    </span>
                  </span>
                  <Icon name="chevronRight" className="title-card__chevron" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function TitleDetail({ title: t, onBack, children }: { title: TitleView; onBack: () => void; children: React.ReactNode }) {
  return (
    <section className="title-detail" aria-label={t.title}>
      <button className="button title-detail__back" onClick={onBack}><Icon name="back" /> All titles</button>
      <div className="title-detail__head">
        {t.icon && <img className="title-card__icon" src={t.icon} alt="" />}
        <div className="title-detail__text">
          <h3>{t.title}</h3>
          {t.description && <p className="muted">{t.description}</p>}
          <div className="title-detail__progress">
            <span className="rec-bar" aria-hidden><span style={{ width: `${pct(t.progress, t.completion)}%` }} /></span>
            <span className="muted">{t.complete ? 'Earned' : `${t.progress} of ${t.completion}`}{t.gilded ? ` · gilded ${t.gilded}×${t.gildedNow ? ', this season too' : ''}` : ''}</span>
          </div>
        </div>
      </div>
      {children}
    </section>
  );
}

/** A category list beside its contents; on a narrow screen, one or the other. */
function Triumphs({ active, legacy, selected, onSelect, card }: {
  active: NodeView[];
  legacy: NodeView[];
  selected?: number;
  onSelect: (hash: number | undefined) => void;
  card: (r: RecordView) => React.ReactNode;
}) {
  const all = [...active, ...legacy];
  const picked = all.find((n) => n.hash === selected);
  // A wide screen shows the first category until you pick one; a narrow one shows the list first.
  const current = picked ?? all[0];
  if (!all.length) return <p className="empty">No triumphs match.</p>;
  const item = (n: NodeView) => (
    <button key={n.hash} className={`records-cat${n.hash === current?.hash ? ' is-selected' : ''}`} aria-current={n.hash === current?.hash || undefined} onClick={() => onSelect(n.hash)}>
      {n.icon ? <img src={n.icon} alt="" /> : <Icon name="records" />}
      <span className="records-cat__name">{n.name}</span>
      <span className="records-cat__count">{n.progress}/{n.completion}</span>
      <span className="rec-bar records-cat__bar" aria-hidden><span style={{ width: `${pct(n.progress, n.completion)}%` }} /></span>
    </button>
  );
  return (
    <div className={`records-tree${picked ? ' has-selection' : ''}`}>
      <nav className="records-tree__list" aria-label="Triumph categories">
        {active.map(item)}
        {legacy.length > 0 && <span className="records-tree__label">Legacy</span>}
        {legacy.map(item)}
      </nav>
      <div className="records-tree__body">
        {current && (
          <>
            <button className="button records-tree__back" onClick={() => onSelect(undefined)}><Icon name="back" /> Categories</button>
            <NodeBody node={current} depth={0} card={card} />
          </>
        )}
      </div>
    </div>
  );
}

function NodeBody({ node, depth, card }: { node: NodeView; depth: number; card: (r: RecordView) => React.ReactNode }) {
  const H = depth === 0 ? 'h3' : 'h4';
  return (
    <section className={`records-node records-node--d${Math.min(depth, 2)}`} aria-label={node.name}>
      <H className="records-node__title">
        {node.name} <span className="muted">{node.progress}/{node.completion}</span>
      </H>
      {node.records && <ul className="record-grid">{node.records.map((r) => <li key={r.hash}>{card(r)}</li>)}</ul>}
      {node.nodes?.map((n) => <NodeBody key={n.hash} node={n} depth={depth + 1} card={card} />)}
    </section>
  );
}

function RecordCard({ record: r, tracked, onTrack, withPath }: { record: RecordView; tracked: boolean; onTrack: (r: RecordView) => void; withPath?: boolean }) {
  // A single yes/no objective with no words says nothing a check mark doesn't.
  const objectives = r.objectives.filter((o) => o.description || o.completion > 1);
  return (
    <article className={`record${r.complete ? ' is-complete' : ''}${r.obscured ? ' is-secret' : ''}`}>
      {r.icon ? <img className="record__icon" src={r.icon} alt="" /> : <span className="record__icon" aria-hidden><Icon name="records" /></span>}
      <div className="record__body">
        {withPath && r.path?.length ? <span className="record__path">{r.path.join(' › ')}</span> : null}
        <h4 className="record__name">
          {r.complete && <Icon name="checkCircle" filled className="record__done" />}
          {r.name}
        </h4>
        {r.description && <p className="record__desc">{r.description}</p>}
        {objectives.map((o, i) => (
          <div key={i} className={`record__objective${o.complete ? ' is-complete' : ''}`}>
            <span className="record__objective-text">
              <span>{o.description || 'Progress'}</span>
              <span className="record__objective-count">{o.progress.toLocaleString()}/{o.completion.toLocaleString()}</span>
            </span>
            <span className="rec-bar" aria-hidden><span style={{ width: `${pct(o.progress, o.completion)}%` }} /></span>
          </div>
        ))}
        <div className="record__meta">
          {r.steps && <span>Step {Math.min(r.steps.done + 1, r.steps.total)} of {r.steps.total}</span>}
          {r.score ? <span>{r.score} pts</span> : null}
          {r.trackedInGame && <span className="record__ingame"><Icon name="game" /> Tracked in game</span>}
        </div>
      </div>
      {!r.complete && (
        <button
          className={`icon-button record__pin${tracked ? ' is-active' : ''}`}
          aria-pressed={tracked}
          aria-label={tracked ? `Stop tracking ${r.name}` : `Track ${r.name}`}
          title={tracked ? 'Stop tracking' : 'Track'}
          onClick={() => onTrack(r)}
        >
          <Icon name="pin" filled={tracked} />
        </button>
      )}
    </article>
  );
}

function RecordsSkeleton() {
  return (
    <ul className="title-grid">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="title-card">
          <Sk kind="round" style={{ width: 56, height: 56 }} />
          <span className="title-card__text"><Sk kind="title" style={{ width: '60%' }} /><Sk kind="line" style={{ width: '90%' }} /></span>
        </li>
      ))}
    </ul>
  );
}
