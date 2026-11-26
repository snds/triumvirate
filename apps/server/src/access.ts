// Cloudflare Access gate for the hosted copy. The app has no login of its own: whoever reaches it
// acts as your Bungie account and spends your Anthropic key. So when it's hosted, every request
// must carry the signed token Cloudflare Access adds after you sign in, and we check that token
// here too. That way a tunnel or Access rule set up wrong fails closed instead of open.
import type { MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

// The home screen icon is fetched by iOS outside Safari, without the Access sign-in cookie, so
// behind the gate it got the sign-in page instead and iOS fell back to a letter tile. These files
// are only the app's own artwork (no account data), so they're served to anyone.
const PUBLIC_PATHS = [/^\/icons\/[\w-]+\.(png|svg)$/, /^\/apple-touch-icon(-precomposed)?(-\d+x\d+)?\.png$/, /^\/favicon\.ico$/];

/** True for the icon files that must load without signing in (see PUBLIC_PATHS). */
export const isPublicAsset = (path: string) => PUBLIC_PATHS.some((re) => re.test(path));

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
    if (isPublicAsset(c.req.path)) return next();
    // Access sends the token as a header to the origin, and as a cookie to the browser.
    const token = c.req.header('cf-access-jwt-assertion')
      ?? c.req.header('cookie')?.match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1];
    // The app's own calls get JSON with a kind, so it can show "sign in to your server again".
    const deny = (text: string) => (c.req.path.startsWith('/api/') ? c.json({ error: text, kind: 'access' }, 403) : c.text(text, 403));
    if (!token) return deny('Sign in through Cloudflare Access to use this app.');
    try {
      const { payload } = await jwtVerify(token, keys, { issuer, audience: cfg.audience });
      const email = String(payload.email ?? '').toLowerCase();
      if (cfg.allowedEmails?.length && !cfg.allowedEmails.includes(email)) return deny('This account is not allowed.');
    } catch {
      return deny('Your Cloudflare Access sign-in is missing or expired. Reload to sign in again.');
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
