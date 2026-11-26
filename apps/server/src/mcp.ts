// Triumvirate as an MCP server, so Claude (claude.ai, the desktop app, Claude Code) can read your gear
// with your own Claude sign-in instead of an API key on this server.
//
// Claude's servers can't get through Cloudflare Access, so these paths bypass it and carry their own
// OAuth 2.1 sign-in (dynamic client registration + PKCE, as the MCP spec asks):
//   public:  /mcp, /.well-known/oauth-*, /oauth/register, /oauth/token
//   gated:   /oauth/authorize, the consent page, which stays behind Access so only you can approve.
// The tools are the chat's read tools plus move, equip, and lock. Nothing can dismantle or delete gear
// (Bungie's API can't), and you can disconnect Claude from Settings at any time.
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Hono, type Context } from 'hono';

/** One tool, in the shape the chat's tool runner already uses. */
export interface McpTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
  run: (args: never) => Promise<unknown> | unknown;
  /** False for tools that change your gear (move, equip, lock); Claude asks before using those. */
  readOnly?: boolean;
}

export interface McpDeps {
  dataDir: string;
  /** The tools, with your gear loaded (syncs once if the server just started). */
  tools: () => Promise<McpTool[]>;
  /** Overridable clock, for tests. */
  now?: () => number;
}

/** Paths that skip Cloudflare Access; each one checks its own credentials. */
export const MCP_PUBLIC_PATHS = [/^\/mcp$/, /^\/\.well-known\/oauth-(protected-resource|authorization-server)(\/mcp)?$/, /^\/oauth\/(register|token)$/];
export const isMcpPublic = (path: string) => MCP_PUBLIC_PATHS.some((re) => re.test(path));

/** Only Claude's own callback hosts may register, so a stranger can't send codes elsewhere. */
const REDIRECT_HOSTS = ['claude.ai', 'claude.com'];
const allowedRedirect = (uri: string) => {
  try {
    const u = new URL(uri);
    if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true; // Claude Code
    return u.protocol === 'https:' && REDIRECT_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch { return false; }
};

const ACCESS_TTL = 60 * 60 * 1000; // 1 hour
const REFRESH_TTL = 90 * 24 * 60 * 60 * 1000; // 90 days, like Bungie's
const CODE_TTL = 5 * 60 * 1000;
const PROTOCOL = '2025-06-18';

interface Client { id: string; name: string; redirectUris: string[]; createdAt: number }
interface Grant { clientId: string; access: string; accessExpiresAt: number; refresh: string; refreshExpiresAt: number; createdAt: number; lastUsedAt?: number }
interface AuthFile { clients: Client[]; grants: Grant[] }

const sha = (s: string) => createHash('sha256').update(s).digest('base64url');
const token = () => randomBytes(32).toString('base64url');

/** The public address, as Claude reaches it (the tunnel sends plain http with x-forwarded-proto). */
export function origin(c: Context) {
  const fixed = process.env.PUBLIC_URL?.replace(/\/$/, '');
  if (fixed) return fixed;
  const url = new URL(c.req.url);
  const proto = c.req.header('x-forwarded-proto') ?? url.protocol.replace(':', '');
  return `${proto}://${c.req.header('host') ?? url.host}`;
}

export function createMcp(deps: McpDeps) {
  const now = deps.now ?? Date.now;
  const file = join(deps.dataDir, 'mcp-auth.json');
  let cache: AuthFile | undefined;
  const load = async (): Promise<AuthFile> => {
    if (cache) return cache;
    try { cache = JSON.parse(await readFile(file, 'utf8')) as AuthFile; } catch { cache = { clients: [], grants: [] }; }
    return cache;
  };
  const save = async () => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(cache, null, 2));
  };
  /** Codes live in memory only: a restart mid-sign-in just means approving again. */
  const codes = new Map<string, { clientId: string; redirectUri: string; challenge: string; expiresAt: number }>();

  /** Tokens are stored hashed, so the file alone can't be replayed. */
  async function issue(clientId: string) {
    const a = await load();
    const access = token();
    const refresh = token();
    a.grants.push({ clientId, access: sha(access), accessExpiresAt: now() + ACCESS_TTL, refresh: sha(refresh), refreshExpiresAt: now() + REFRESH_TTL, createdAt: now() });
    a.grants = a.grants.filter((g) => g.refreshExpiresAt > now());
    await save();
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL / 1000, refresh_token: refresh };
  }

  const app = new Hono();

  app.get('/.well-known/oauth-protected-resource', (c) => c.json({ resource: `${origin(c)}/mcp`, authorization_servers: [origin(c)], bearer_methods_supported: ['header'] }));
  app.get('/.well-known/oauth-protected-resource/mcp', (c) => c.json({ resource: `${origin(c)}/mcp`, authorization_servers: [origin(c)], bearer_methods_supported: ['header'] }));
  app.get('/.well-known/oauth-authorization-server', (c) => {
    const o = origin(c);
    return c.json({
      issuer: o,
      authorization_endpoint: `${o}/oauth/authorize`,
      token_endpoint: `${o}/oauth/token`,
      registration_endpoint: `${o}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['gear'],
    });
  });

  // Dynamic client registration (RFC 7591). Public clients only; redirects limited to Claude's hosts.
  app.post('/oauth/register', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { client_name?: string; redirect_uris?: string[] };
    const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u) => typeof u === 'string') : [];
    if (!uris.length || !uris.every(allowedRedirect)) return c.json({ error: 'invalid_redirect_uri', error_description: 'Only Claude can connect to this server.' }, 400);
    const a = await load();
    if (a.clients.length >= 20) a.clients = a.clients.slice(-19); // Claude re-registers now and then; keep it bounded
    const client: Client = { id: token(), name: String(body.client_name ?? 'Claude').slice(0, 80), redirectUris: uris, createdAt: now() };
    a.clients.push(client);
    await save();
    return c.json({ client_id: client.id, client_name: client.name, redirect_uris: uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }, 201);
  });

  /** Checks an authorize request; the consent page and its Allow button both run it. */
  async function authRequest(q: (k: string) => string | undefined) {
    const a = await load();
    const client = a.clients.find((x) => x.id === q('client_id'));
    const redirectUri = q('redirect_uri') ?? '';
    if (!client || !client.redirectUris.includes(redirectUri)) return { error: 'This connection request isn\'t from a client this server knows. Start again from Claude.' };
    if (q('response_type') !== 'code' || q('code_challenge_method') !== 'S256' || !q('code_challenge')) return { error: 'This connection request is missing its PKCE check. Start again from Claude.' };
    return { client, redirectUri, challenge: q('code_challenge')!, state: q('state') };
  }

  // The consent page. Behind Cloudflare Access, so reaching it already proves it's you.
  app.get('/oauth/authorize', async (c) => {
    const r = await authRequest((k) => c.req.query(k));
    if ('error' in r) return c.html(page('Can\'t connect', `<p>${esc(r.error!)}</p>`), 400);
    const hidden = ['client_id', 'redirect_uri', 'response_type', 'code_challenge', 'code_challenge_method', 'state']
      .map((k) => `<input type="hidden" name="${k}" value="${esc(c.req.query(k) ?? '')}">`).join('');
    return c.html(page('Connect Claude to Triumvirate', `
      <p><strong>${esc(r.client.name)}</strong> wants to use your Destiny gear through Triumvirate.</p>
      <ul><li>See your characters, vault, roll grades, and the cleanup list</li><li>Plan armor builds from what you own</li><li>Move, equip, and lock items when you ask it to</li></ul>
      <p class="muted">It can't dismantle or delete anything. You can disconnect it any time in Triumvirate's Settings.</p>
      <form method="post" action="/oauth/authorize">${hidden}
        <button name="decision" value="allow" class="primary">Allow</button>
        <button name="decision" value="deny">Cancel</button>
      </form>`));
  });

  app.post('/oauth/authorize', async (c) => {
    const form = await c.req.parseBody();
    const q = (k: string) => (typeof form[k] === 'string' ? (form[k] as string) : undefined);
    const r = await authRequest(q);
    if ('error' in r) return c.html(page('Can\'t connect', `<p>${esc(r.error!)}</p>`), 400);
    const back = new URL(r.redirectUri);
    if (r.state) back.searchParams.set('state', r.state);
    if (q('decision') !== 'allow') {
      back.searchParams.set('error', 'access_denied');
      return c.redirect(back.toString());
    }
    const code = token();
    codes.set(code, { clientId: r.client.id, redirectUri: r.redirectUri, challenge: r.challenge, expiresAt: now() + CODE_TTL });
    back.searchParams.set('code', code);
    return c.redirect(back.toString());
  });

  app.post('/oauth/token', async (c) => {
    const form = await c.req.parseBody();
    const f = (k: string) => (typeof form[k] === 'string' ? (form[k] as string) : '');
    const bad = (error: string) => c.json({ error }, 400);
    if (f('grant_type') === 'authorization_code') {
      const entry = codes.get(f('code'));
      codes.delete(f('code')); // single use, even on failure
      if (!entry || entry.expiresAt < now() || entry.clientId !== f('client_id') || entry.redirectUri !== f('redirect_uri')) return bad('invalid_grant');
      if (sha(f('code_verifier')) !== entry.challenge) return bad('invalid_grant');
      return c.json(await issue(entry.clientId));
    }
    if (f('grant_type') === 'refresh_token') {
      const a = await load();
      const g = a.grants.find((x) => x.refresh === sha(f('refresh_token')) && x.refreshExpiresAt > now());
      if (!g || (f('client_id') && g.clientId !== f('client_id'))) return bad('invalid_grant');
      a.grants = a.grants.filter((x) => x !== g); // rotate: the old refresh token stops working
      return c.json(await issue(g.clientId));
    }
    return bad('unsupported_grant_type');
  });

  /** The grant behind a bearer token, or undefined. Marks it used, for the Settings list. */
  async function bearer(c: Context) {
    const t = c.req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!t) return undefined;
    const a = await load();
    const g = a.grants.find((x) => x.access === sha(t) && x.accessExpiresAt > now());
    if (g && (!g.lastUsedAt || now() - g.lastUsedAt > 60_000)) { g.lastUsedAt = now(); await save(); }
    return g;
  }

  // Streamable HTTP transport, answered as plain JSON (no server-initiated messages needed).
  app.post('/mcp', async (c) => {
    if (!(await bearer(c))) {
      c.header('WWW-Authenticate', `Bearer resource_metadata="${origin(c)}/.well-known/oauth-protected-resource"`);
      return c.json({ error: 'invalid_token' }, 401);
    }
    const msg = (await c.req.json().catch(() => undefined)) as { jsonrpc?: string; id?: string | number; method?: string; params?: Record<string, unknown> } | undefined;
    if (!msg || Array.isArray(msg)) return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Send one JSON-RPC message.' } }, 400);
    if (msg.id === undefined) return c.body(null, 202); // a notification, e.g. notifications/initialized
    const reply = (result: unknown) => c.json({ jsonrpc: '2.0', id: msg.id, result });
    const fail = (code: number, message: string) => c.json({ jsonrpc: '2.0', id: msg.id, error: { code, message } });
    switch (msg.method) {
      case 'initialize':
        return reply({
          protocolVersion: typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: { name: 'triumvirate', version: '1.0.0' },
          instructions: 'One player\'s Destiny 2 gear: characters, items, roll grades, cleanup picks, armor optimizer, and subclass options, plus moving, equipping, and locking items. Only act on gear when the player asks. Use the ids the tools return.',
        });
      case 'ping':
        return reply({});
      case 'tools/list': {
        const tools = await deps.tools();
        return reply({ tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema, annotations: { readOnlyHint: t.readOnly !== false, destructiveHint: false } })) });
      }
      case 'tools/call': {
        const name = String(msg.params?.name ?? '');
        const tool = (await deps.tools()).find((t) => t.name === name);
        if (!tool) return fail(-32602, `No tool named ${name}.`);
        try {
          const out = await tool.run((msg.params?.arguments ?? {}) as never);
          return reply({ content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out) }] });
        } catch (err) {
          return reply({ content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }], isError: true });
        }
      }
      default:
        return fail(-32601, `Unknown method ${msg.method}.`);
    }
  });
  app.get('/mcp', (c) => c.body(null, 405)); // no server-to-client stream

  /** For the Settings sheet: who's connected, and a way to cut them off. Behind Access. */
  app.get('/api/mcp', async (c) => {
    const a = await load();
    const live = a.grants.filter((g) => g.refreshExpiresAt > now());
    const byClient = new Map<string, Grant[]>();
    for (const g of live) byClient.set(g.clientId, [...(byClient.get(g.clientId) ?? []), g]);
    return c.json({
      url: `${origin(c)}/mcp`,
      connections: [...byClient].map(([id, gs]) => ({
        id,
        name: a.clients.find((x) => x.id === id)?.name ?? 'Claude',
        connectedAt: new Date(Math.min(...gs.map((g) => g.createdAt))).toISOString(),
        lastUsedAt: gs.some((g) => g.lastUsedAt) ? new Date(Math.max(...gs.map((g) => g.lastUsedAt ?? 0))).toISOString() : undefined,
      })),
    });
  });
  app.delete('/api/mcp/:id', async (c) => {
    const a = await load();
    const id = c.req.param('id');
    a.grants = a.grants.filter((g) => g.clientId !== id);
    a.clients = a.clients.filter((x) => x.id !== id);
    await save();
    return c.json({ ok: true });
  });

  return app;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** A small standalone page in the app's colors (no app bundle on this path). */
function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>
:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d10;color:#e7eaee;font:15px/1.5 Inter,system-ui,-apple-system,'Segoe UI',sans-serif;padding:24px}
main{max-width:420px;display:grid;gap:12px}h1{margin:0;font-size:20px}p{margin:0}ul{margin:0;padding-left:20px;color:#a3abb6}.muted{color:#6c737e;font-size:13px}
form{display:flex;gap:8px;margin-top:8px}button{font:inherit;font-weight:600;padding:10px 18px;border-radius:8px;border:1px solid #2c333d;background:#181c22;color:#e7eaee;cursor:pointer}
button.primary{background:#ceae33;border-color:#ceae33;color:#0b0d10}
</style></head><body><main><h1>${esc(title)}</h1>${body}</main></body></html>`;
}
