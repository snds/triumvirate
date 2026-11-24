// Saved chat conversations: one JSON file each under .data/chats, newest kept, oldest pruned.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChatTurn } from './agent.ts';

const KEEP = 100;
/** Ids are made by the web app; keep them to a safe file-name alphabet. */
const ID = /^[a-z0-9-]{6,64}$/;

export interface SavedChat {
  id: string;
  title: string;
  updatedAt: string;
  turns: ChatTurn[];
}
export type ChatSummary = Omit<SavedChat, 'turns'> & { turnCount: number };

export const validChatId = (id: string) => ID.test(id);

/** A short title from the first question. */
export function chatTitle(turns: ChatTurn[]): string {
  const first = turns.find((t) => t.role === 'user')?.content.replace(/\s+/g, ' ').trim() ?? 'New chat';
  return first.length > 70 ? `${first.slice(0, 67).trimEnd()}…` : first;
}

export function createChatStore(dataDir: string) {
  const dir = join(dataDir, 'chats');
  const file = (id: string) => join(dir, `${id}.json`);
  const readAll = async (): Promise<SavedChat[]> => {
    let names: string[];
    try { names = (await readdir(dir)).filter((f) => f.endsWith('.json')); } catch { return []; }
    const chats = await Promise.all(names.map(async (n) => {
      try { return JSON.parse(await readFile(join(dir, n), 'utf8')) as SavedChat; } catch { return undefined; }
    }));
    return chats.filter((c): c is SavedChat => !!c).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  };
  return {
    async list(): Promise<ChatSummary[]> {
      return (await readAll()).map(({ turns, ...rest }) => ({ ...rest, turnCount: turns.length }));
    },
    async get(id: string): Promise<SavedChat | undefined> {
      if (!validChatId(id)) return undefined;
      try { return JSON.parse(await readFile(file(id), 'utf8')); } catch { return undefined; }
    },
    async save(id: string, turns: ChatTurn[]): Promise<SavedChat> {
      if (!validChatId(id)) throw new Error('Bad chat id');
      await mkdir(dir, { recursive: true });
      const chat: SavedChat = { id, title: chatTitle(turns), updatedAt: new Date().toISOString(), turns };
      await writeFile(file(id), JSON.stringify(chat));
      for (const old of (await readAll()).slice(KEEP)) await rm(file(old.id), { force: true });
      return chat;
    },
    async remove(id: string) {
      if (validChatId(id)) await rm(file(id), { force: true });
    },
  };
}
