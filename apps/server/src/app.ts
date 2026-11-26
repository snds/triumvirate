// HTTP API for the web app. Single user: the token file on disk is the session,
// so the server only ever listens on 127.0.0.1.
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Hono, type Context } from 'hono';
import { getMembershipDataForCurrentUser } from 'bungie-api-ts/user';
import { equipItem, equipItems, equipLoadout, getDestinyEntityDefinition, getProfile, getVendors, insertSocketPlugFree, pullFromPostmaster, setItemLockState, snapshotLoadout, transferItem, updateLoadoutIdentifiers, type DestinyProfileResponse, type DestinyRecordDefinition, type DestinyVendorDefinition } from 'bungie-api-ts/destiny2';
import Anthropic from '@anthropic-ai/sdk';
import {
  applyEquip, applyLock, applyStep, appraise, cleanLoadout, planEquip, summarizeGameLoadouts, type ActionStep, type EquipPlan, appraiseCommunity, authorizeUrl, planMove, rollOptions, cleanupCandidates, decideCleanup, openPicks, planPull, queuedItems, reconcileCleanup, clearedSince, type CleanupAction, type GradeLookup, createHttpClient, exchangeCode, loadManifest, needsRefresh,
  refreshTokens, buildSubclassIndex, summarizeAccount, summarizeCharacters, summarizeProfile, vendorWeapons, type AppraisedItem, type VendorRow, type BungieConfig,
  type ManifestTables, type Tokens, type WishList, buildDigest, digestFacts, digestNotice, type Digest,
} from '@triumvirate/core';
import type { Push } from './push.ts';
import type { Store, Snapshot } from './store.ts';
import { streamAgent, type AgentContext, type AgentEvent, type ChatTurn } from './agent.ts';
import { stream } from 'hono/streaming';
import { createChatStore, validChatId } from './chats.ts';
import { createCommunity } from './community.ts';
import { createLoadoutStore, validLoadoutId } from './loadouts.ts';
import { createDigestStore, localDate, validDigestDate } from './digests.ts';
import { createCleanupStore } from './cleanup-store.ts';

// Component numbers from Bungie's DestinyComponentType (a const enum, so written as literals).
const COMPONENTS = [
  100, // Profiles
  103, // ProfileCurrencies (glimmer, bright dust, silver)
  102, // ProfileInventories (vault)
  200, // Characters
  202, // CharacterProgressions (trimmed to the seasonal artifact before saving)
  201, // CharacterInventories
  205, // CharacterEquipment
  206, // CharacterLoadouts (in-game loadout slots)
  300, // ItemInstances (power, element, gear tier)
  304, // ItemStats (armor stats)
  305, // ItemSockets (slotted perks)
  309, // ItemPlugObjectives (crafted level, kill trackers)
  310, // ItemReusablePlugs (other perks in each column)
];

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
};

export interface AppDeps {
  /** Returns the parsed community wish list; may download it. */
  wishList: () => Promise<WishList>;
  /** Present when ANTHROPIC_API_KEY is set. */
  anthropic?: Anthropic;
  /** Local hour (0-23) for the nightly community crawl; off when unset. */
  communityCrawlHour?: number;
  /** Local hour (0-23) to build the daily digest; off when unset (it can still be built on demand). */
  digestHour?: number;
  /** Web Push for the morning alert; alerts are off when absent. */
  push?: Push;
}

export function createApp(cfg: BungieConfig, store: Store, deps: AppDeps) {
  const app = new Hono();
  let lastView: AgentContext | undefined;
  let pendingState = '';
  let manifest: ManifestTables | undefined;
  let subclass: ReturnType<typeof buildSubclassIndex> | undefined;
  let subclassFor = '';
  /** The snapshot the app is showing; moves are recorded into it. */
  let current: Snapshot | undefined;
  /** Bumped whenever `current` is replaced or edited, so cached views know they're stale. */
  let snapVersion = 0;
  const setCurrent = (snap: Snapshot) => { if (snap !== current) { current = snap; snapVersion++; } };
  /** The last built view, reused until the snapshot, manifest, or wish list changes. */
  let viewCache: { key: string; list: WishList; view: View; body?: string; etag?: string } | undefined;
  /** Moves run one at a time: Bungie asks for a pause between actions, and each one edits `current`. */
  let moveQueue: Promise<unknown> = Promise.resolve();

  async function validTokens(): Promise<Tokens | undefined> {
    let t = await store.readTokens();
    if (!t || Date.now() > t.refreshExpiresAt) return undefined;
    if (needsRefresh(t)) {
      t = await refreshTokens(cfg, t.refreshToken);
      await store.writeTokens(t);
    }
    return t;
  }

  /**
   * Pulls a fresh profile from Bungie. Who you are (membership, name, avatar) is reused from the
   * last snapshot, so a refresh costs one profile call plus a tiny manifest version check.
   * When Bungie says nothing changed since the last pull, the existing snapshot is kept as is.
   */
  async function sync(t: Tokens): Promise<Snapshot> {
    const http = createHttpClient(cfg.apiKey, t.accessToken);
    const prev = current ?? (await store.latestSnapshot());
    let who: Pick<Snapshot, 'membershipType' | 'membershipId' | 'displayName' | 'profilePicture'>;
    if (prev) {
      who = { membershipType: prev.membershipType, membershipId: prev.membershipId, displayName: prev.displayName, profilePicture: prev.profilePicture };
    } else {
      const { Response: me } = await getMembershipDataForCurrentUser(http);
      // Cross-save accounts name a primary membership; otherwise take the first one.
      const m = me.destinyMemberships.find((x) => x.membershipId === me.primaryMembershipId) ?? me.destinyMemberships[0];
      if (!m) throw new Error('No Destiny 2 account found on this Bungie profile.');
      const pic = me.bungieNetUser?.profilePicturePath;
      who = {
        membershipType: m.membershipType,
        membershipId: m.membershipId,
        displayName: m.bungieGlobalDisplayName || m.displayName,
        profilePicture: pic ? (pic.startsWith('http') ? pic : `https://www.bungie.net${pic}`) : undefined,
      };
    }
    const [{ Response: profile }, man] = await Promise.all([
      getProfile(http, { membershipType: who.membershipType, destinyMembershipId: who.membershipId, components: COMPONENTS }),
      loadManifestCached(http),
    ]);
    manifest = man;
    trimProgressions(profile);
    const now = new Date().toISOString();
    // Bungie stamps each profile response; the same stamps mean the same data.
    if (prev && sameProfile(prev.profile, profile)) {
      prev.syncedAt = now;
      setCurrent(prev);
      return prev;
    }
    const snap: Snapshot = { syncedAt: now, ...who, titles: await characterTitles(http, profile), profile };
    await store.saveSnapshot(snap);
    setCurrent(snap);
    return snap;
  }

  // Titles live in the record table, which is huge, so look up only the equipped ones.
  const titleCache = new Map<number, DestinyRecordDefinition>();
  async function characterTitles(http: ReturnType<typeof createHttpClient>, profile: DestinyProfileResponse) {
    const out: Record<string, string> = {};
    for (const [id, ch] of Object.entries(profile.characters?.data ?? {})) {
      if (!ch.titleRecordHash) continue;
      try {
        let rec = titleCache.get(ch.titleRecordHash);
        if (!rec) {
          rec = (await getDestinyEntityDefinition(http, {
            entityType: 'DestinyRecordDefinition', hashIdentifier: ch.titleRecordHash,
          })).Response as DestinyRecordDefinition;
          titleCache.set(ch.titleRecordHash, rec);
        }
        const title = rec.titleInfo?.titlesByGenderHash?.[ch.genderHash];
        if (title) out[id] = title;
      } catch {
        // A missing title is cosmetic; never fail a sync over it.
      }
    }
    return out;
  }

  // Parsing the item table takes a second or two, so keep it in memory and only
  // reload when Bungie publishes a new manifest version.
  async function loadManifestCached(http: ReturnType<typeof createHttpClient>) {
    const next = await loadManifest(http, join(store.dataDir, 'manifest'), 'en', manifest?.version);
    return next ?? manifest!;
  }

  app.get('/auth/login', (c) => {
    pendingState = randomBytes(16).toString('hex');
    return c.redirect(authorizeUrl(cfg, pendingState));
  });

  app.get('/auth/callback', async (c) => {
    if (!pendingState || c.req.query('state') !== pendingState) {
      return c.text('Sign-in state did not match. Go back and sign in again.', 400);
    }
    pendingState = '';
    await store.writeTokens(await exchangeCode(cfg, c.req.query('code') ?? ''));
    return c.redirect('/');
  });

  // Same-origin copy of a Bungie image. CSS masks (used to tint element icons) only accept
  // cross-origin images that send CORS headers, so serving them from here avoids relying on that.
  const imageCache = new Map<string, { type: string; body: ArrayBuffer }>();
  app.get('/api/bungie-img/*', async (c) => {
    const path = c.req.path.replace(/^\/api\/bungie-img\//, '');
    if (!/^(common|img)\/[\w./-]+\.(png|jpg|jpeg|svg|gif|webp)$/i.test(path) || path.includes('..')) {
      return c.text('Not a Bungie image path', 400);
    }
    // Memory first, then the disk copy, then Bungie. Bungie never changes the file at a given
    // path (new art gets a new path), so a copy is good forever.
    let hit = imageCache.get(path);
    if (!hit) {
      const file = join(store.dataDir, 'img', path);
      const type = IMAGE_TYPES[path.split('.').pop()!.toLowerCase()] ?? 'image/png';
      try {
        const buf = await readFile(file);
        hit = { type, body: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer };
      } catch {
        const res = await fetch(`https://www.bungie.net/${path}`);
        if (!res.ok) return c.text('Image not found', 404);
        hit = { type: res.headers.get('content-type') ?? type, body: await res.arrayBuffer() };
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, Buffer.from(hit.body)).catch(() => {});
      }
      if (imageCache.size > 3000) imageCache.clear(); // caps memory; the disk copy stays
      imageCache.set(path, hit);
    }
    // A year, immutable: the browser keeps it and never asks again.
    return c.body(hit.body, 200, { 'Content-Type': hit.type, 'Cache-Control': 'public, max-age=31536000, immutable' });
  });

  app.post('/api/logout', async (c) => {
    await store.clearTokens();
    return c.json({ ok: true });
  });

  app.get('/api/inventory', async (c) => {
    const t = await validTokens();
    if (!t) return c.json({ signedIn: false }, 401);
    // Page loads read the snapshot in memory; only Refresh (or a cold server) asks Bungie.
    let snap = c.req.query('refresh') ? undefined : current ?? (await store.latestSnapshot());
    // The item table is needed to name items, so a cold server always syncs once.
    if (!snap || !manifest) snap = await sync(t);
    setCurrent(snap);
    const view = await buildView(snap);
    const cache = viewCache!;
    const cleanupState = await cleanupNow(view.items);
    // "synced 3 min ago" is part of the body, so it's in the tag too; so is the cleanup queue.
    const etag = `"${cache.key}|${snap.syncedAt}|${cleanupVersion}"`;
    if (cache.etag !== etag) {
      cache.body = JSON.stringify({
        signedIn: true,
        displayName: snap.displayName,
        profilePicture: snap.profilePicture,
        syncedAt: snap.syncedAt,
        manifestVersion: manifest!.version,
        agentEnabled: !!deps.anthropic,
        ...view,
        // Picks you've already decided on live in the autopilot's queue, not the list.
        cleanup: openPicks(view.cleanup, cleanupState),
        cleanupQueued: queuedItems(view.items, cleanupState).length,
      });
      cache.etag = etag;
    }
    // The browser keeps the last copy and asks "changed?"; unchanged answers are empty 304s.
    c.header('ETag', etag);
    c.header('Cache-Control', 'no-cache');
    if (c.req.header('If-None-Match') === etag) return c.body(null, 304);
    c.header('Content-Type', 'application/json');
    return c.body(cache.body!);
  });

  app.post('/api/agent', async (c) => {
    if (!deps.anthropic) return c.json({ error: 'Add ANTHROPIC_API_KEY to .env to turn on the agent.' }, 400);
    if (!lastView) {
      const t = await validTokens();
      if (!t) return c.json({ signedIn: false }, 401);
      const snap = (await store.latestSnapshot()) ?? (await sync(t));
      if (!manifest) await sync(t);
      await buildView(snap);
    }
    const body = (await c.req.json()) as { messages?: ChatTurn[] };
    const history = (body.messages ?? []).filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content);
    if (history.at(-1)?.role !== 'user') return c.json({ error: 'The last message must be from you.' }, 400);
    const client = deps.anthropic;
    // Newline-delimited JSON events, so the chat can show progress as it happens.
    c.header('Content-Type', 'application/x-ndjson');
    c.header('Cache-Control', 'no-cache');
    return stream(c, async (out) => {
      const send = (e: AgentEvent) => out.write(JSON.stringify(e) + '\n');
      try {
        const text = await streamAgent(client, () => lastView!, history, (e) => void send(e));
        await send({ type: 'done', text });
      } catch (err) {
        console.error(err);
        await send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    });
  });

  // Every roll a weapon can have, for the item dialog's "All rolls" tab. Only needs the manifest.
  app.get('/api/items/:hash/rolls', async (c) => {
    const hash = Number(c.req.param('hash'));
    if (!Number.isInteger(hash) || hash <= 0) return c.json({ error: 'Bad item hash.' }, 400);
    if (!manifest) return c.json({ error: 'Item data is still loading. Try again in a moment.' }, 503);
    const r = rollOptions(manifest, hash);
    if (!r) return c.json({ error: 'No roll data for this item.' }, 404);
    // Same for everyone until the next game update; let the browser keep it.
    c.header('Cache-Control', `private, max-age=86400`);
    return c.json(r);
  });

  // Swaps a weapon's perks to other options it already has (Bungie's free plug insert), then re-syncs.
  app.post('/api/perks', async (c) => {
    const t = await validTokens();
    if (!t) return c.json({ signedIn: false }, 401);
    const body = (await c.req.json().catch(() => ({}))) as { instanceId?: string; plugs?: { socketIndex: number; plugHash: number }[] };
    const { instanceId, plugs } = body;
    if (!instanceId || !Array.isArray(plugs) || plugs.length === 0) return c.json({ error: 'Say which weapon and which perks.' }, 400);
    const run = moveQueue.then(async () => {
      if (!current || !lastView) {
        setCurrent((await store.latestSnapshot()) ?? (await sync(t)));
        if (!manifest) await sync(t);
        await buildView(current!);
      }
      const item = lastView!.items.find((i) => i.instanceId === instanceId);
      if (!item?.perks) return { status: 404 as const, body: { error: 'That weapon isn\'t there anymore. Refresh and try again.' } };
      // Only options this copy already has: never anything it can't roll.
      const allowed = (p: { socketIndex: number; plugHash: number }) =>
        item.perks!.some((col) => col.some((o) => o.socketIndex === p.socketIndex && o.hash === p.plugHash));
      if (!plugs.every(allowed)) return { status: 400 as const, body: { error: 'Those perks aren\'t options on this copy.' } };
      // Bungie wants a character even for vault items; any of yours works.
      const characterId = item.owner !== 'vault' ? item.owner : lastView!.characters[0]?.id;
      if (!characterId) return { status: 400 as const, body: { error: 'No character found to act through.' } };
      const http = createHttpClient(cfg.apiKey, t.accessToken);
      let error: string | undefined;
      for (const p of plugs) {
        try {
          await insertSocketPlugFree(http, {
            plug: { socketIndex: p.socketIndex, socketArrayType: 0, plugItemHash: p.plugHash },
            itemId: instanceId, characterId, membershipType: current!.membershipType,
          } as never);
        } catch (err) {
          error = friendlyMoveError(err);
          break;
        }
        await new Promise((f) => setTimeout(f, 120));
      }
      // Pull the real state back from Bungie, so the app shows what actually stuck.
      const snap = await sync(t);
      const view = await buildView(snap);
      return { status: error ? 409 as const : 200 as const, body: { error, item: view.items.find((i) => i.instanceId === instanceId) } };
    });
    moveQueue = run.catch(() => {});
    const out = await run;
    return c.json(out.body, out.status);
  });

  // Community usage data from public matches (see community.ts). Uses the API key only, no sign-in.
  const community = createCommunity({
    dataDir: store.dataDir,
    http: createHttpClient(cfg.apiKey),
    manifest: async () => manifest ?? (manifest = await loadManifestCached(createHttpClient(cfg.apiKey))),
    seed: async () => {
      const snap = current ?? (await store.latestSnapshot());
      return snap ? { membershipType: snap.membershipType, membershipId: snap.membershipId } : undefined;
    },
  });
  if (deps.communityCrawlHour !== undefined) community.schedule(deps.communityCrawlHour);
  else console.log('[community] Nightly crawl is off (COMMUNITY_CRAWL_HOUR is not set).');
  app.get('/api/community/status', async (c) => c.json(await community.status()));
  app.post('/api/community/crawl', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { maxRequests?: number };
    const maxRequests = Math.min(Math.max(Number(body.maxRequests) || 3000, 1), 20_000);
    community.crawl({ maxRequests }, 'manual').catch((e) => console.error('[community] Crawl (manual) failed:', e));
    return c.json(await community.status(), 202);
  });
  app.post('/api/community/stop', (c) => { community.stop(); return c.json({ ok: true }); });
  // Community grades for every weapon in the last inventory view, keyed by instance id.
  app.get('/api/community/appraisals', async (c) => {
    const r = await community.rollup();
    if (!lastView || !manifest) return c.json({ error: 'Load your inventory first.' }, 409);
    const items: Record<string, ReturnType<typeof appraiseCommunity>> = {};
    for (const i of lastView.items) {
      if (i.itemType !== 3 || !i.perks || !i.instanceId) continue;
      items[i.instanceId] = appraiseCommunity(manifest, r?.weapons[i.itemHash], i.itemHash, i.perks);
    }
    return c.json({ builtAt: r?.builtAt, samples: r?.samples ?? 0, from: r?.from, to: r?.to, items });
  });
  // Weapons your vendors sell right now, graded the same way. Offers change at daily and weekly
  // resets, so one pull is reused for 15 minutes (or until ?refresh).
  const vendorNames = new Map<number, string>();
  let vendorCache: { at: number; key: string; rows: (VendorRow & { appraisal?: AppraisedItem['appraisal'] })[] } | undefined;
  /** Vendor weapons with grades. Needs a loaded inventory. */
  async function vendorOffers(t: Tokens, refresh: boolean) {
    if (!current || !lastView || !manifest) throw new Error('Load your inventory first.');
    const key = `${current.membershipId}.${manifest.version}`;
    if (!vendorCache || vendorCache.key !== key || refresh || Date.now() - vendorCache.at > 15 * 60_000) {
      const http = createHttpClient(cfg.apiKey, t.accessToken);
      const responses = [];
      for (const ch of lastView.characters) {
        const { Response: vendors } = await getVendors(http, {
          membershipType: current.membershipType, destinyMembershipId: current.membershipId, characterId: ch.id,
          // Vendors, VendorSales, ItemInstances, ItemStats, ItemSockets, ItemReusablePlugs.
          components: [400, 402, 300, 304, 305, 310] as never,
        });
        responses.push({ characterId: ch.id, vendors });
      }
      // Vendor names aren't in our item tables; look up each vendor once.
      const hashes = new Set(responses.flatMap((r) => Object.keys(r.vendors.sales?.data ?? {}).map(Number)));
      for (const h of hashes) {
        if (vendorNames.has(h)) continue;
        try {
          const d = (await getDestinyEntityDefinition(http, { entityType: 'DestinyVendorDefinition', hashIdentifier: h })).Response as DestinyVendorDefinition;
          vendorNames.set(h, d.displayProperties.name || 'Vendor');
        } catch { vendorNames.set(h, 'Vendor'); }
      }
      const list = await deps.wishList();
      const rows = vendorWeapons(responses, manifest, (h) => vendorNames.get(h) ?? 'Vendor').map((i) => ({
        ...i, appraisal: i.perks ? appraise(i.itemHash, new Set(i.perks.flat().map((p) => p.name)), list, manifest!) : undefined,
      }));
      vendorCache = { at: Date.now(), key, rows };
    }
    const r = await community.rollup();
    const grades: Record<string, ReturnType<typeof appraiseCommunity>> = {};
    for (const i of vendorCache.rows) if (i.perks && i.instanceId) grades[i.instanceId] = appraiseCommunity(manifest, r?.weapons[i.itemHash], i.itemHash, i.perks);
    return { fetchedAt: new Date(vendorCache.at).toISOString(), items: vendorCache.rows, grades };
  }
  app.get('/api/community/vendors', async (c) => {
    const t = await validTokens();
    if (!t) return c.json({ signedIn: false }, 401);
    if (!current || !lastView || !manifest) return c.json({ error: 'Load your inventory first.' }, 409);
    return c.json(await vendorOffers(t, !!c.req.query('refresh')));
  });
  app.get('/api/community/items/:hash', async (c) => {
    const hash = Number(c.req.param('hash'));
    if (!Number.isInteger(hash) || hash <= 0) return c.json({ error: 'Bad item hash.' }, 400);
    return c.json(await community.weapon(hash));
  });

  // Saved conversations. Local, single user, so no sign-in check beyond the server only listening on 127.0.0.1.
  const chats = createChatStore(store.dataDir);
  app.get('/api/chats', async (c) => c.json(await chats.list()));
  app.get('/api/chats/:id', async (c) => {
    const chat = await chats.get(c.req.param('id'));
    return chat ? c.json(chat) : c.json({ error: 'Chat not found.' }, 404);
  });
  app.put('/api/chats/:id', async (c) => {
    const id = c.req.param('id');
    if (!validChatId(id)) return c.json({ error: 'Bad chat id.' }, 400);
    const body = (await c.req.json().catch(() => ({}))) as { turns?: ChatTurn[] };
    const turns = (body.turns ?? []).filter((t) => (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string');
    if (turns.length === 0) return c.json({ error: 'Nothing to save.' }, 400);
    const { turns: _, ...summary } = await chats.save(id, turns);
    return c.json(summary);
  });
  app.delete('/api/chats/:id', async (c) => {
    await chats.remove(c.req.param('id'));
    return c.json({ ok: true });
  });

  // Moves one item to a character or the vault. The item's real owner comes from the server's own
  // copy, so an item shown in the collapsed vault still leaves the character that actually holds it.
  app.post('/api/move', async (c) => {
    const t = await validTokens();
    if (!t) return c.json({ signedIn: false }, 401);
    const body = (await c.req.json().catch(() => ({}))) as { instanceId?: string; to?: string };
    const { instanceId, to } = body;
    if (!instanceId || !to) return c.json({ error: 'Say which item and where it goes.' }, 400);
    const run = moveQueue.then(async () => {
      if (!current || !lastView) {
        setCurrent((await store.latestSnapshot()) ?? (await sync(t)));
        if (!manifest) await sync(t);
        await buildView(current!);
      }
      const snap = current!;
      snapVersion++; // the steps below edit it in place
      const item = lastView!.items.find((i) => i.instanceId === instanceId);
      if (!item) return { status: 404 as const, body: { error: 'That item isn\'t there anymore. Refresh and try again.' } };
      if (to !== 'vault' && !lastView!.characters.some((ch) => ch.id === to)) return { status: 400 as const, body: { error: 'Unknown destination.' } };
      if (item.equipped) return { status: 400 as const, body: { error: 'Equipped items can\'t be moved.' } };
      const http = createHttpClient(cfg.apiKey, t.accessToken);
      const base = { itemReferenceHash: item.itemHash, stackSize: 1, itemId: instanceId, membershipType: snap.membershipType };
      let error: string | undefined;
      for (const step of planMove(item, to)) {
        try {
          if (step.kind === 'pull') await pullFromPostmaster(http, { ...base, characterId: step.characterId });
          else await transferItem(http, { ...base, characterId: step.characterId, transferToVault: step.kind === 'toVault' });
        } catch (err) {
          error = friendlyMoveError(err);
          break;
        }
        applyStep(snap.profile, instanceId, step, manifest!);
        await new Promise((f) => setTimeout(f, 120));
      }
      await store.saveSnapshot(snap);
      // Rebuild once so the agent and the next page load see where the item really is now.
      const view = await buildView(snap);
      const moved = view.items.find((i) => i.instanceId === instanceId);
      return { status: error ? 409 as const : 200 as const, body: { error, item: moved, account: view.account } };
    });
    moveQueue = run.catch(() => {});
    const out = await run;
    return c.json(out.body, out.status);
  });

  // ── Equip, lock, and loadouts ──────────────────────────────

  /** Loads the snapshot, item tables, and view once, for actions on a cold server. */
  async function ready(t: Tokens) {
    if (!current || !lastView || !manifest) {
      setCurrent((await store.latestSnapshot()) ?? (await sync(t)));
      if (!manifest) await sync(t);
      await buildView(current!);
    }
    return { snap: current!, view: lastView!, http: createHttpClient(cfg.apiKey, t.accessToken) };
  }

  /** Runs `fn` after any action already in flight, so Bungie gets its pause and `current` one writer. */
  function queued<T>(fn: () => Promise<T>): Promise<T> {
    const run = moveQueue.then(fn);
    moveQueue = run.catch(() => {});
    return run;
  }

  const pause = (ms: number) => new Promise((f) => setTimeout(f, ms));
  /** Where each item is and whether it's worn or locked, to report only what an action changed. */
  const placeKey = (i: AppraisedItem) => `${i.owner}|${i.equipped}|${i.locked}|${i.location}`;

  /**
   * Carries out an equip plan step by step, recording each finished step in the snapshot, and stops
   * at the first failure. Returns every item whose place changed, so the app can patch them in.
   */
  async function runPlan(t: Tokens, plan: (view: NonNullable<typeof lastView>, account: View['account']) => EquipPlan) {
    return queued(async () => {
      const { snap, view, http } = await ready(t);
      const before = new Map(view.items.filter((i) => i.instanceId).map((i) => [i.instanceId!, placeKey(i)]));
      const { steps, skipped } = plan(view, viewCache!.view.account);
      snapVersion++; // the steps below edit it in place
      let error: string | undefined;
      const run = async (step: ActionStep) => {
        if (step.kind === 'equip') {
          if (step.instanceIds.length === 1) {
            await equipItem(http, { itemId: step.instanceIds[0]!, characterId: step.characterId, membershipType: snap.membershipType });
            applyEquip(snap.profile, step.characterId, step.instanceIds[0]!);
            return;
          }
          // Several at once: Bungie reports each item's own result.
          const { Response: r } = await equipItems(http, { itemIds: step.instanceIds, characterId: step.characterId, membershipType: snap.membershipType });
          for (const res of r.equipResults) {
            if (res.equipStatus === 1) applyEquip(snap.profile, step.characterId, res.itemInstanceId);
            else error ??= friendlyMoveError(new Error(`Bungie API error ${res.equipStatus}`));
          }
          return;
        }
        const base = { itemReferenceHash: step.itemHash, stackSize: 1, itemId: step.instanceId, membershipType: snap.membershipType };
        if (step.kind === 'pull') await pullFromPostmaster(http, { ...base, characterId: step.characterId });
        else await transferItem(http, { ...base, characterId: step.characterId, transferToVault: step.kind === 'toVault' });
        applyStep(snap.profile, step.instanceId, step, manifest!);
      };
      for (const step of steps) {
        try { await run(step); } catch (err) { error = friendlyMoveError(err); break; }
        if (error) break;
        await pause(120);
      }
      await store.saveSnapshot(snap);
      const next = await buildView(snap);
      const changed = next.items.filter((i) => i.instanceId && before.get(i.instanceId) !== placeKey(i));
      if (!error && steps.length === 0 && skipped.length) error = skipped[0]!.reason;
      return { status: error ? 409 as const : 200 as const, body: { error, skipped, items: changed, account: next.account } };
    });
  }

  // Equips one item on a character, bringing it over first when it's somewhere else.
  app.post('/api/equip', async (c) => {
    const t = await validTokens();
    if (!t) return c.json({ signedIn: false }, 401);
    // One item (`instanceId`) or several at once (`instanceIds`, e.g. an optimizer result).
    const body = (await c.req.json().catch(() => ({}))) as { instanceId?: string; instanceIds?: unknown; characterId?: string };
    const ids = Array.isArray(body.instanceIds)
      ? body.instanceIds.filter((x): x is string => typeof x === 'string' && /^\d{1,20}$/.test(x)).slice(0, 12)
      : body.instanceId ? [body.instanceId] : [];
    const { characterId } = body;
    if (!ids.length || !characterId) return c.json({ error: 'Say which item and which character.' }, 400);
    const out = await runPlan(t, (view, account) => {
      if (!view.characters.some((ch) => ch.id === characterId)) return { steps: [], skipped: [{ instanceId: ids[0]!, reason: 'Unknown character.' }] };
      return planEquip(ids, characterId, view.items, view.characters, account);
    });
    return c.json(out.body, out.status);
  });

  // Locks or unlocks an item in game.
  app.post('/api/lock', async (c) => {
    const t = await validTokens();
    if (!t) return c.json({ signedIn: false }, 401);
    const { instanceId, locked } = (await c.req.json().catch(() => ({}))) as { instanceId?: string; locked?: boolean };
    if (!instanceId || typeof locked !== 'boolean') return c.json({ error: 'Say which item and whether to lock it.' }, 400);
    const out = await queued(async () => {
      const { snap, view, http } = await ready(t);
      const item = view.items.find((i) => i.instanceId === instanceId);
      if (!item) return { status: 404 as const, body: { error: 'That item isn\'t there anymore. Refresh and try again.' } };
      // Bungie wants a character even for vault items; any of yours works.
      const characterId = item.owner !== 'vault' ? item.owner : view.characters[0]?.id;
      if (!characterId) return { status: 400 as const, body: { error: 'No character found to act through.' } };
      try {
        await setItemLockState(http, { state: locked, itemId: instanceId, characterId, membershipType: snap.membershipType });
      } catch (err) {
        return { status: 409 as const, body: { error: friendlyMoveError(err), item } };
      }
      snapVersion++;
      applyLock(snap.profile, instanceId, locked);
      await store.saveSnapshot(snap);
      const next = await buildView(snap);
      return { status: 200 as const, body: { item: next.items.find((i) => i.instanceId === instanceId) } };
    });
    return c.json(out.body, out.status);
  });

  // ── Cleanup autopilot ──────────────────────────────────────
  // The API can't dismantle, so a "dismantle" decision queues the item; Pull brings the queue onto a
  // character, where the game lets you shard it. "Keep" locks it in game so it never comes back.
  const cleanupStore = createCleanupStore(store.dataDir);
  let cleanupVersion = 0;
  /** Saved decisions, reconciled with what's in the inventory now (gone = dismantled). */
  async function cleanupNow(items: AppraisedItem[]) {
    const state = await cleanupStore.get();
    const next = reconcileCleanup(state, items);
    if (next !== state) { await cleanupStore.set(next); cleanupVersion++; }
    return next;
  }
  async function cleanupBody() {
    const view = viewCache!.view;
    const state = await cleanupNow(view.items);
    const r = await community.rollup();
    return {
      picks: openPicks(view.cleanup, state),
      queue: queuedItems(view.items, state),
      kept: Object.values(state.decisions).filter((d) => d.action === 'keep').length,
      cleared: state.cleared.slice(0, 20),
      clearedWeek: clearedSince(state, 7),
      community: r ? { builtAt: r.builtAt, samples: r.samples } : undefined,
    };
  }
  app.get('/api/cleanup', async (c) => {
    const t = await validTokens();
    if (!t) return c.json({ signedIn: false }, 401);
    await ready(t);
    return c.json(await cleanupBody());
  });
  // Dismantle (queue), keep (lock in game), or undo (forget; unlocks what Keep locked).
  app.post('/api/cleanup/decide', async (c) => {
    const t = await validTokens();
    if (!t) return c.json({ signedIn: false }, 401);
    const body = (await c.req.json().catch(() => ({}))) as { instanceIds?: unknown; action?: string };
    const ids = Array.isArray(body.instanceIds)
      ? [...new Set(body.instanceIds.filter((x): x is string => typeof x === 'string' && /^\d{1,20}$/.test(x)))].slice(0, 500)
      : [];
    const action = body.action as CleanupAction | 'undo';
    if (!ids.length || !['dismantle', 'keep', 'undo'].includes(action)) return c.json({ error: 'Say which items and what to do with them.' }, 400);
    const out = await queued(async () => {
      const { snap, view, http } = await ready(t);
      let state = await cleanupNow(view.items);
      const errors: string[] = [];
      let done = ids;
      // Keep and undo-a-keep change the lock in game; only the ones Bungie accepts are recorded.
      const lockFor = (id: string) => action === 'keep' ? true : action === 'undo' && state.decisions[id]?.action === 'keep' ? false : undefined;
      if (ids.some((id) => lockFor(id) !== undefined)) {
        done = [];
        for (const id of ids) {
          const lock = lockFor(id);
          const item = view.items.find((i) => i.instanceId === id);
          if (lock === undefined || !item || item.locked === lock) { done.push(id); continue; }
          const characterId = item.owner !== 'vault' ? item.owner : view.characters[0]?.id;
          try {
            if (!characterId) throw new Error('No character found to act through.');
            await setItemLockState(http, { state: lock, itemId: id, characterId, membershipType: snap.membershipType });
            applyLock(snap.profile, id, lock);
            snapVersion++;
            done.push(id);
          } catch (err) {
            errors.push(`${item.name}: ${friendlyMoveError(err)}`);
            if (/permission|slow down/i.test(errors.at(-1)!)) break; // the rest would fail the same way
          }
          await pause(120);
        }
        await store.saveSnapshot(snap);
        await buildView(snap);
      }
      state = decideCleanup(state, viewCache!.view.items, done, action);
      await cleanupStore.set(state);
      cleanupVersion++;
      return { status: errors.length && !done.length ? 409 as const : 200 as const, body: { error: errors[0], errors, ...(await cleanupBody()), items: viewCache!.view.items.filter((i) => done.includes(i.instanceId ?? '')) } };
    });
    return c.json(out.body, out.status);
  });
  // Brings queued vault items onto a character so they can be dismantled in game.
  app.post('/api/cleanup/pull', async (c) => {
    const t = await validTokens();
    if (!t) return c.json({ signedIn: false }, 401);
    const { characterId } = (await c.req.json().catch(() => ({}))) as { characterId?: string };
    if (!characterId) return c.json({ error: 'Say which character.' }, 400);
    const state = await cleanupStore.get();
    const out = await runPlan(t, (view) => {
      if (!view.characters.some((ch) => ch.id === characterId)) return { steps: [], skipped: [{ instanceId: '', reason: 'Unknown character.' }] };
      return planPull(queuedItems(view.items, state).map((i) => i.instanceId!), characterId, view.items, view.characters);
    });
    return c.json({ ...out.body, ...(await cleanupBody()) }, out.status);
  });

  // Triumvirate's own loadouts.
  const loadouts = createLoadoutStore(store.dataDir);
  app.get('/api/loadouts', async (c) => c.json(await loadouts.list()));
  app.post('/api/loadouts', async (c) => {
    const data = cleanLoadout(await c.req.json().catch(() => undefined));
    if (!data) return c.json({ error: 'A loadout needs a name, a class, and at least one item.' }, 400);
    return c.json(await loadouts.create(data), 201);
  });
  app.put('/api/loadouts/:id', async (c) => {
    const id = c.req.param('id');
    if (!validLoadoutId(id)) return c.json({ error: 'Bad loadout id.' }, 400);
    const data = cleanLoadout(await c.req.json().catch(() => undefined));
    if (!data) return c.json({ error: 'A loadout needs a name, a class, and at least one item.' }, 400);
    // PUT replaces: anything left out (notes, subclass, artifact) is cleared.
    const saved = await loadouts.update(id, { notes: undefined, subclass: undefined, artifact: undefined, ...data });
    return saved ? c.json(saved) : c.json({ error: 'Loadout not found.' }, 404);
  });
  app.delete('/api/loadouts/:id', async (c) => {
    const id = c.req.param('id');
    if (!validLoadoutId(id)) return c.json({ error: 'Bad loadout id.' }, 400);
    await loadouts.remove(id);
    return c.json({ ok: true });
  });
  // Puts a saved loadout on a character: moves what's elsewhere, then equips it all at once.
  app.post('/api/loadouts/:id/apply', async (c) => {
    const t = await validTokens();
    if (!t) return c.json({ signedIn: false }, 401);
    const loadout = await loadouts.get(c.req.param('id'));
    if (!loadout) return c.json({ error: 'Loadout not found.' }, 404);
    const { characterId } = (await c.req.json().catch(() => ({}))) as { characterId?: string };
    if (!characterId) return c.json({ error: 'Say which character.' }, 400);
    const out = await runPlan(t, (view, account) => {
      const ch = view.characters.find((x) => x.id === characterId);
      if (!ch) return { steps: [], skipped: [{ instanceId: '', reason: 'Unknown character.' }] };
      if (loadout.classType !== 3 && loadout.classType !== ch.classType) return { steps: [], skipped: [{ instanceId: '', reason: `This loadout is for another class, not a ${ch.className}.` }] };
      return planEquip(loadout.items.map((i) => i.instanceId), characterId, view.items, view.characters, account);
    });
    return c.json(out.body, out.status);
  });

  // In-game loadout slots. Bungie does the work (it pulls from the vault too), and asks for a
  // second between these calls; afterwards the real state is pulled back, since mods change too.
  async function gameLoadoutAction(c: Context, act: (http: ReturnType<typeof createHttpClient>, body: { characterId: string; index: number; nameHash?: number; colorHash?: number; iconHash?: number }, membershipType: number) => Promise<unknown>) {
    const t = await validTokens();
    if (!t) return c.json({ signedIn: false }, 401);
    const body = (await c.req.json().catch(() => ({}))) as { characterId?: string; index?: number; nameHash?: number; colorHash?: number; iconHash?: number };
    const index = Number(body.index);
    if (!body.characterId || !Number.isInteger(index) || index < 0 || index > 49) return c.json({ error: 'Say which character and which slot.' }, 400);
    const out = await queued(async () => {
      const { snap, view, http } = await ready(t);
      if (!view.characters.some((ch) => ch.id === body.characterId)) return { status: 400 as const, body: { error: 'Unknown character.' } };
      let error: string | undefined;
      try { await act(http, { ...body, characterId: body.characterId!, index }, snap.membershipType); } catch (err) { error = friendlyMoveError(err); }
      await pause(1000);
      // Pull the real state back from Bungie, so the app shows what actually happened.
      await sync(t);
      return { status: error ? 409 as const : 200 as const, body: { error } };
    });
    return c.json(out.body, out.status);
  }
  app.post('/api/game-loadouts/equip', (c) => gameLoadoutAction(c, (http, b, membershipType) =>
    equipLoadout(http, { loadoutIndex: b.index, characterId: b.characterId, membershipType })));
  // Saves what the character is wearing into a slot, with the chosen name, color, and icon.
  app.post('/api/game-loadouts/save', (c) => gameLoadoutAction(c, async (http, b, membershipType) => {
    const ids = { loadoutIndex: b.index, characterId: b.characterId, membershipType, colorHash: b.colorHash, iconHash: b.iconHash, nameHash: b.nameHash };
    await snapshotLoadout(http, ids);
    // Snapshot keeps the old look on some slots; set it explicitly when one was chosen.
    if (b.nameHash || b.colorHash || b.iconHash) { await pause(1000); await updateLoadoutIdentifiers(http, ids); }
  }));
  // Renames or recolors a slot without touching its gear.
  app.post('/api/game-loadouts/identify', (c) => gameLoadoutAction(c, (http, b, membershipType) =>
    updateLoadoutIdentifiers(http, { loadoutIndex: b.index, characterId: b.characterId, membershipType, colorHash: b.colorHash, iconHash: b.iconHash, nameHash: b.nameHash })));

  // Turns a raw snapshot into what the web app and the agent see: items with roll verdicts, plus cleanup picks.
  async function buildView(snap: Snapshot): Promise<View> {
    const list = await deps.wishList();
    // Community grades sharpen cleanup picks; a new nightly rollup means a new view.
    const r = await community.rollup();
    const key = `${snapVersion}.${manifest!.version}.${r?.builtAt ?? ''}`;
    if (viewCache && viewCache.key === key && viewCache.list === list && lastView) return viewCache.view;
    const items: AppraisedItem[] = summarizeProfile(snap.profile, manifest!).map((i) =>
      i.itemType === 3 && i.perks
        ? { ...i, appraisal: appraise(i.itemHash, new Set(i.perks.flat().map((p) => p.name)), list, manifest!) }
        : i,
    );
    const characters = summarizeCharacters(snap.profile, manifest!, snap.titles);
    const account = summarizeAccount(snap.profile, manifest!);
    const grades: GradeLookup = {};
    if (r) for (const i of items) if (i.itemType === 3 && i.perks && i.instanceId) grades[i.instanceId] = appraiseCommunity(manifest!, r.weapons[i.itemHash], i.itemHash, i.perks);
    const cleanup = cleanupCandidates(items, grades);
    const hashById = new Map(items.filter((i) => i.instanceId).map((i) => [i.instanceId!, i.itemHash]));
    const gameLoadouts = summarizeGameLoadouts(snap.profile, manifest!, (id) => hashById.get(id));
    // Only the armor sets this account owns pieces of; the full list is mostly other people's gear.
    const owned = new Set(items.map((i) => i.setHash).filter(Boolean));
    const itemSets = Object.fromEntries(Object.entries(manifest!.itemSets ?? {}).filter(([h]) => owned.has(Number(h))));
    // The subclass index only changes with the manifest, so build it once per version.
    if (subclassFor !== manifest!.version) {
      subclass = buildSubclassIndex(manifest!);
      subclassFor = manifest!.version;
    }
    lastView = { displayName: snap.displayName, characters, items, cleanup, subclass, itemSets };
    const view = { characters, account, items, cleanup, gameLoadouts, loadoutStyles: manifest!.loadoutStyles, itemSets };
    viewCache = { key, list, view };
    return view;
  }

  // ── Daily digest ───────────────────────────────────────────
  const digests = createDigestStore(store.dataDir);
  let digestRun: Promise<Digest> | undefined;
  /** Syncs from Bungie, grades what's new since the last digest, checks vendors, and saves today's. */
  function runDigest(): Promise<Digest> {
    digestRun ??= (async () => {
      const t = await validTokens();
      if (!t) throw new Error('Sign in again to build the digest.');
      const snap = await queued(() => sync(t));
      setCurrent(snap);
      const view = await buildView(snap);
      const date = localDate();
      const r = await community.rollup();
      const grades: Record<string, ReturnType<typeof appraiseCommunity>> = {};
      for (const i of view.items) if (i.itemType === 3 && i.perks && i.instanceId) grades[i.instanceId] = appraiseCommunity(manifest!, r?.weapons[i.itemHash], i.itemHash, i.perks);
      // Vendors are a bonus: a Bungie hiccup there shouldn't cost the whole digest.
      const vendors = await vendorOffers(t, true).catch((e) => { console.error('Digest vendors failed:', e); return undefined; });
      const digest = buildDigest({
        date, items: view.items, prevSeen: (await digests.before(date))?.seen ?? (await digests.get(date))?.seen, grades, vendors,
        cleanup: openPicks(view.cleanup, await cleanupNow(view.items)), vault: view.account.vault,
        crawl: r ? { builtAt: r.builtAt, samples: r.samples } : undefined,
      });
      if (deps.anthropic) {
        try {
          const msg = await deps.anthropic.messages.create({
            model: 'claude-haiku-5-5',
            max_tokens: 400,
            system: 'You write the opening of a Destiny 2 player\'s daily gear digest. Two to four short, plain sentences. Lead with the single most useful thing to do today. Only mention items and numbers from the facts. No greeting, no headings, no lists.',
            messages: [{ role: 'user', content: digestFacts(digest) }],
          });
          const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
          if (text) digest.lede = text;
        } catch (e) { console.error('Digest lede failed:', e); }
      }
      await digests.save(digest);
      return digest;
    })().finally(() => { digestRun = undefined; });
    return digestRun;
  }
  /** What the app needs: the digest without the long list of seen ids. */
  const publicDigest = ({ seen: _seen, ...d }: Digest) => d;
  app.get('/api/digest', async (c) => {
    const date = c.req.query('date');
    if (date && !validDigestDate(date)) return c.json({ error: 'Bad date.' }, 400);
    const d = date ? await digests.get(date) : await digests.latest();
    return c.json({ digest: d ? publicDigest(d) : null, dates: await digests.dates(), building: !!digestRun });
  });
  app.post('/api/digest/run', async (c) => {
    try { return c.json({ digest: publicDigest(await runDigest()), dates: await digests.dates() }); }
    catch (e) { return c.json({ error: e instanceof Error ? e.message : String(e) }, 409); }
  });
  // ── Morning alert (Web Push) ───────────────────────────────
  // Only the scheduled build alerts: when you tap "Build today" you're already looking at it.
  async function notifyDigest(d: Digest) {
    if (!deps.push) return;
    const r = await deps.push.notify({ ...digestNotice(d), tag: 'digest', url: '/?open=digest' });
    if (r.sent || r.removed || r.failed) console.log(`Digest alert: sent ${r.sent}, removed ${r.removed}, failed ${r.failed}.`);
  }
  app.get('/api/push', async (c) => {
    if (!deps.push) return c.json({ enabled: false });
    const endpoint = c.req.query('endpoint');
    return c.json({
      enabled: true,
      publicKey: await deps.push.publicKey(),
      subscribed: endpoint ? await deps.push.has(endpoint) : false,
      devices: await deps.push.count(),
      digestHour: deps.digestHour ?? null,
    });
  });
  app.post('/api/push/subscribe', async (c) => {
    if (!deps.push) return c.json({ error: 'Alerts are off on this server.' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { subscription?: unknown; device?: unknown };
    if (!deps.push.validSubscription(body.subscription)) return c.json({ error: 'That isn\'t a push subscription.' }, 400);
    await deps.push.add(body.subscription, typeof body.device === 'string' ? body.device : undefined);
    return c.json({ ok: true });
  });
  app.post('/api/push/unsubscribe', async (c) => {
    if (!deps.push) return c.json({ ok: true });
    const { endpoint } = (await c.req.json().catch(() => ({}))) as { endpoint?: unknown };
    if (typeof endpoint !== 'string') return c.json({ error: 'Missing endpoint.' }, 400);
    await deps.push.remove(endpoint);
    return c.json({ ok: true });
  });
  /** Sends a sample alert to this device only, built from the latest digest when there is one. */
  app.post('/api/push/test', async (c) => {
    if (!deps.push) return c.json({ error: 'Alerts are off on this server.' }, 404);
    const { endpoint } = (await c.req.json().catch(() => ({}))) as { endpoint?: unknown };
    if (typeof endpoint !== 'string' || !(await deps.push.has(endpoint))) return c.json({ error: 'Turn alerts on for this device first.' }, 400);
    const d = await digests.latest();
    const msg = d ? digestNotice(d) : { title: 'Alerts are on', body: 'You\'ll get one here each morning when the digest is ready.' };
    const r = await deps.push.notify({ ...msg, tag: 'digest', url: '/?open=digest' }, endpoint);
    if (!r.sent) return c.json({ error: r.removed ? 'This device stopped accepting alerts. Turn them off and on again.' : 'The push service didn\'t take it. Try again in a minute.' }, 502);
    return c.json({ ok: true });
  });

  if (deps.digestHour !== undefined) {
    const hour = deps.digestHour;
    const t = setInterval(() => {
      const now = new Date();
      if (now.getHours() !== hour || digestRun) return;
      void digests.get(localDate(now)).then((done) => {
        if (!done) runDigest().then(notifyDigest).catch((e) => console.error('Daily digest failed:', e));
      });
    }, 5 * 60_000);
    t.unref();
  }

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: err.message }, 500);
  });

  return app;
}

/** Turns Bungie's action errors into a sentence that says what to do. */
export function friendlyMoveError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const code = Number(/Bungie API error (\d+)/.exec(msg)?.[1]);
  if (code === 2108) return 'Your Bungie app needs the "Move or equip Destiny gear" permission. Turn it on at bungie.net/en/Application, then sign out and sign back in here.';
  if (code === 1642) return 'There\'s no room there.';
  if (code === 1623) return 'Bungie can\'t find that item where we expected. Refresh and try again.';
  if (code === 1660 || code === 1673) return 'Bungie won\'t let this item move.';
  if (code === 1663) return 'Bungie won\'t allow that right now. Try again from orbit or a social space.';
  if (code === 1634 || code === 1671 || code === 1655) return 'Equipping only works in orbit, in a social space, or while you\'re offline.';
  if (code === 1641) return 'You already have an exotic of that kind equipped.';
  if (code === 1640) return 'That item can\'t be equipped.';
  if (code === 1638 || code === 1639) return 'That character can\'t use this item yet.';
  if (code === 1656) return 'That item is equipped, so it can\'t do that right now.';
  if (code === 31 || code === 36) return 'Bungie asked us to slow down. Wait a moment and try again.';
  return msg;
}

interface View {
  characters: ReturnType<typeof summarizeCharacters>;
  account: ReturnType<typeof summarizeAccount>;
  items: AppraisedItem[];
  cleanup: ReturnType<typeof cleanupCandidates>;
  gameLoadouts: ReturnType<typeof summarizeGameLoadouts>;
  loadoutStyles: ManifestTables['loadoutStyles'];
  itemSets: NonNullable<ManifestTables['itemSets']>;
}

/**
 * Character progressions hold every faction, milestone, and quest, but the app only reads the
 * seasonal artifact, so the rest is dropped before a snapshot is saved (it would triple its size).
 */
export function trimProgressions(profile: DestinyProfileResponse) {
  const data = profile.characterProgressions?.data as Record<string, { seasonalArtifact?: unknown }> | undefined;
  if (!data) return;
  for (const [id, p] of Object.entries(data)) data[id] = { seasonalArtifact: p.seasonalArtifact } as never;
}

/** Bungie stamps when it built each part of a profile; matching stamps mean nothing changed. */
export function sameProfile(a: DestinyProfileResponse, b: DestinyProfileResponse): boolean {
  return !!a.responseMintedTimestamp && a.responseMintedTimestamp === b.responseMintedTimestamp
    && a.secondaryComponentsMintedTimestamp === b.secondaryComponentsMintedTimestamp;
}
