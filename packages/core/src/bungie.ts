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

/**
 * A failed Bungie call. The message keeps the "Bungie API error N: …" shape that callers match on.
 * `code` is Bungie's ErrorCode (5 = SystemDisabled, i.e. maintenance); `status` is the HTTP status.
 */
export class BungieError extends Error {
  constructor(readonly code: number, message: string, readonly status = 0) {
    super(`Bungie API error ${code}: ${message}`);
    this.name = 'BungieError';
  }
}

/** True when Bungie itself is down: maintenance (SystemDisabled) or a 5xx with no data. */
export const bungieIsDown = (err: unknown) => {
  const code = err instanceof BungieError ? err.code : Number(/Bungie API error (\d+)/.exec(String((err as Error)?.message ?? err))?.[1]);
  return code === 5 || (err instanceof BungieError && err.status >= 500);
};

/** A refresh token Bungie no longer accepts (expired or revoked). Not a network or maintenance failure. */
export class TokenRejected extends Error {}

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
  if (!res.ok) {
    const text = await res.text();
    // 400/401 is Bungie saying no to the grant itself; anything else is Bungie being unwell.
    if (res.status === 400 || res.status === 401) throw new TokenRejected(`Bungie token request failed: ${res.status} ${text}`);
    throw new BungieError(5, `token request failed (${res.status})`, res.status);
  }
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
    // During maintenance or an outage Bungie answers with an HTML page instead of its JSON wrapper.
    let json: { ErrorCode: number; Message: string };
    try { json = (await res.json()) as typeof json; } catch {
      throw new BungieError(res.status >= 500 ? 5 : 0, `Bungie answered ${res.status} without data`, res.status);
    }
    if (json.ErrorCode !== 1) throw new BungieError(json.ErrorCode, json.Message, res.status);
    return json as T;
  };
}
