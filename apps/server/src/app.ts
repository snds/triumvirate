// HTTP API for the web app. Single user: the token file on disk is the session,
// so the server only ever listens on 127.0.0.1.
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { Hono } from 'hono';
import { getMembershipDataForCurrentUser } from 'bungie-api-ts/user';
import { getProfile } from 'bungie-api-ts/destiny2';
import Anthropic from '@anthropic-ai/sdk';
import {
  appraise, authorizeUrl, cleanupCandidates, createHttpClient, exchangeCode, loadManifest, needsRefresh,
  refreshTokens, summarizeCharacters, summarizeProfile, type AppraisedItem, type BungieConfig,
  type ManifestTables, type Tokens, type WishList,
} from '@triumvirate/core';
import type { Store, Snapshot } from './store.ts';
import { askAgent, type AgentContext, type ChatTurn } from './agent.ts';

// Component numbers from Bungie's DestinyComponentType (a const enum, so written as literals).
const COMPONENTS = [
  100, // Profiles
  102, // ProfileInventories (vault)
  200, // Characters
  201, // CharacterInventories
  205, // CharacterEquipment
  300, // ItemInstances (power, element, gear tier)
  304, // ItemStats (armor stats)
  305, // ItemSockets (slotted perks)
  310, // ItemReusablePlugs (other perks in each column)
];

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

  async function validTokens(): Promise<Tokens | undefined> {
    let t = await store.readTokens();
    if (!t || Date.now() > t.refreshExpiresAt) return undefined;
    if (needsRefresh(t)) {
      t = await refreshTokens(cfg, t.refreshToken);
      await store.writeTokens(t);
    }
    return t;
  }

  async function sync(t: Tokens): Promise<Snapshot> {
    const http = createHttpClient(cfg.apiKey, t.accessToken);
    const { Response: me } = await getMembershipDataForCurrentUser(http);
    // Cross-save accounts name a primary membership; otherwise take the first one.
    const m = me.destinyMemberships.find((x) => x.membershipId === me.primaryMembershipId) ?? me.destinyMemberships[0];
    if (!m) throw new Error('No Destiny 2 account found on this Bungie profile.');
    const [{ Response: profile }, man] = await Promise.all([
      getProfile(http, { membershipType: m.membershipType, destinyMembershipId: m.membershipId, components: COMPONENTS }),
      loadManifestCached(http),
    ]);
    manifest = man;
    const snap: Snapshot = {
      syncedAt: new Date().toISOString(),
      membershipType: m.membershipType,
      membershipId: m.membershipId,
      displayName: m.bungieGlobalDisplayName || m.displayName,
      profile,
    };
    await store.saveSnapshot(snap);
    return snap;
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

  app.post('/api/logout', async (c) => {
    await store.clearTokens();
    return c.json({ ok: true });
  });

  app.get('/api/inventory', async (c) => {
    const t = await validTokens();
    if (!t) return c.json({ signedIn: false }, 401);
    let snap = c.req.query('refresh') ? undefined : await store.latestSnapshot();
    // The item table is needed to name items, so a cold server always syncs once.
    if (!snap || !manifest) snap = await sync(t);
    const view = await buildView(snap);
    return c.json({
      signedIn: true,
      displayName: snap.displayName,
      syncedAt: snap.syncedAt,
      manifestVersion: manifest!.version,
      agentEnabled: !!deps.anthropic,
      ...view,
    });
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
    const reply = await askAgent(deps.anthropic, () => lastView!, history);
    return c.json({ reply });
  });

  // Turns a raw snapshot into what the web app and the agent see: items with roll verdicts, plus cleanup picks.
  async function buildView(snap: Snapshot) {
    const list = await deps.wishList();
    const items: AppraisedItem[] = summarizeProfile(snap.profile, manifest!).map((i) =>
      i.itemType === 3 && i.perks
        ? { ...i, appraisal: appraise(i.itemHash, new Set(i.perks.flat().map((p) => p.name)), list, manifest!) }
        : i,
    );
    const characters = summarizeCharacters(snap.profile);
    const cleanup = cleanupCandidates(items);
    lastView = { displayName: snap.displayName, characters, items, cleanup };
    return { characters, items, cleanup };
  }

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: err.message }, 500);
  });

  return app;
}
