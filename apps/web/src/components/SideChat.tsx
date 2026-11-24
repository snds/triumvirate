import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AppraisedItem } from '@triumvirate/core/browser';
import { newChatId } from '../api.ts';
import { useAgentChat } from '../chat-session.ts';
import { ChatMarkdown } from './ChatMarkdown.tsx';
import { Icon } from './Icon.tsx';
import { Working, selectionInside } from './AgentPanel.tsx';

/**
 * A small chat beside the item dialog, about that item, so the item stays in view while you talk.
 * Each side-chat is its own conversation and is saved to Past chats like any other.
 */
export function SideChat({ item, enabled, onClose }: { item: AppraisedItem; enabled: boolean; onClose: () => void }) {
  const [chatId] = useState(newChatId);
  const follow = useRef(true);
  const { turns, pending, error, busy, send } = useAgentChat(chatId, () => { follow.current = true; });
  const [draft, setDraft] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const isWeapon = item.itemType === 3;
  const starters = useMemo(() => [
    `Is my ${item.name}${item.power ? ` (${item.power})` : ''} worth keeping, and what would I use it for?`,
    ...(isWeapon
      ? [`What's the god roll for ${item.name}, and how close is mine?`, `What pairs well with ${item.name} in a build?`]
      : [`Which builds is this ${item.name} best for?`]),
  ], [item.name, item.power, isWeapon]);

  // The agent finds gear by name, so a question that doesn't name the item gets it added.
  const ask = (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setDraft('');
    void send(q.toLowerCase().includes(item.name.toLowerCase()) ? q : `About my ${item.name}${item.power ? ` (${item.power})` : ''}: ${q}`);
  };

  const onLogScroll = () => {
    const el = logRef.current;
    if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };
  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el || !follow.current || selectionInside(el)) return;
    el.scrollTop = el.scrollHeight;
  }, [turns, pending]);

  return (
    <aside className="side-chat" aria-label={`Ask about ${item.name}`}>
      <header className="side-chat__header">
        <Icon name="chat" />
        <strong className="side-chat__title">Ask about {item.name}</strong>
        <button className="icon-button" onClick={onClose} aria-label="Close side chat" title="Close side chat">
          <Icon name="close" />
        </button>
      </header>
      <p className="visually-hidden" role="status">
        {pending ? (pending.text ? 'Writing the answer' : pending.steps.at(-1) ?? 'Thinking') : ''}
      </p>
      <div className="agent__log side-chat__log" ref={logRef} onScroll={onLogScroll}>
        {!enabled && <p className="muted">Add ANTHROPIC_API_KEY to your .env file and restart to turn this on.</p>}
        {enabled && turns.length === 0 && !busy && (
          <div className="agent__starters">
            <p className="muted">Ask anything about this item. Saved to Past chats.</p>
            {starters.map((s) => (
              <button key={s} className="button" onClick={() => ask(s)}>{s}</button>
            ))}
          </div>
        )}
        {turns.map((t, n) =>
          t.role === 'user'
            ? <div key={n} className="bubble bubble--user">{t.content}</div>
            : <div key={n} className="reply"><ChatMarkdown text={t.content} /></div>,
        )}
        {pending && <Working pending={pending} />}
        {error && <p className="error">{error}</p>}
      </div>
      <form className="agent__form" onSubmit={(e) => { e.preventDefault(); ask(draft); }}>
        <input
          ref={inputRef}
          className="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Ask about ${item.name}…`}
          disabled={!enabled}
          aria-label="Message"
        />
        <button className="button button--primary" disabled={!enabled || busy || !draft.trim()}>Send</button>
      </form>
    </aside>
  );
}
