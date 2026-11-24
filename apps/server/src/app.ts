// HTTP API for the web app. Single user: the token file on disk is the session,
// so the server only ever listens on 127.0.0.1.
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { Hono } from 'hono';
import { getMembershipDataForCurrentUser } from 'bungie-api-ts/user';
import { getProfile } from 'bungie-api-ts/destiny2';
import {
  authorizeUrl, createHttpClient, exchangeCode, loadManifest, needsRefresh, refreshTokens,
  summarizeCharacters, summarizeProfile, type BungieConfig, type ManifestTables, type Tokens,
} from '@triumvirate/core';
import type { Store, Snapshot } from './store.ts';

// Component numbers from Bungie's DestinyComponentType (a const enum, so written as literals).
const COMPONENTS = [
  100, // Profiles
  102, // ProfileInventories (vault)
  200, // Characters
  201, // CharacterInventories
  205, // CharacterEquipment
  300, // ItemInstances (power, element)
];

export function createApp(cfg: BungieConfig, store: Store) {
  const app = new Hono();
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
    return c.json({
      signedIn: true,
      displayName: snap.displayName,
      syncedAt: snap.syncedAt,
      manifestVersion: manifest!.version,
      characters: summarizeCharacters(snap.profile),
      items: summarizeProfile(snap.profile, manifest!),
    });
  });

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: err.message }, 500);
  });

  return app;
}
