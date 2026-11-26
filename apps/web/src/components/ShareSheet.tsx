// Share a loadout: an image card for anywhere, a DIM link a friend opens with their own gear, and
// a plain-text build for chat. The card is drawn on a canvas from the same art the app shows.
import { useEffect, useState } from 'react';
import { shareClassName, dimLoadoutLink, loadoutShareText, type AppraisedItem, type SavedLoadout } from '@triumvirate/core/browser';
import { Icon } from './Icon.tsx';
import { Sheet } from './Sheet.tsx';

type Shareable = Pick<SavedLoadout, 'name' | 'classType' | 'notes' | 'subclass' | 'artifact'>;

const W = 1200;
const H = 675;

const loadImage = (src?: string) => new Promise<HTMLImageElement | undefined>((done) => {
  if (!src) return done(undefined);
  const img = new Image();
  img.onload = () => done(img);
  img.onerror = () => done(undefined); // a missing icon leaves an empty frame, not a broken card
  img.src = src;
});

/** Reads a design token, so the card follows the app's palette. */
const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';

/** Draws the card: name and class, weapons and armor with their art, subclass parts, notes. */
async function drawCard(l: Shareable, items: AppraisedItem[]): Promise<HTMLCanvasElement> {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const font = getComputedStyle(document.body).fontFamily;
  g.fillStyle = token('--surface-page');
  g.fillRect(0, 0, W, H);
  g.fillStyle = token('--accent');
  g.fillRect(0, 0, W, 6);

  const pad = 56;
  g.fillStyle = token('--text-primary');
  g.font = `700 52px ${font}`;
  g.fillText(l.name, pad, 104, W - pad * 2);
  g.fillStyle = token('--text-secondary');
  g.font = `400 26px ${font}`;
  g.fillText([shareClassName(l.classType), l.subclass?.name].filter(Boolean).join(' · '), pad, 146);

  // Gear: weapons on the first row, armor on the second, each with its rarity frame and name.
  const tier = (t: string) => token(`--tier-${t.toLowerCase() || 'common'}`);
  const rows = [items.filter((i) => i.itemType === 3), items.filter((i) => i.itemType === 2)];
  const size = 96;
  const gap = 24;
  const colW = (W - pad * 2 - gap * 4) / 5;
  let y = 186;
  for (const row of rows) {
    if (!row.length) continue;
    const imgs = await Promise.all(row.map((i) => loadImage(i.icon)));
    row.slice(0, 5).forEach((item, n) => {
      const x = pad + n * (colW + gap);
      g.fillStyle = tier(item.tier);
      g.fillRect(x, y, size, size);
      const img = imgs[n];
      if (img) g.drawImage(img, x + 3, y + 3, size - 6, size - 6);
      g.fillStyle = token('--text-primary');
      g.font = `600 20px ${font}`;
      g.fillText(item.name, x, y + size + 28, colW);
    });
    y += size + 60;
  }

  // Subclass: aspects and fragments as icons, the way the game shows them.
  const parts = [...(l.subclass?.parts.aspects ?? []), ...(l.subclass?.parts.fragments ?? [])];
  if (parts.length) {
    const icons = await Promise.all(parts.map((p) => loadImage(p.icon)));
    const s = 56;
    parts.slice(0, 12).forEach((_, n) => {
      const img = icons[n];
      const x = pad + n * (s + 12);
      g.fillStyle = token('--surface-raised');
      g.fillRect(x, y, s, s);
      if (img) g.drawImage(img, x, y, s, s);
    });
    y += s + 36;
  }

  if (l.notes && y < H - 40) {
    g.fillStyle = token('--text-secondary');
    g.font = `400 22px ${font}`;
    g.fillText(l.notes.replace(/\s+/g, ' ').slice(0, 120), pad, Math.min(y + 8, H - 48), W - pad * 2);
  }
  g.fillStyle = token('--text-muted');
  g.font = `600 18px ${font}`;
  g.textAlign = 'right';
  g.fillText('TRIUMVIRATE', W - pad, H - 28);
  return c;
}

export function ShareSheet({ loadout, items, onClose, onToast }: {
  loadout: Shareable;
  items: AppraisedItem[];
  onClose: () => void;
  onToast: (text: string) => void;
}) {
  const [card, setCard] = useState<{ url: string; blob: Blob }>();
  useEffect(() => {
    let live = true;
    void drawCard(loadout, items).then((c) => c.toBlob((blob) => {
      if (live && blob) setCard({ url: URL.createObjectURL(blob), blob });
    }, 'image/png'));
    return () => { live = false; };
  }, [loadout, items]);
  useEffect(() => () => { if (card) URL.revokeObjectURL(card.url); }, [card]);

  const fileName = `${loadout.name.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'loadout'}.png`;
  const shareImage = async () => {
    if (!card) return;
    const file = new File([card.blob], fileName, { type: 'image/png' });
    // On a phone this opens the share sheet (Messages, Discord...); elsewhere it saves the file.
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: loadout.name }); } catch { /* closed the share sheet */ }
      return;
    }
    const a = document.createElement('a');
    a.href = card.url;
    a.download = fileName;
    a.click();
  };
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); onToast(`${what} copied.`); } catch { onToast(`Couldn't copy the ${what.toLowerCase()}.`); }
  };

  return (
    <Sheet
      title={`Share ${loadout.name}`}
      onClose={onClose}
      wide
      footer={(
        <div className="sheet__actions share__actions">
          <button className="button" onClick={() => void copy(loadoutShareText(loadout, items), 'Build text')}><Icon name="copy" /> Copy text</button>
          <button className="button" onClick={() => void copy(dimLoadoutLink(loadout, items), 'DIM link')}><Icon name="link" /> Copy DIM link</button>
          <button className="button button--primary" disabled={!card} onClick={() => void shareImage()}><Icon name="share" /> Share image</button>
        </div>
      )}
    >
      <div className="share__preview">
        {card ? <img src={card.url} alt={`${loadout.name} loadout card`} /> : <span className="muted">Drawing the card…</span>}
      </div>
      <p className="sheet__body">
        The DIM link opens this loadout in Destiny Item Manager with your friend's own copies of each item. The text is for chat.
      </p>
    </Sheet>
  );
}
