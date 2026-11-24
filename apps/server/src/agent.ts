// The agent side panel: Claude with a few read-only tools over the current snapshot.
// The tools return only data from your account, which keeps answers tied to items you own.
import Anthropic from '@anthropic-ai/sdk';
import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import type { AppraisedItem, CharacterRow, CleanupCandidate } from '@triumvirate/core';

export interface AgentContext {
  displayName: string;
  characters: CharacterRow[];
  items: AppraisedItem[];
  cleanup: CleanupCandidate[];
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM = `You are the companion agent inside Triumvirate, a personal Destiny 2 app for one player.
Answer in plain language: lead with the answer, short sentences, no unexplained jargon.
Only name items that the tools returned. Never invent items, perks, or stats. If the tools don't have it, say so.
Roll verdicts come from a community wish list: god (top pick), good (recommended), meh (no recommended roll matches), unrated (no data).
The app can't dismantle items; the player does that in game or in DIM.
When you list items, include where each one is (vault or which character).`;

const MAX_LIST = 40;

/** Compact form for list results, so tool output stays small. */
const brief = (i: AppraisedItem) => ({
  id: i.instanceId,
  name: i.name,
  type: i.type,
  tier: i.tier,
  power: i.power,
  element: i.damage,
  where: i.location,
  equipped: i.equipped || undefined,
  locked: i.locked || undefined,
  verdict: i.appraisal?.verdict,
});

export function buildTools(ctx: () => AgentContext) {
  return [
    betaTool({
      name: 'inventory_summary',
      description: 'Overview of the account: characters with power level, item counts per location, and every exotic owned.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => {
        const c = ctx();
        const counts: Record<string, number> = {};
        for (const i of c.items) counts[i.location] = (counts[i.location] ?? 0) + 1;
        return JSON.stringify({
          player: c.displayName,
          characters: c.characters.map((ch) => ({ class: ch.className, power: ch.light, lastPlayed: ch.lastPlayed })),
          itemCounts: counts,
          exotics: c.items.filter((i) => i.tier === 'Exotic' && (i.itemType === 2 || i.itemType === 3)).map(brief),
        });
      },
    }),
    betaTool({
      name: 'search_items',
      description:
        'Find weapons or armor the player owns. Every word in `query` must appear in the item name, type, rarity, or element (e.g. "solar hand cannon"). Returns up to 40 matches.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Words to match; empty matches everything.' },
          kind: { type: 'string', enum: ['weapons', 'armor', 'any'] },
          verdict: { type: 'string', enum: ['god', 'good', 'meh', 'trash', 'unrated', 'any'] },
        },
        required: ['query'],
        additionalProperties: false,
      },
      run: async ({ query, kind = 'any', verdict = 'any' }) => {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        const hits = ctx().items.filter((i) => {
          if (kind === 'weapons' && i.itemType !== 3) return false;
          if (kind === 'armor' && i.itemType !== 2) return false;
          if (kind === 'any' && i.itemType !== 2 && i.itemType !== 3) return false;
          if (verdict !== 'any' && i.appraisal?.verdict !== verdict) return false;
          const hay = `${i.name} ${i.type} ${i.tier} ${i.damage ?? ''}`.toLowerCase();
          return words.every((w) => hay.includes(w));
        });
        return JSON.stringify({ total: hits.length, items: hits.slice(0, MAX_LIST).map(brief) });
      },
    }),
    betaTool({
      name: 'get_item',
      description: 'Full detail for one item by id: perk columns, armor stats, gear tier, and wish list notes.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'The item id from search results.' } },
        required: ['id'],
        additionalProperties: false,
      },
      run: async ({ id }) => {
        const i = ctx().items.find((x) => x.instanceId === id);
        if (!i) return JSON.stringify({ error: `No item with id ${id}.` });
        return JSON.stringify({
          ...brief(i),
          gearTier: i.gearTier,
          perks: i.perks?.map((col) => col.map((p) => (p.active ? `${p.name} (slotted)` : p.name))),
          stats: i.stats,
          wishList: i.appraisal,
        });
      },
    }),
    betaTool({
      name: 'cleanup_list',
      description: 'Items the app suggests dismantling, each with the reason and a confidence of high or medium.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => {
        const list = ctx().cleanup;
        return JSON.stringify({
          total: list.length,
          items: list.slice(0, 60).map((c) => ({ ...brief(c.item), reason: c.reason, confidence: c.confidence })),
        });
      },
    }),
  ];
}

export async function askAgent(client: Anthropic, ctx: () => AgentContext, history: ChatTurn[]): Promise<string> {
  const final = await client.beta.messages.toolRunner({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    max_iterations: 8,
    output_config: { effort: 'medium' },
    // If a safety check declines, the API retries on a fallback model in the same call.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    tools: buildTools(ctx),
    messages: history.map((t) => ({ role: t.role, content: t.content })),
  });
  if (final.stop_reason === 'refusal') return "I can't help with that one.";
  const text = final.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim();
  return text || "I couldn't put together an answer. Try asking another way.";
}
