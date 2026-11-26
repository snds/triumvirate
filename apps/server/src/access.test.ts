import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from 'jose';
import { accessConfigFromEnv, accessGate } from './access.ts';

const team = 'snds.cloudflareaccess.com';
const aud = 'aud-tag';

async function setup(allowedEmails?: string[]) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
  const app = new Hono();
  app.use('*', accessGate({ teamDomain: team, audience: aud, allowedEmails }, createLocalJWKSet({ keys: [jwk] })));
  app.get('/api/x', (c) => c.text('ok'));
  const sign = (claims: { aud?: string; iss?: string; email?: string; exp?: string } = {}) =>
    new SignJWT({ email: claims.email ?? 'me@example.com' })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(claims.iss ?? `https://${team}`)
      .setAudience(claims.aud ?? aud)
      .setIssuedAt()
      .setExpirationTime(claims.exp ?? '1h')
      .sign(privateKey);
  return { app, sign };
}

test('no token is refused', async () => {
  const { app } = await setup();
  const res = await app.request('/api/x');
  assert.equal(res.status, 403);
  // The app's own calls get a kind, so it can show "sign in to your server again".
  assert.equal(((await res.json()) as { kind: string }).kind, 'access');
});

test('a valid Access token gets through, by header or cookie', async () => {
  const { app, sign } = await setup();
  const t = await sign();
  assert.equal((await app.request('/api/x', { headers: { 'cf-access-jwt-assertion': t } })).status, 200);
  assert.equal((await app.request('/api/x', { headers: { cookie: `a=b; CF_Authorization=${t}` } })).status, 200);
});

test('wrong audience, wrong issuer, or expired tokens are refused', async () => {
  const { app, sign } = await setup();
  for (const t of [await sign({ aud: 'other' }), await sign({ iss: 'https://evil.cloudflareaccess.com' }), await sign({ exp: '-1m' })]) {
    assert.equal((await app.request('/api/x', { headers: { 'cf-access-jwt-assertion': t } })).status, 403);
  }
});

test('the email allow list is enforced', async () => {
  const { app, sign } = await setup(['me@example.com']);
  const other = await sign({ email: 'someone@else.com' });
  assert.equal((await app.request('/api/x', { headers: { 'cf-access-jwt-assertion': other } })).status, 403);
  const me = await sign({ email: 'Me@Example.com' });
  assert.equal((await app.request('/api/x', { headers: { 'cf-access-jwt-assertion': me } })).status, 200);
});

test('config needs both team domain and audience', () => {
  assert.equal(accessConfigFromEnv({}), undefined);
  assert.equal(accessConfigFromEnv({ CF_ACCESS_TEAM_DOMAIN: team }), undefined);
  assert.deepEqual(accessConfigFromEnv({ CF_ACCESS_TEAM_DOMAIN: team, CF_ACCESS_AUD: aud, ALLOWED_EMAILS: 'A@b.com, c@d.com' }),
    { teamDomain: team, audience: aud, allowedEmails: ['a@b.com', 'c@d.com'] });
});

test('home screen icons load without signing in; everything else stays gated', async () => {
  const { app } = await setup();
  app.get('*', (c) => c.text('ok'));
  for (const p of ['/icons/apple-touch-icon.png', '/icons/icon-512.png', '/icons/icon.svg', '/apple-touch-icon.png', '/apple-touch-icon-precomposed.png', '/apple-touch-icon-180x180.png', '/favicon.ico'])
    assert.equal((await app.request(p)).status, 200, p);
  for (const p of ['/', '/index.html', '/manifest.webmanifest', '/api/x', '/icons/x.json', '/icons/a/b.png', '/icons/..png'])
    assert.equal((await app.request(p)).status, 403, p);
});
