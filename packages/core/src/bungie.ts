// Thin Bungie.net client: OAuth token handling plus an HttpClient that
// bungie-api-ts's typed endpoint functions can call through.
import type { HttpClient, HttpClientConfig } from 'bungie-api-ts/http';

export const BUNGIE_ROOT = 'https://www.bungie.net';
const TOKEN_URL = `${BUNGIE_ROOT}/platform/app/oauth/token/`;

export interface BungieConfig {
  apiKey: string;
  clientId: string;
  clientSecret: string;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token stops working. */
  accessExpiresAt: number;
  /** Epoch ms when the refresh token stops working (about 90 days). */
  refreshExpiresAt: number;
  bungieMembershipId: string;
}

export function authorizeUrl(cfg: BungieConfig, state: string): string {
  const u = new URL(`${BUNGIE_ROOT}/en/OAuth/Authorize`);
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('state', state);
  return u.toString();
}

/** Confidential-client token call; `grant` is either an auth code or a refresh token. */
async function tokenRequest(cfg: BungieConfig, grant: Record<string, string>): Promise<Tokens> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-API-Key': cfg.apiKey,
      Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams(grant),
  });
  if (!res.ok) throw new Error(`Bungie token request failed: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token: string;
    refresh_expires_in: number;
    membership_id: string;
  };
  const now = Date.now();
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    accessExpiresAt: now + j.expires_in * 1000,
    refreshExpiresAt: now + j.refresh_expires_in * 1000,
    bungieMembershipId: j.membership_id,
  };
}

export const exchangeCode = (cfg: BungieConfig, code: string) =>
  tokenRequest(cfg, { grant_type: 'authorization_code', code });

export const refreshTokens = (cfg: BungieConfig, refreshToken: string) =>
  tokenRequest(cfg, { grant_type: 'refresh_token', refresh_token: refreshToken });

/** True when the access token is gone or within a minute of expiring. */
export const needsRefresh = (t: Tokens, now = Date.now()) => t.accessExpiresAt - now < 60_000;

/**
 * HttpClient for bungie-api-ts. Bungie wraps every response in
 * { ErrorCode, Message, Response }; ErrorCode 1 means success.
 */
export function createHttpClient(apiKey: string, accessToken?: string): HttpClient {
  return async <T>(config: HttpClientConfig): Promise<T> => {
    const url = new URL(config.url);
    for (const [k, v] of Object.entries(config.params ?? {})) {
      if (v !== undefined) url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
    }
    const res = await fetch(url, {
      method: config.method,
      headers: {
        'X-API-Key': apiKey,
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(config.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: config.body ? JSON.stringify(config.body) : undefined,
    });
    const json = (await res.json()) as { ErrorCode: number; Message: string };
    if (json.ErrorCode !== 1) throw new Error(`Bungie API error ${json.ErrorCode}: ${json.Message}`);
    return json as T;
  };
}
