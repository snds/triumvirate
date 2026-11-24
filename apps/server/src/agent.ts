// The agent side panel: Claude with a few read-only tools over the current snapshot.
// The tools return only data from your account, which keeps answers tied to items you own.
import Anthropic from '@anthropic-ai/sdk';
import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import type { AppraisedItem, CharacterRow, CleanupCandidate, SubclassIndex, SubclassPart } from '@triumvirate/core';

export interface AgentContext {
  displayName: string;
  characters: CharacterRow[];
  items: AppraisedItem[];
  cleanup: CleanupCandidate[];
  /** Supers, abilities, aspects, and fragments from the manifest; absent until the full manifest loads. */
  subclass?: SubclassIndex;
}

/** What the chat panel receives while the agent works. */
export type AgentEvent =
  | { type: 'status'; text: string }
  | { type: 'text'; delta: string }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string };

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM = `You are the companion agent inside Triumvirate, a personal Destiny 2 app for one player.
Answer in plain language: lead with the answer, short sentences, no unexplained jargon.
Only name items that the tools returned. Never invent items, perks, or stats. If the tools don't have it, say so.
Roll verdicts come from a community wish list: god (top pick), good (recommended), meh (no recommended roll matches), unrated (no data).
The app can't dismantle items; the player does that in game or in DIM.

Formatting (the app renders Markdown):
- Use short sections with ### headings, bullet lists, and **bold** for key words. Use a table when comparing items.
- inventory_summary includes each character's equipped subclass (super, abilities, aspects, fragments) and stats. Start builds from that real setup when it fits.
- Every time you mention an item the player owns, write it as a link to its id: [Fatebringer](item:6917529123456789). The app turns these into item chips with a hover preview, so don't also repeat the location unless it matters.
- When you suggest a build, put it in one fenced code block with the language "build" holding JSON, and keep prose around it short. Shape:
  {"name": "...", "class": "Warlock", "subclass": "Void", "tags": ["PvE", "Ad-clear"], "summary": "one or two sentences",
   "super": "Nova Bomb", "abilities": {"grenade": "...", "melee": "...", "class": "...", "movement": "..."},
   "aspects": ["..."], "fragments": ["..."],
   "weapons": [{"id": "<item id>", "note": "why"}], "armor": [{"id": "<item id>", "note": "why"}],
   "statPriority": ["Grenade", "Super", "Health"], "mods": ["..."], "howToPlay": "short paragraph"}
  Take super, abilities, aspects, and fragment names from subclass_options, and item ids from the item tools. Leave out anything you can't ground.`;

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

/** `onStatus` lets the chat show what the agent is doing while each tool runs. */
export function buildTools(ctx: () => AgentContext, onStatus: (text: string) => void = () => {}) {
  return [
    betaTool({
      name: 'inventory_summary',
      description: 'Overview of the account: characters with power level, item counts per location, and every exotic owned.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => {
        onStatus('Reading your account overview');
        const c = ctx();
        const counts: Record<string, number> = {};
        for (const i of c.items) counts[i.location] = (counts[i.location] ?? 0) + 1;
        return JSON.stringify({
          player: c.displayName,
          characters: c.characters.map((ch) => ({
            class: ch.className,
            power: ch.light,
            lastPlayed: ch.lastPlayed,
            stats: Object.fromEntries((ch.stats ?? []).map((st) => [st.name, st.value])),
            // What's equipped right now, so builds can start from the player's real setup.
            subclass: ch.subclass && {
              name: ch.subclass.name,
              element: ch.subclass.element,
              ...Object.fromEntries(Object.entries(ch.subclass.parts).map(([slot, ps]) => [slot, ps.map((p) => p.name)])),
            },
          })),
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
        onStatus(query.trim() ? `Searching your gear for "${query.trim()}"` : 'Looking through your gear');
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
        onStatus(i ? `Checking ${i.name}` : 'Checking an item');
        if (!i) return JSON.stringify({ error: `No item with id ${id}.` });
        return JSON.stringify({
          ...brief(i),
          gearTier: i.gearTier,
          frame: i.intrinsic?.name,
          perks: i.perks?.map((col) => col.map((p) => (p.active ? `${p.name} (slotted)` : p.name))),
          mods: i.mods?.map((m) => m.name),
          stats: i.stats,
          crafted: i.crafted ? { level: i.craftedLevel } : undefined,
          wishList: i.appraisal,
        });
      },
    }),
    betaTool({
      name: 'cleanup_list',
      description: 'Items the app suggests dismantling, each with the reason and a confidence of high or medium.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => {
        onStatus('Reviewing cleanup picks');
        const list = ctx().cleanup;
        return JSON.stringify({
          total: list.length,
          items: list.slice(0, 60).map((c) => ({ ...brief(c.item), reason: c.reason, confidence: c.confidence })),
        });
      },
    }),
    betaTool({
      name: 'subclass_options',
      description:
        'Supers, grenades, melees, class abilities, movement, aspects, and fragments available for one class and element, with short descriptions. Use before suggesting a build.',
      inputSchema: {
        type: 'object',
        properties: {
          class: { type: 'string', enum: ['Titan', 'Hunter', 'Warlock'] },
          element: { type: 'string', description: 'Arc, Solar, Void, Stasis, Strand, or Prismatic.' },
        },
        required: ['class', 'element'],
        additionalProperties: false,
      },
      run: async ({ class: cls, element }) => {
        onStatus(`Looking up ${element} ${cls} options`);
        const idx = ctx().subclass;
        if (!idx) return JSON.stringify({ error: 'Subclass data is still loading. Refresh the app and try again.' });
        const opts = idx.options.get(`${cls.toLowerCase()}.${element.toLowerCase()}`);
        if (!opts) return JSON.stringify({ error: `No ${element} ${cls} subclass found.` });
        const trim = (parts?: SubclassPart[]) => parts?.map((p) => ({ name: p.name, does: p.description?.slice(0, 160) }));
        return JSON.stringify(Object.fromEntries(Object.entries(opts).map(([slot, parts]) => [slot, trim(parts)])));
      },
    }),
  ];
}

/** A build as written by the model, before icons are attached. */
interface RawBuild {
  name?: string; class?: string; subclass?: string; tags?: string[]; summary?: string;
  super?: string; abilities?: Record<string, string>; aspects?: string[]; fragments?: string[];
  weapons?: { id: string; note?: string }[]; armor?: { id: string; note?: string }[];
  statPriority?: string[]; mods?: string[]; howToPlay?: string;
}

/**
 * Attaches icons and descriptions to every ```build block and drops item ids the player
 * doesn't own, so the card never shows something that isn't real.
 */
export function enrichBuilds(text: string, c: AgentContext): string {
  const owned = new Set(c.items.map((i) => i.instanceId));
  const statIcons = new Map(c.characters.flatMap((ch) => ch.stats ?? []).map((s) => [s.name.toLowerCase(), s.icon]));
  const part = (name?: string) => {
    if (!name) return undefined;
    const hit = c.subclass?.byName.get(name.toLowerCase());
    return hit ? { name: hit.name, icon: hit.icon, description: hit.description } : { name };
  };
  return text.replace(/```build\s*\n([\s\S]*?)```/g, (block, json: string) => {
    let b: RawBuild;
    try { b = JSON.parse(json); } catch { return block; } // leave malformed JSON for the client to show as-is
    const enriched = {
      ...b,
      super: part(b.super),
      abilities: Object.fromEntries(Object.entries(b.abilities ?? {}).map(([k, v]) => [k, part(v)])),
      aspects: (b.aspects ?? []).map(part),
      fragments: (b.fragments ?? []).map(part),
      weapons: (b.weapons ?? []).filter((w) => owned.has(w.id)),
      armor: (b.armor ?? []).filter((a) => owned.has(a.id)),
      statPriority: (b.statPriority ?? []).map((s) => ({ name: s, icon: statIcons.get(s.toLowerCase()) })),
    };
    return '```build\n' + JSON.stringify(enriched) + '\n```';
  });
}

/**
 * Runs the agent and reports progress through `emit`: a status line per tool call,
 * text as it's written, then the final text with build cards filled in.
 */
export async function streamAgent(
  client: Anthropic, ctx: () => AgentContext, history: ChatTurn[], emit: (e: AgentEvent) => void,
): Promise<string> {
  const runner = client.beta.messages.toolRunner({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    max_iterations: 10,
    output_config: { effort: 'medium' },
    // If a safety check declines, the API retries on a fallback model in the same call.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    tools: buildTools(ctx, (text) => emit({ type: 'status', text })),
    messages: history.map((t) => ({ role: t.role, content: t.content })),
    stream: true,
  });
  const parts: string[] = [];
  for await (const turn of runner) {
    let current = '';
    for await (const event of turn) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        // A new turn's text starts a new paragraph after the previous turn's text.
        const delta = current === '' && parts.length ? `\n\n${event.delta.text}` : event.delta.text;
        current += event.delta.text;
        emit({ type: 'text', delta });
      }
    }
    const message = await turn.finalMessage();
    if (message.stop_reason === 'refusal') return "I can't help with that one.";
    if (current.trim()) parts.push(current.trim());
  }
  const text = parts.join('\n\n').trim();
  return text ? enrichBuilds(text, ctx()) : "I couldn't put together an answer. Try asking another way.";
}
