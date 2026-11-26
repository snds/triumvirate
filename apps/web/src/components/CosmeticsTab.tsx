// Records › Cosmetics: Ghost shells, ships, sparrows, and shaders, owned or missing. Filter by
// kind and ownership (the app's search box matches name and source), then a tile grid that loads
// a page at a time. Selecting a tile shows its studio render: in a panel beside the grid on wide
// screens, in a sheet on phones. Renders are ~200 KB, so only the selected one loads.
import { useEffect, useMemo, useState } from 'react';
import { COSMETIC_KINDS, COSMETIC_LABEL, type Cosmetic, type CosmeticKind } from '@triumvirate/core/browser';
import { fetchCosmetics } from '../api.ts';
import { SIDE_PANEL_QUERY, useMediaQuery } from '../media.ts';
import { usePref } from '../prefs.ts';
import { Segment, Segmented } from '../ui/Segmented.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { Icon } from './Icon.tsx';
import { Sk } from './Skeleton.tsx';

type Own = 'all' | 'missing' | 'owned';
/** Tiles per page; "Show more" adds another page. Keeps the DOM small with ~600 shells. */
const PAGE = 60;
const KIND_NOUN: Record<CosmeticKind, string> = { ghost: 'Ghost shell', ship: 'Ship', sparrow: 'Sparrow', shader: 'Shader' };

export function CosmeticsTab({ query }: { query: string }) {
  const [list, setList] = useState<Cosmetic[]>();
  const [error, setError] = useState<string>();
  const [kind, setKind] = usePref<CosmeticKind>('records.cosmetics.kind', 'ghost');
  const [own, setOwn] = usePref<Own>('records.cosmetics.own', 'all');
  const [limit, setLimit] = useState(PAGE);
  const [picked, setPicked] = useState<Cosmetic>();
  const wide = useMediaQuery(SIDE_PANEL_QUERY);

  useEffect(() => { fetchCosmetics().then((r) => setList(r.items), (e: Error) => setError(e.message)); }, []);
  useEffect(() => { setLimit(PAGE); }, [kind, own, query]);

  const q = query.trim().toLowerCase();
  const ofKind = useMemo(() => (list ?? []).filter((c) => c.kind === kind), [list, kind]);
  const shown = ofKind.filter((c) => (own === 'all' || (own === 'owned') === c.owned) && (!q || `${c.name} ${c.source ?? ''}`.toLowerCase().includes(q)));
  const counts = (k: CosmeticKind) => {
    const all = (list ?? []).filter((c) => c.kind === k);
    return `${all.filter((c) => c.owned).length}/${all.length}`;
  };

  if (error) return <p className="records__error" role="alert"><Icon name="warning" /> {error}</p>;
  return (
    <div className={`cosmetics${wide && picked ? ' has-panel' : ''}`}>
      <div className="cosmetics__main">
        <div className="cosmetics__filters">
          <Segmented label="Kind" value={kind} onChange={(k) => { setKind(k); setPicked(undefined); }}>
            {COSMETIC_KINDS.map((k) => (
              <Segment key={k} id={k}>{COSMETIC_LABEL[k]}{list && <span className="muted"> {counts(k)}</span>}</Segment>
            ))}
          </Segmented>
          <Segmented label="Show" value={own} onChange={setOwn}>
            <Segment id="all">All</Segment>
            <Segment id="missing">Missing</Segment>
            <Segment id="owned">Owned</Segment>
          </Segmented>
        </div>
        {!list ? (
          <ul className="cosmetic-grid" aria-busy>{Array.from({ length: 12 }, (_, n) => <li key={n} className="cosmetic cosmetic--ghost"><Sk kind="block" /></li>)}</ul>
        ) : shown.length === 0 ? (
          <p className="empty">{q ? `No ${COSMETIC_LABEL[kind].toLowerCase()} match.` : own === 'missing' ? `You have every one of these. Nice.` : 'Nothing here yet.'}</p>
        ) : (
          <>
            <ul className="cosmetic-grid">
              {shown.slice(0, limit).map((c) => (
                <li key={c.itemHash}>
                  <button
                    type="button"
                    className={`cosmetic tier-${(c.tier ?? 'common').toLowerCase()}${c.owned ? '' : ' is-missing'}`}
                    aria-pressed={picked?.itemHash === c.itemHash}
                    aria-haspopup={wide ? undefined : 'dialog'}
                    onClick={() => setPicked((p) => (p?.itemHash === c.itemHash && wide ? undefined : c))}
                  >
                    <span className="cosmetic__art">
                      {(c.highRes ?? c.icon) && <img src={c.highRes ?? c.icon} alt="" loading="lazy" decoding="async" />}
                      {c.owned && <span className="cosmetic__owned" title="Collected"><Icon name="check" /></span>}
                    </span>
                    <span className="cosmetic__name">{c.name}</span>
                    <span className="visually-hidden">{c.owned ? 'Collected' : 'Not collected'}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="cosmetics__more muted">
              Showing {Math.min(limit, shown.length)} of {shown.length}
              {limit < shown.length && <button className="button" onClick={() => setLimit((n) => n + PAGE)}>Show more</button>}
            </p>
          </>
        )}
      </div>
      {picked && (wide
        ? <aside className="cosmetic-panel" aria-label={picked.name}>
            <button className="icon-button cosmetic-panel__close" onClick={() => setPicked(undefined)} aria-label="Close" title="Close"><Icon name="close" /></button>
            <CosmeticDetail c={picked} />
          </aside>
        : <Sheet title={picked.name} onClose={() => setPicked(undefined)} className="cosmetic-sheet"><CosmeticDetail c={picked} titled /></Sheet>)}
    </div>
  );
}

/** `titled`: the sheet's header already names it, so the body skips the name. */
function CosmeticDetail({ c, titled }: { c: Cosmetic; titled?: boolean }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [c.itemHash]);
  const render = c.render && !broken;
  return (
    <div className="cosmetic-detail">
      <figure className={`cosmetic-detail__art${render ? ' has-render' : ''}`}>
        {render
          ? <img key={c.itemHash} src={c.render} alt="" onError={() => setBroken(true)} />
          : (c.highRes ?? c.icon) && <img className="cosmetic-detail__tile" src={c.highRes ?? c.icon} alt="" />}
      </figure>
      {!titled && <h3 className="cosmetic-detail__name">{c.name}</h3>}
      <p className="ability-sheet__eyebrow">{c.tier ? `${c.tier} ` : ''}{KIND_NOUN[c.kind]}</p>
      <p className={`cosmetic-detail__state${c.owned ? ' is-owned' : ''}`}>
        <Icon name={c.owned ? 'checkCircle' : 'lock'} /> {c.owned ? 'Collected' : 'Not collected yet'}
      </p>
      {c.source && <p className="cosmetic-detail__source">{c.source}</p>}
    </div>
  );
}
