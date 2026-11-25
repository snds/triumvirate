// Cloudflare Access gate for the hosted copy. The app has no login of its own: whoever reaches it
// acts as your Bungie account and spends your Anthropic key. So when it's hosted, every request
// must carry the signed token Cloudflare Access adds after you sign in, and we check that token
// here too. That way a tunnel or Access rule set up wrong fails closed instead of open.
import type { MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface AccessConfig {
  /** e.g. "snds.cloudflareaccess.com" (Zero Trust > Settings > Custom Pages shows the team name). */
  teamDomain: string;
  /** The Access application's "Application Audience (AUD) Tag". */
  audience: string;
  /** Optional: only these emails get in, even if the Access policy is wider. Lowercase. */
  allowedEmails?: string[];
}

/** `keys` is for tests; normally the keys come from your Access team domain. */
export function accessGate(cfg: AccessConfig, keys?: JWTVerifyGetKey): MiddlewareHandler {
  const issuer = `https://${cfg.teamDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
  // jose caches the signing keys and refetches when Cloudflare rotates them.
  keys ??= createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  return async (c, next) => {
    // Access sends the token as a header to the origin, and as a cookie to the browser.
    const token = c.req.header('cf-access-jwt-assertion')
      ?? c.req.header('cookie')?.match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1];
    if (!token) return c.text('Sign in through Cloudflare Access to use this app.', 403);
    try {
      const { payload } = await jwtVerify(token, keys, { issuer, audience: cfg.audience });
      const email = String(payload.email ?? '').toLowerCase();
      if (cfg.allowedEmails?.length && !cfg.allowedEmails.includes(email)) return c.text('This account is not allowed.', 403);
    } catch {
      return c.text('Your Cloudflare Access sign-in is missing or expired. Reload to sign in again.', 403);
    }
    await next();
  };
}

/** Reads the gate settings from the environment. Undefined means no gate (local use only). */
export function accessConfigFromEnv(env: NodeJS.ProcessEnv): AccessConfig | undefined {
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN?.trim();
  const audience = env.CF_ACCESS_AUD?.trim();
  if (!teamDomain || !audience) return undefined;
  const allowedEmails = env.ALLOWED_EMAILS?.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return { teamDomain, audience, allowedEmails };
}
