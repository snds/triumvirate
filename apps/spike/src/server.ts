// Step 0 spike: sign in with Bungie, pull your profile, and print every item by name.
// Bungie requires an HTTPS redirect URL, so this serves HTTPS with a self-signed cert.
import { createServer } from 'node:https';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import selfsigned from 'selfsigned';
import { getMembershipDataForCurrentUser } from 'bungie-api-ts/user';
import { getProfile } from 'bungie-api-ts/destiny2';

// Component numbers from Bungie's DestinyComponentType (a const enum, so typed as literals here).
const COMPONENTS = [
  100, // Profiles
  102, // ProfileInventories (vault)
  200, // Characters
  201, // CharacterInventories
  205, // CharacterEquipment
  300, // ItemInstances (power level)
];
import {
  authorizeUrl, createHttpClient, exchangeCode, loadManifest, needsRefresh, refreshTokens,
  summarizeProfile, type BungieConfig, type Tokens,
} from '@triumvirate/core';

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing ${k}. Copy .env.example to .env and fill it in.`);
  return v;
};
const cfg: BungieConfig = {
  apiKey: env('BUNGIE_API_KEY'),
  clientId: env('BUNGIE_CLIENT_ID'),
  clientSecret: env('BUNGIE_CLIENT_SECRET'),
};
const port = Number(process.env.PORT ?? 5443);
const dataDir = join(process.cwd(), '../../.data');
const tokenFile = join(dataDir, 'tokens.json');
await mkdir(dataDir, { recursive: true });

// Single-user app: one token file on disk is all the "session" we need.
async function getTokens(): Promise<Tokens | undefined> {
  let t: Tokens;
  try { t = JSON.parse(await readFile(tokenFile, 'utf8')); } catch { return undefined; }
  if (Date.now() > t.refreshExpiresAt) return undefined;
  if (needsRefresh(t)) {
    t = await refreshTokens(cfg, t.refreshToken);
    await writeFile(tokenFile, JSON.stringify(t));
  }
  return t;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const page = (body: string) =>
  `<!doctype html><meta charset="utf-8"><title>Triumvirate spike</title>
  <style>body{font:14px system-ui;margin:24px;background:#111;color:#eee}table{border-collapse:collapse}
  td,th{padding:4px 10px;border-bottom:1px solid #333;text-align:left}a{color:#7cf}</style>${body}`;

async function renderVault(t: Tokens): Promise<string> {
  const http = createHttpClient(cfg.apiKey, t.accessToken);
  const { Response: me } = await getMembershipDataForCurrentUser(http);
  // Cross-save accounts name a primary membership; otherwise take the first one.
  const membership =
    me.destinyMemberships.find((m) => m.membershipId === me.primaryMembershipId) ?? me.destinyMemberships[0];
  if (!membership) return page('<p>No Destiny 2 account found on this Bungie profile.</p>');

  const [manifest, { Response: profile }] = await Promise.all([
    loadManifest(http, join(dataDir, 'manifest')),
    getProfile(http, {
      membershipType: membership.membershipType,
      destinyMembershipId: membership.membershipId,
      components: COMPONENTS,
    }),
  ]);

  const rows = summarizeProfile(profile, manifest).sort(
    (a, b) => a.location.localeCompare(b.location) || a.bucket.localeCompare(b.bucket) || a.name.localeCompare(b.name),
  );
  const vaultCount = rows.filter((r) => r.location === 'Vault').length;
  return page(`<h1>${esc(membership.displayName)}</h1>
    <p>${rows.length} items, ${vaultCount} in the vault. Manifest ${esc(manifest.version)}.</p>
    <table><tr><th>Where</th><th>Slot</th><th>Item</th><th>Type</th><th>Power</th></tr>
    ${rows.map((r) => `<tr><td>${esc(r.location)}${r.equipped ? ' ★' : ''}</td><td>${esc(r.bucket)}</td>
      <td>${esc(r.name)}</td><td>${esc(r.type)}</td><td>${esc(r.power)}</td></tr>`).join('')}</table>`);
}

let pendingState = '';
const pems = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], { notAfterDate: new Date(Date.now() + 30 * 864e5) });

createServer({ key: pems.private, cert: pems.cert }, async (req, res) => {
  const url = new URL(req.url ?? '/', `https://localhost:${port}`);
  const send = (status: number, html: string) => { res.writeHead(status, { 'Content-Type': 'text/html' }); res.end(html); };
  try {
    if (url.pathname === '/auth/login') {
      pendingState = randomBytes(16).toString('hex');
      res.writeHead(302, { Location: authorizeUrl(cfg, pendingState) });
      return res.end();
    }
    if (url.pathname === '/auth/callback') {
      if (!pendingState || url.searchParams.get('state') !== pendingState) return send(400, page('<p>Sign-in state mismatch. <a href="/auth/login">Try again</a>.</p>'));
      pendingState = '';
      const t = await exchangeCode(cfg, url.searchParams.get('code') ?? '');
      await writeFile(tokenFile, JSON.stringify(t));
      res.writeHead(302, { Location: '/' });
      return res.end();
    }
    if (url.pathname === '/') {
      const t = await getTokens();
      return send(200, t ? await renderVault(t) : page('<p><a href="/auth/login">Sign in with Bungie</a></p>'));
    }
    send(404, page('<p>Not found.</p>'));
  } catch (err) {
    console.error(err);
    send(500, page(`<pre>${esc(err instanceof Error ? err.message : err)}</pre>`));
  }
}).listen(port, () => console.log(`Triumvirate spike on https://localhost:${port}`));
