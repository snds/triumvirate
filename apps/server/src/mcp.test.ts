import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMcp, isMcpPublic, type McpTool } from './mcp.ts';

const tools: McpTool[] = [
  { name: 'inventory_summary', description: 'gear', input_schema: { type: 'object' }, run: () => ({ characters: 3 }) },
  { name: 'set_lock', input_schema: { type: 'object' }, run: ((a: { id: string }) => `locked ${a.id}`) as McpTool['run'], readOnly: false },
];
const redirect = 'https://claude.ai/api/mcp/auth_callback';
const form = (o: Record<string, string>) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() });
const rpc = (token: string | undefined, body: unknown) => ({
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
});

test('only the MCP and token paths skip Cloudflare Access; the consent page does not', () => {
  for (const p of ['/mcp', '/oauth/token', '/oauth/register', '/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource']) assert.ok(isMcpPublic(p), p);
  for (const p of ['/oauth/authorize', '/api/mcp', '/api/inventory', '/mcp/x']) assert.ok(!isMcpPublic(p), p);
});

test('registration only accepts Claude callback addresses', async () => {
  const app = createMcp({ dataDir: await mkdtemp(join(tmpdir(), 'mcp-')), tools: async () => tools });
  const bad = await app.request('/oauth/register', rpc(undefined, { redirect_uris: ['https://evil.example/cb'] }));
  assert.equal(bad.status, 400);
});

test('sign in with PKCE, then list and call tools; refresh rotates; disconnect revokes', async () => {
  const app = createMcp({ dataDir: await mkdtemp(join(tmpdir(), 'mcp-')), tools: async () => tools });
  // No token: 401 that points at the metadata.
  const anon = await app.request('http://h/mcp', rpc(undefined, { jsonrpc: '2.0', id: 1, method: 'tools/list' }));
  assert.equal(anon.status, 401);
  assert.match(anon.headers.get('www-authenticate') ?? '', /resource_metadata=".*\/\.well-known\/oauth-protected-resource"/);

  const reg = (await (await app.request('/oauth/register', rpc(undefined, { client_name: 'Claude', redirect_uris: [redirect] }))).json()) as { client_id: string };
  const verifier = 'v'.repeat(50);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const q = { client_id: reg.client_id, redirect_uri: redirect, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz' };
  assert.equal((await app.request(`/oauth/authorize?${new URLSearchParams(q)}`)).status, 200);
  const allowed = await app.request('/oauth/authorize', form({ ...q, decision: 'allow' }));
  const back = new URL(allowed.headers.get('location')!);
  assert.equal(back.searchParams.get('state'), 'xyz');
  const code = back.searchParams.get('code')!;

  // Wrong verifier fails, and burns the code.
  assert.equal((await app.request('/oauth/token', form({ grant_type: 'authorization_code', code, client_id: reg.client_id, redirect_uri: redirect, code_verifier: 'nope' }))).status, 400);
  const allowed2 = await app.request('/oauth/authorize', form({ ...q, decision: 'allow' }));
  const code2 = new URL(allowed2.headers.get('location')!).searchParams.get('code')!;
  const tok = (await (await app.request('/oauth/token', form({ grant_type: 'authorization_code', code: code2, client_id: reg.client_id, redirect_uri: redirect, code_verifier: verifier }))).json()) as { access_token: string; refresh_token: string };
  assert.ok(tok.access_token && tok.refresh_token);

  const init = (await (await app.request('/mcp', rpc(tok.access_token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }))).json()) as { result: { serverInfo: { name: string } } };
  assert.equal(init.result.serverInfo.name, 'triumvirate');
  const list = (await (await app.request('/mcp', rpc(tok.access_token, { jsonrpc: '2.0', id: 2, method: 'tools/list' }))).json()) as { result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] } };
  assert.deepEqual(list.result.tools.map((t) => [t.name, t.annotations.readOnlyHint]), [['inventory_summary', true], ['set_lock', false]]);
  const call = (await (await app.request('/mcp', rpc(tok.access_token, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'set_lock', arguments: { id: '42' } } }))).json()) as { result: { content: { text: string }[] } };
  assert.equal(call.result.content[0]!.text, 'locked 42');

  // Refresh rotates: the old refresh token stops working.
  const next = (await (await app.request('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token }))).json()) as { access_token: string };
  assert.ok(next.access_token);
  assert.equal((await app.request('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token }))).status, 400);

  // Settings lists the connection; disconnecting revokes its tokens.
  const conns = (await (await app.request('/api/mcp')).json()) as { connections: { id: string }[] };
  assert.equal(conns.connections.length, 1);
  await app.request(`/api/mcp/${conns.connections[0]!.id}`, { method: 'DELETE' });
  assert.equal((await app.request('/mcp', rpc(next.access_token, { jsonrpc: '2.0', id: 4, method: 'ping' }))).status, 401);
});
