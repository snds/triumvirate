// Settings: every preference in one place, plus wish list sources, backup and restore, and what
// the server has been doing. Device prefs (item size, roll options) live in localStorage; wish
// lists and saved data live on the server.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  addWishList, disconnectMcp, fetchBackup, fetchMcp, fetchStatus, fetchWishLists, refreshWishLists, removeWishList, restoreBackup, setWishListEnabled,
  type BackupFile, type McpStatus, type ServerStatus, type WishListSourceInfo,
} from '../api.ts';
import { AUTO_REFRESH, TILE_SCALES, allPrefs, restorePrefs, usePref } from '../prefs.ts';
import { timeAgo } from '../inventory.ts';
import { GRADE_ORDER } from '../rolls-view.ts';
import { chime, DEFAULT_ROLL_SETTINGS, type RollSettings } from './RollsView.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { Icon, type IconName } from './Icon.tsx';
import { Segment, Segmented } from '../ui/Segmented.tsx';
import { Switch } from '../ui/Switch.tsx';
import { Select } from '../ui/Select.tsx';
import { Tab as TabButton, TabList, TabPanel, Tabs } from '../ui/Tabs.tsx';

export type Section = 'display' | 'rolls' | 'wishlists' | 'agents' | 'data' | 'status';
const SECTIONS: { id: Section; label: string; icon: IconName }[] = [
  { id: 'display', label: 'Display', icon: 'options' },
  { id: 'rolls', label: 'Rolls', icon: 'rolls' },
  { id: 'wishlists', label: 'Wish lists', icon: 'wishlist' },
  { id: 'agents', label: 'Agents', icon: 'chat' },
  { id: 'data', label: 'Backup', icon: 'save' },
  { id: 'status', label: 'Server', icon: 'server' },
];

export function SettingsSheet({ tileScale, onTileScale, autoRefresh, onAutoRefresh, onOpenDigest, onClose, initialSection }: {
  tileScale: number;
  onTileScale: (v: number) => void;
  autoRefresh: number;
  onAutoRefresh: (minutes: number) => void;
  /** Alerts are set up next to the digest, where you see what they'll say. */
  onOpenDigest: () => void;
  onClose: () => void;
  /** Opens on this section instead of the last one you looked at (e.g. Agents, from the chat). */
  initialSection?: Section;
}) {
  const [section, setSection] = useSettingsSection();
  // Once, on open: after that the section buttons are in charge.
  useEffect(() => { if (initialSection) setSection(initialSection); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Sheet title="Settings" onClose={onClose} wide full className="settings">
      <Tabs value={section} onChange={setSection}>
      <TabList label="Settings sections" className="settings__nav segmented">
        {SECTIONS.map((s) => <TabButton key={s.id} id={s.id} className="segmented__option"><Icon name={s.icon} /> {s.label}</TabButton>)}
      </TabList>
      <TabPanel id={section} className="settings__panel">
      {section === 'display' && (
        <DisplaySection tileScale={tileScale} onTileScale={onTileScale} autoRefresh={autoRefresh} onAutoRefresh={onAutoRefresh} onOpenDigest={onOpenDigest} />
      )}
      {section === 'rolls' && <RollsSection />}
      {section === 'wishlists' && <WishListsSection />}
      {section === 'agents' && <AgentsSection />}
      {section === 'data' && <BackupSection />}
      {section === 'status' && <StatusSection />}
      </TabPanel>
      </Tabs>
    </Sheet>
  );
}

/** The last section you looked at opens next time. */
function useSettingsSection() {
  const [s, set] = usePref<Section>('settingsSection', 'display');
  return [SECTIONS.some((x) => x.id === s) ? s : 'display', set] as const;
}

function Group({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="settings__group">
      <h3 className="settings__title">{title}</h3>
      {children}
      {hint && <p className="settings__hint">{hint}</p>}
    </section>
  );
}

function Choice<T extends number | string>({ label, options, value, onChange }: {
  label: string; options: readonly { label: string; value: T }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <Segmented label={label} value={value} onChange={onChange}>
      {options.map((o) => <Segment key={o.label} id={o.value}>{o.label}</Segment>)}
    </Segmented>
  );
}

let toggleIds = 0;
function Toggle({ checked, onChange, children, hint }: { checked: boolean; onChange: () => void; children: ReactNode; hint?: ReactNode }) {
  const [id] = useState(() => `settings-toggle-${++toggleIds}`);
  return (
    <div className="settings__toggle">
      <span className="settings__toggle-text">
        <span id={id}>{children}</span>
        {hint && <span className="settings__hint">{hint}</span>}
      </span>
      <Switch checked={checked} onChange={onChange} labelledBy={id} />
    </div>
  );
}

function DisplaySection({ tileScale, onTileScale, autoRefresh, onAutoRefresh, onOpenDigest }: {
  tileScale: number; onTileScale: (v: number) => void; autoRefresh: number; onAutoRefresh: (m: number) => void; onOpenDigest: () => void;
}) {
  return (
    <>
      <Group title="Item size" hint="Applies to every tile: inventory, rolls, loadouts, and cleanup.">
        <Choice label="Item size" options={TILE_SCALES} value={tileScale} onChange={onTileScale} />
      </Group>
      <Group title="Auto refresh" hint="Syncs quietly from Bungie, only while this tab is open and visible.">
        <Choice label="Auto refresh" options={AUTO_REFRESH} value={autoRefresh} onChange={onAutoRefresh} />
      </Group>
      <Group title="Alerts" hint="The morning digest and watch list alerts are turned on in the digest, per device.">
        <button className="button" onClick={onOpenDigest}><Icon name="today" /> Open the digest</button>
      </Group>
    </>
  );
}

function RollsSection() {
  const [stored, setStored] = usePref<RollSettings>('rollSettings', DEFAULT_ROLL_SETTINGS);
  const s = { ...DEFAULT_ROLL_SETTINGS, ...stored };
  const set = <K extends keyof RollSettings>(k: K, v: RollSettings[K]) => setStored((p) => ({ ...DEFAULT_ROLL_SETTINGS, ...p, [k]: v }));
  return (
    <>
      <Group title="Activity" hint="New drops and vendor offers below this grade stay out of the activity stream and the sounds.">
        <Select
          className="settings__row" label="Minimum grade" labelClassName="" triggerClassName="select__trigger rolls__select"
          value={s.streamMin} onChange={(v) => set('streamMin', v)} options={GRADE_ORDER.map((g) => ({ value: g, label: g }))}
        />
      </Group>
      <Group title="Characters">
        <Toggle checked={s.followCharacter} onChange={() => set('followCharacter', !s.followCharacter)} hint="A location filter set to your old class moves to the new one. The vault stays as you set it.">
          Follow the character I'm playing
        </Toggle>
      </Group>
      <Group title="Sounds" hint="Browsers may stay quiet until you've clicked the page once.">
        <Toggle checked={s.soundDrops} onChange={() => { set('soundDrops', !s.soundDrops); if (!s.soundDrops) chime(); }}>
          A new drop at {s.streamMin} or better
        </Toggle>
        <Toggle checked={s.soundVendors} onChange={() => { set('soundVendors', !s.soundVendors); if (!s.soundVendors) chime(); }}>
          A vendor selling one
        </Toggle>
      </Group>
    </>
  );
}

const fmtCount = (n: number) => n.toLocaleString('en-US');

function WishListsSection() {
  const [sources, setSources] = useState<WishListSourceInfo[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [url, setUrl] = useState('');
  useEffect(() => {
    fetchWishLists().then((r) => setSources(r.sources)).catch((e: Error) => setError(e.message));
  }, []);
  const run = async (what: string, call: () => Promise<{ sources: WishListSourceInfo[]; error?: string }>) => {
    setBusy(what);
    setError(undefined);
    const r = await call();
    setBusy(undefined);
    if (r.error) { setError(r.error); return false; }
    setSources(r.sources);
    return true;
  };
  const total = (sources ?? []).filter((s) => s.enabled).reduce((n, s) => n + s.rolls, 0);
  return (
    <>
      <Group
        title="Sources"
        hint="Rolls from every list that's on are combined. Changes regrade your weapons and vendor offers on the next load."
      >
        {!sources && !error && <p className="settings__hint">Loading wish lists…</p>}
        {sources && (
          <>
            <div className="settings__summary">
              <span><strong>{fmtCount(total)}</strong> rolls from {sources.filter((s) => s.enabled).length} of {sources.length} {sources.length === 1 ? 'list' : 'lists'}</span>
              <button className="button" onClick={() => void run('refresh', refreshWishLists)} disabled={!!busy}>
                <Icon name="refresh" className={busy === 'refresh' ? 'is-spinning' : ''} /> Download again
              </button>
            </div>
            <ul className="settings__list">
              {sources.map((s) => (
                <li key={s.id} className="settings__source">
                  <div className="settings__source-text">
                    <span className="settings__source-name">{s.name}</span>
                    <span className="settings__hint">
                      {s.rolls ? `${fmtCount(s.rolls)} rolls` : 'Not downloaded yet'}
                      {s.updatedAt && ` · updated ${timeAgo(s.updatedAt)}`}
                    </span>
                    {s.error && <span className="settings__error"><Icon name="warning" /> {s.error}. Using the last copy.</span>}
                    <a className="settings__url" href={s.url} target="_blank" rel="noreferrer">{s.url}</a>
                  </div>
                  <div className="settings__source-actions">
                    <Switch
                      label={`Use ${s.name}`} checked={s.enabled} disabled={!!busy}
                      onChange={() => void run(s.id, () => setWishListEnabled(s.id, !s.enabled))}
                    />
                    {s.id !== 'voltron' && (
                      <button className="icon-button" aria-label={`Remove ${s.name}`} title="Remove" disabled={!!busy} onClick={() => void run(s.id, () => removeWishList(s.id))}>
                        <Icon name="delete" />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Group>
      <Group title="Add a wish list" hint="Any DIM-format list works, such as the lists in the dim-wish-list-sources repository. Use the raw text file's https link.">
        <form
          className="settings__add"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) void run('add', () => addWishList(url.trim())).then((ok) => { if (ok) setUrl(''); });
          }}
        >
          <input
            className="field__input" type="url" inputMode="url" placeholder="https://…/wishlist.txt" aria-label="Wish list link"
            value={url} onChange={(e) => setUrl(e.target.value)} disabled={busy === 'add'}
          />
          <button className="button button--primary" type="submit" disabled={!url.trim() || !!busy}>
            <Icon name="add" /> {busy === 'add' ? 'Loading…' : 'Add'}
          </button>
        </form>
      </Group>
      {error && <p className="settings__error" role="alert"><Icon name="warning" /> {error}</p>}
    </>
  );
}

function BackupSection() {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string }>();
  const fileInput = useRef<HTMLInputElement>(null);
  const download = async () => {
    setBusy(true);
    setNote(undefined);
    try {
      const file: BackupFile = { ...(await fetchBackup()), prefs: allPrefs() };
      const blob = new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `triumvirate-backup-${file.exportedAt.slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      setNote({ ok: true, text: 'Backup saved to your downloads.' });
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    }
    setBusy(false);
  };
  const restore = async (f: File) => {
    setBusy(true);
    setNote(undefined);
    let file: BackupFile;
    try { file = JSON.parse(await f.text()) as BackupFile; } catch { file = {} as BackupFile; }
    const r = await restoreBackup(file);
    setBusy(false);
    if (r.error) { setNote({ ok: false, text: r.error }); return; }
    const prefs = file.prefs && typeof file.prefs === 'object' ? restorePrefs(file.prefs) : 0;
    const parts = [...(r.restored ?? []), ...(prefs ? ['this device\'s view settings'] : [])];
    setNote({ ok: true, text: parts.length ? `Restored ${listOf(parts)}. Reloading…` : 'Nothing in that file to restore.' });
    // Every open view reads the restored data fresh.
    if (parts.length) setTimeout(() => window.location.reload(), 1500);
  };
  return (
    <>
      <Group title="Back up" hint="Loadouts, your builds list, cleanup decisions, the watch list, wish list sources, and this device's view settings. Never your Bungie sign-in.">
        <button className="button" onClick={() => void download()} disabled={busy}><Icon name="import" /> Download backup</button>
      </Group>
      <Group title="Restore" hint="Replaces what's saved now with what's in the file. Parts the file doesn't have are left alone.">
        <button className="button" onClick={() => fileInput.current?.click()} disabled={busy}><Icon name="upload" /> Restore from a file…</button>
        <input
          ref={fileInput} type="file" accept="application/json,.json" hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void restore(f); }}
        />
      </Group>
      {note && <p className={note.ok ? 'settings__ok' : 'settings__error'} role="status"><Icon name={note.ok ? 'checkCircle' : 'warning'} /> {note.text}</p>}
    </>
  );
}

const listOf = (parts: string[]) => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`);

/** "3 AM" from an hour of the day. */
const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
const when = (iso: string | null | undefined) => (iso ? `${timeAgo(iso)} (${new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })})` : 'never');

/**
 * Two ways to put an agent on your gear: connect Claude with your own Claude sign-in (Triumvirate is
 * an MCP server), or give this server an API key for the built-in chat.
 */
function AgentsSection() {
  const [mcp, setMcp] = useState<McpStatus>();
  const [agent, setAgent] = useState<boolean>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const load = () => {
    setError(undefined);
    fetchMcp().then(setMcp).catch((e: Error) => setError(e.message));
    fetchStatus().then((s) => setAgent(s.agent)).catch(() => {});
  };
  useEffect(load, []);
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the field is selectable */ }
  };
  const disconnect = async (id: string) => {
    try { await disconnectMcp(id); load(); } catch (e) { setError((e as Error).message); }
  };
  return (
    <>
      <Group title="Connect Claude">
        <p className="settings__hint">Claude uses your own Claude account, so this server needs no API key. Claude can read your gear and, when you ask, move, equip, and lock items. It can't dismantle anything.</p>
        <ol className="agents__steps">
          <li>In Claude, open <b>Settings, Connectors</b>, and choose <b>Add custom connector</b>.</li>
          <li>
            Paste this address:
            {mcp ? (
              <span className="agents__url">
                <input className="search" readOnly value={mcp.url} aria-label="Connector address" onFocus={(e) => e.currentTarget.select()} />
                <button className="button" onClick={() => void copy(mcp.url)}><Icon name={copied ? 'check' : 'copy'} /> {copied ? 'Copied' : 'Copy'}</button>
              </span>
            ) : error ? null : <span className="settings__hint"> loading…</span>}
          </li>
          <li>Claude opens a Triumvirate page. Choose <b>Allow</b>.</li>
        </ol>
        {error && <p className="settings__error" role="alert"><Icon name="warning" /> {error}</p>}
        {mcp && (mcp.connections.length ? (
          <ul className="agents__list">
            {mcp.connections.map((c) => (
              <li key={c.id}>
                <span className="agents__name"><Icon name="checkCircle" /> {c.name}</span>
                <span className="settings__hint">Connected {timeAgo(c.connectedAt)}{c.lastUsedAt ? `, last used ${timeAgo(c.lastUsedAt)}` : ''}</span>
                <button className="button button--ghost" onClick={() => void disconnect(c.id)}>Disconnect</button>
              </li>
            ))}
          </ul>
        ) : <p className="settings__hint">Nothing connected yet.</p>)}
        <details className="agents__help">
          <summary>Claude says it can't reach the server</summary>
          <p>Claude connects from its own servers, which can't pass your Cloudflare sign-in. In Cloudflare Zero Trust, add a <b>Bypass</b> application for these paths on this site. Each one checks its own sign-in; the Allow page stays behind Cloudflare.</p>
          <code>/mcp, /oauth/register, /oauth/token, /.well-known/oauth-authorization-server, /.well-known/oauth-protected-resource</code>
        </details>
      </Group>
      <Group title="Built-in chat" hint={<>The chat inside Triumvirate runs on this server and needs its own Anthropic API key: add <code>ANTHROPIC_API_KEY</code> to the server's environment and restart the app.</>}>
        <p className="agents__state">{agent === undefined ? 'Checking…' : agent ? <><Icon name="checkCircle" /> On</> : 'Off: no API key on this server'}</p>
      </Group>
    </>
  );
}

function StatusSection() {
  const [s, setS] = useState<ServerStatus>();
  const [error, setError] = useState<string>();
  const load = () => { setError(undefined); fetchStatus().then(setS).catch((e: Error) => setError(e.message)); };
  useEffect(load, []);
  if (error) return <p className="settings__error" role="alert"><Icon name="warning" /> {error}</p>;
  if (!s) return <p className="settings__hint">Asking the server…</p>;
  const crawlState = s.crawl.running ? 'Running now'
    : s.crawl.lastRun?.error ? `Last run failed: ${s.crawl.lastRun.error}`
    : s.crawl.lastRun ? 'Last run finished' : 'Hasn\'t run yet';
  const rows: [string, ReactNode, boolean?][] = [
    ['Last Bungie sync', when(s.syncedAt)],
    ['Item data (manifest)', s.manifestVersion ?? 'not loaded yet'],
    ['Community crawl', s.crawl.hour === null ? 'Off (COMMUNITY_CRAWL_HOUR isn\'t set)' : `Nightly at ${hourLabel(s.crawl.hour)}`],
    ['Crawl status', crawlState, !!s.crawl.lastRun?.error],
    ...(s.crawl.lastRun ? [['Last crawl', `${when(s.crawl.lastRun.finishedAt)} · ${fmtCount(s.crawl.lastRun.matches)} matches, ${fmtCount(s.crawl.lastRun.samples)} samples`] as [string, ReactNode]] : []),
    ['Community data', s.crawl.rollupBuiltAt ? `${fmtCount(s.crawl.samples)} samples, built ${when(s.crawl.rollupBuiltAt)}` : 'none yet'],
    ['Daily digest', s.digest.hour === null ? 'Off (DIGEST_HOUR isn\'t set)' : `Daily at ${hourLabel(s.digest.hour)}`],
    ['Last digest', s.digest.latest ? when(s.digest.latest.builtAt) : 'none yet'],
    ['Watch list', s.watch.everyMinutes ? `${s.watch.entries} watched, checked every ${s.watch.everyMinutes} min, last ${when(s.watch.checkedAt)}` : 'Checks are off'],
    ['Phone alerts', s.alerts ? 'Available' : 'Off on this server'],
    ['Assistant', s.agent ? 'On' : 'Off (ANTHROPIC_API_KEY isn\'t set)'],
  ];
  return (
    <Group title="Server" hint={<>Times are this device's local time. <button className="link-button" onClick={load}>Check again</button></>}>
      <dl className="settings__status">
        {rows.map(([k, v, bad]) => (
          <div key={k} className={bad ? 'is-bad' : undefined}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
    </Group>
  );
}
