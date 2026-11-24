import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { deleteChat, getChat, listChats, newChatId, type ChatSummary } from '../api.ts';
import { useAgentChat, type Pending } from '../chat-session.ts';
import { usePref } from '../prefs.ts';
import { timeAgo } from '../inventory.ts';
import { Icon } from './Icon.tsx';
import { ChatMarkdown } from './ChatMarkdown.tsx';
import { ResizeHandle } from './ResizeHandle.tsx';

const STARTERS = [
  'What should I dismantle first?',
  'Which of my weapons are god rolls?',
  'Build me a Void Warlock setup from what I own.',
];

// Stays mounted while collapsed (just hidden) so the conversation survives toggling.
export function AgentPanel({ enabled, open, ask, width, onWidth }: {
  enabled: boolean; open: boolean; width: number; onWidth: (w: number) => void;
  /** A question sent from elsewhere (e.g. an item panel); `id` changes on each new ask. */
  ask?: { id: number; text: string };
}) {
  const [draft, setDraft] = useState('');
  // The open conversation, remembered so a reload picks up where you left off.
  const [chatId, setChatId] = usePref<string>('chatId', newChatId());
  const { turns, setTurns, pending, error, setError, busy, send: sendTurn } = useAgentChat(chatId, () => { follow.current = true; });
  const [history, setHistory] = useState<ChatSummary[] | null>(null);
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !enabled) return;
    restored.current = true;
    getChat(chatId).then((c) => setTurns((t) => (t.length ? t : c.turns))).catch(() => { /* not saved yet */ });
  }, [chatId, enabled]);

  const startNew = () => { setTurns([]); setError(''); setChatId(newChatId()); setHistory(null); };
  const openHistory = async () => {
    setError('');
    try { setHistory(await listChats()); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };
  const openChat = async (id: string) => {
    try {
      const c = await getChat(id);
      setTurns(c.turns);
      setChatId(id);
      setHistory(null);
      setError('');
      follow.current = true;
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };
  const removeChat = async (id: string) => {
    await deleteChat(id);
    setHistory((h) => h && h.filter((c) => c.id !== id));
    if (id === chatId) { setTurns([]); setChatId(newChatId()); }
  };
  const logRef = useRef<HTMLDivElement>(null);
  // Follow new output only while the reader is at the bottom; scrolling up or selecting text stops it.
  const follow = useRef(true);

  const onLogScroll = () => {
    const el = logRef.current;
    if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  // Instant (not smooth) scroll after layout. A smooth scroll restarted on every streamed chunk,
  // fighting an active text selection, is what froze the page.
  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el || !follow.current || selectionInside(el)) return;
    el.scrollTop = el.scrollHeight;
  }, [turns, pending]);

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    setDraft('');
    return sendTurn(text);
  };

  // Send questions handed in from outside once each.
  const lastAsk = useRef(0);
  useEffect(() => {
    if (!ask || ask.id === lastAsk.current || !enabled) return;
    lastAsk.current = ask.id;
    void send(ask.text);
  });

  return (
    <aside className="agent" aria-label="Ask Triumvirate" hidden={!open}>
      <ResizeHandle width={width} onWidth={onWidth} />
      <header className="agent__header">
        {history ? (
          <button className="icon-button" onClick={() => setHistory(null)} aria-label="Back to chat" title="Back to chat">
            <Icon name="back" />
          </button>
        ) : null}
        <strong className="agent__title">{history ? 'Past chats' : 'Ask Triumvirate'}</strong>
        {/* The top bar's chat button is the only open/close control; these manage conversations. */}
        <span className="agent__tools">
          <button
            className={`icon-button${history ? ' is-selected' : ''}`}
            onClick={() => (history ? setHistory(null) : void openHistory())}
            disabled={busy || !enabled}
            aria-pressed={!!history}
            aria-label="Past chats"
            title="Past chats"
          >
            <Icon name="history" />
          </button>
          <button
            className="icon-button"
            onClick={startNew}
            disabled={busy || (turns.length === 0 && !history)}
            aria-label="New chat"
            title="New chat"
          >
            <Icon name="newChat" />
          </button>
        </span>
      </header>
      {/* Screen readers hear a short status, not every streamed word of the whole log. */}
      <p className="visually-hidden" role="status">
        {pending ? (pending.text ? 'Writing the answer' : pending.steps.at(-1) ?? 'Thinking') : ''}
      </p>
      {history && (
        <div className="agent__history">
          {history.length === 0 && <p className="muted">No saved chats yet. Each chat is saved after every answer.</p>}
          <ul className="chat-list">
            {history.map((c) => (
              <li key={c.id} className={`chat-list__item${c.id === chatId ? ' is-current' : ''}`}>
                <button className="chat-list__open" onClick={() => void openChat(c.id)}>
                  <span className="chat-list__title">{c.title}</span>
                  <span className="chat-list__meta">{timeAgo(c.updatedAt)} · {Math.ceil(c.turnCount / 2)} {c.turnCount > 2 ? 'questions' : 'question'}</span>
                </button>
                <button className="icon-button" onClick={() => void removeChat(c.id)} aria-label={`Delete "${c.title}"`} title="Delete">
                  <Icon name="delete" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="agent__log" ref={logRef} onScroll={onLogScroll} hidden={!!history}>
        {!enabled && <p className="muted">Add ANTHROPIC_API_KEY to your .env file and restart to turn this on.</p>}
        {enabled && turns.length === 0 && !busy && (
          <div className="agent__starters">
            <p className="muted">Ask about your gear. Answers only use items you own.</p>
            {STARTERS.map((s) => (
              <button key={s} className="button" onClick={() => void send(s)}>{s}</button>
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
      <form
        className="agent__form"
        onSubmit={(e) => { e.preventDefault(); void send(draft); }}
      >
        <input
          className="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask about your vault…"
          disabled={!enabled}
          aria-label="Message"
        />
        <button className="button button--primary" disabled={!enabled || busy || !draft.trim()}>Send</button>
      </form>
    </aside>
  );
}

/** The in-progress state: each step as it happens, then the answer as it streams in. */
export function Working({ pending }: { pending: Pending }) {
  const writing = pending.text.length > 0;
  return (
    <div className="reply reply--pending">
      <ol className="steps">
        {pending.steps.map((s, n) => {
          const current = !writing && n === pending.steps.length - 1;
          return (
            <li key={n} className={`step${current ? ' is-current' : ''}`}>
              {current ? <span className="spinner" /> : <Icon name="check" className="step__done" />}
              {s}
            </li>
          );
        })}
        {pending.steps.length === 0 && !writing && (
          <li className="step is-current"><span className="spinner" />Thinking</li>
        )}
      </ol>
      {writing && <ChatMarkdown text={pending.text} />}
    </div>
  );
}

/** True when the reader has text selected inside `el`, so new output shouldn't move it. */
export function selectionInside(el: HTMLElement) {
  const sel = document.getSelection();
  return !!sel && !sel.isCollapsed && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer);
}
