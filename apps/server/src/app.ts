// HTTP API for the web app. Single user: the token file on disk is the session,
// so the server only ever listens on 127.0.0.1.
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Hono } from 'hono';
import { getMembershipDataForCurrentUser } from 'bungie-api-ts/user';
import { getDestinyEntityDefinition, getProfile, pullFromPostmaster, transferItem, type DestinyProfileResponse, type DestinyRecordDefinition } from 'bungie-api-ts/destiny2';
import Anthropic from '@anthropic-ai/sdk';
import {
  applyStep, appraise, authorizeUrl, planMove, rollOptions, cleanupCandidates, createHttpClient, exchangeCode, loadManifest, needsRefresh,
  refreshTokens, buildSubclassIndex, summarizeAccount, summarizeCharacters, summarizeProfile, type AppraisedItem, type BungieConfig,
  type ManifestTables, type Tokens, type WishList,
} from '@triumvirate/core';
import type { Store, Snapshot } from './store.ts';
import { streamAgent, type AgentContext, type AgentEvent, type ChatTurn } from './agent.ts';
import { stream } from 'hono/streaming';
import { createChatStore, validChatId } from './chats.ts';

// Component numbers from Bungie's DestinyComponentType (a const enum, so written as literals).
const COMPONENTS = [
  100, // Profiles
  103, // ProfileCurrencies (glimmer, bright dust, silver)
  102, // ProfileInventories (vault)
  200, // Characters
  201, // CharacterInventories
  205, // CharacterEquipment
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
    // "synced 3 min ago" is part of the body, so it's in the tag too.
    const etag = `"${cache.key}|${snap.syncedAt}"`;
    if (cache.etag !== etag) {
      cache.body = JSON.stringify({
        signedIn: true,
        displayName: snap.displayName,
        profilePicture: snap.profilePicture,
        syncedAt: snap.syncedAt,
        manifestVersion: manifest!.version,
        agentEnabled: !!deps.anthropic,
        ...view,
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

  // Turns a raw snapshot into what the web app and the agent see: items with roll verdicts, plus cleanup picks.
  async function buildView(snap: Snapshot): Promise<View> {
    const list = await deps.wishList();
    const key = `${snapVersion}.${manifest!.version}`;
    if (viewCache && viewCache.key === key && viewCache.list === list && lastView) return viewCache.view;
    const items: AppraisedItem[] = summarizeProfile(snap.profile, manifest!).map((i) =>
      i.itemType === 3 && i.perks
        ? { ...i, appraisal: appraise(i.itemHash, new Set(i.perks.flat().map((p) => p.name)), list, manifest!) }
        : i,
    );
    const characters = summarizeCharacters(snap.profile, manifest!, snap.titles);
    const account = summarizeAccount(snap.profile, manifest!);
    const cleanup = cleanupCandidates(items);
    // The subclass index only changes with the manifest, so build it once per version.
    if (subclassFor !== manifest!.version) {
      subclass = buildSubclassIndex(manifest!);
      subclassFor = manifest!.version;
    }
    lastView = { displayName: snap.displayName, characters, items, cleanup, subclass };
    const view = { characters, account, items, cleanup };
    viewCache = { key, list, view };
    return view;
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
  if (code === 31 || code === 36) return 'Bungie asked us to slow down. Wait a moment and try again.';
  return msg;
}

interface View {
  characters: ReturnType<typeof summarizeCharacters>;
  account: ReturnType<typeof summarizeAccount>;
  items: AppraisedItem[];
  cleanup: ReturnType<typeof cleanupCandidates>;
}

/** Bungie stamps when it built each part of a profile; matching stamps mean nothing changed. */
export function sameProfile(a: DestinyProfileResponse, b: DestinyProfileResponse): boolean {
  return !!a.responseMintedTimestamp && a.responseMintedTimestamp === b.responseMintedTimestamp
    && a.secondaryComponentsMintedTimestamp === b.secondaryComponentsMintedTimestamp;
}
