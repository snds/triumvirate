import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.ts';
import { createStore } from './store.ts';
import { chatTitle } from './chats.ts';

const cfg = { apiKey: 'k', clientId: '123', clientSecret: 's' };

test('saves, lists newest first, reopens, and deletes chats', async () => {
  const app = createApp(cfg, createStore(await mkdtemp(join(tmpdir(), 'tri-'))), { wishList: async () => new Map() });
  const put = (id: string, q: string) => app.request(`/api/chats/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ turns: [{ role: 'user', content: q }, { role: 'assistant', content: 'ok' }] }),
  });
  assert.equal((await put('chat-aaaaaa', 'First question')).status, 200);
  await new Promise((f) => setTimeout(f, 5));
  assert.equal((await put('chat-bbbbbb', 'Second question')).status, 200);
  const list = await (await app.request('/api/chats')).json();
  assert.deepEqual(list.map((c: { title: string }) => c.title), ['Second question', 'First question']);
  assert.equal(list[0].turnCount, 2);
  const chat = await (await app.request('/api/chats/chat-aaaaaa')).json();
  assert.equal(chat.turns[0].content, 'First question');
  await app.request('/api/chats/chat-aaaaaa', { method: 'DELETE' });
  assert.equal((await app.request('/api/chats/chat-aaaaaa')).status, 404);
  assert.equal((await put('../etc', 'x')).status, 404); // not a route at all
  assert.equal((await put('BAD!id', 'x')).status, 400);
});

test('titles come from the first question, shortened', () => {
  assert.equal(chatTitle([{ role: 'user', content: '  What   should I\n dismantle? ' }]), 'What should I dismantle?');
  assert.ok(chatTitle([{ role: 'user', content: 'x'.repeat(100) }]).length <= 70);
});
