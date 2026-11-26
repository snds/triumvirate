// The item dialog's ornament strip: every look this weapon or armor piece can wear, as a row of tiles. Picking one
// previews its studio render in the header (nothing changes in game); an unlocked one can then be
// applied, free, like in game. Locked ones still preview, so you can see what you're missing.
import { useEffect, useState } from 'react';
import type { AppraisedItem, OrnamentOption, WeaponOrnaments } from '@triumvirate/core/browser';
import { applyPerks, fetchOrnaments } from '../api.ts';
import { useInventory } from '../inventory-context.ts';
import { Icon } from './Icon.tsx';

export function OrnamentStrip({ item, preview, onPreview }: {
  item: AppraisedItem;
  /** The ornament shown in the header now, if not the applied one. */
  preview?: OrnamentOption;
  onPreview: (o: OrnamentOption | undefined) => void;
}) {
  const { patch } = useInventory();
  const [data, setData] = useState<WeaponOrnaments>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string }>();
  const id = item.instanceId;

  useEffect(() => {
    setData(undefined); setNotice(undefined); onPreview(undefined);
    if (!id || (item.itemType !== 3 && item.itemType !== 2)) return;
    let live = true;
    fetchOrnaments(id).then((d) => live && setData(d)).catch(() => { /* no strip when it can't load */ });
    return () => { live = false; };
    // A new copy starts over; the preview callback is stable enough to leave out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!data || data.options.length < 2) return null;
  const applied = data.options.find((o) => o.applied);
  const shown = preview ?? applied;
  const unlocked = data.options.filter((o) => o.unlocked).length;

  const apply = async (o: OrnamentOption) => {
    if (!id) return;
    setBusy(true); setNotice(undefined);
    const r = await applyPerks(id, [{ socketIndex: data.socketIndex, plugHash: o.hash }]);
    setBusy(false);
    if (r.error) { setNotice({ ok: false, text: r.error }); return; }
    setData({ ...data, options: data.options.map((x) => ({ ...x, applied: x.hash === o.hash })) });
    setNotice({ ok: true, text: o.isDefault ? 'Back to the default look in game.' : `${o.name} applied in game.` });
    onPreview(undefined);
    if (r.item) patch?.(r.item);
  };

  return (
    <section className="ornaments" aria-label="Ornaments">
      <h3 className="drawer__section ornaments__title">Ornaments <span className="ornaments__count">{unlocked - 1} of {data.options.length - 1} unlocked</span></h3>
      <ul className="ornaments__list" role="listbox" aria-label="Preview an ornament">
        {data.options.map((o) => {
          const selected = o.hash === shown?.hash;
          return (
            <li key={o.hash}>
              <button
                role="option"
                aria-selected={selected}
                className={`ornament${selected ? ' is-selected' : ''}${o.applied ? ' is-applied' : ''}${o.unlocked ? '' : ' is-locked'}`}
                title={`${o.name}${o.applied ? ' (applied)' : o.unlocked ? '' : ' (not unlocked)'}`}
                onClick={() => onPreview(o.applied ? undefined : o)}
              >
                <span className="ornament__art" aria-hidden>
                  {(o.icon ?? item.baseIcon ?? item.icon) && <img src={o.isDefault ? (item.baseIcon ?? item.icon) : o.icon} alt="" decoding="async" draggable={false} />}
                  {!o.unlocked && <span className="ornament__lock"><Icon name="lock" filled /></span>}
                  {o.applied && <span className="ornament__applied"><Icon name="check" /></span>}
                </span>
                <span className="ornament__name">{o.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {preview && !preview.applied && (
        <div className="ornaments__actions">
          <span className="ornaments__previewing">Previewing <strong>{preview.isDefault ? 'the default look' : preview.name}</strong></span>
          {preview.unlocked
            ? <button className="button button--primary" disabled={busy} onClick={() => void apply(preview)}>
              <Icon name="ornament" /> {busy ? 'Applying…' : 'Apply in game'}
            </button>
            : <span className="ornaments__locked"><Icon name="lock" /> Not unlocked yet</span>}
          <button className="button button--quiet" onClick={() => onPreview(undefined)}>Cancel</button>
        </div>
      )}
      {notice && <p className={`ornaments__notice${notice.ok ? '' : ' is-error'}`} role="status">{notice.text}</p>}
    </section>
  );
}
