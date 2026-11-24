import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { streamAgent, type ChatTurn } from '../api.ts';
import { Icon } from './Icon.tsx';
import { ChatMarkdown } from './ChatMarkdown.tsx';
import { ResizeHandle } from './ResizeHandle.tsx';

const STARTERS = [
  'What should I dismantle first?',
  'Which of my weapons are god rolls?',
  'Build me a Void Warlock setup from what I own.',
];

/** An assistant reply while it's being made: the steps taken so far and the text written so far. */
interface Pending {
  steps: string[];
  text: string;
}

// Stays mounted while collapsed (just hidden) so the conversation survives toggling.
export function AgentPanel({ enabled, open, ask, width, onWidth }: {
  enabled: boolean; open: boolean; width: number; onWidth: (w: number) => void;
  /** A question sent from elsewhere (e.g. an item panel); `id` changes on each new ask. */
  ask?: { id: number; text: string };
}) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  // Follow new output only while the reader is at the bottom; scrolling up or selecting text stops it.
  const follow = useRef(true);
  const busy = pending !== null;

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

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    const next: ChatTurn[] = [...turns, { role: 'user', content: question }];
    setTurns(next);
    setDraft('');
    setError('');
    setPending({ steps: [], text: '' });
    follow.current = true;
    let final = '';
    // Text arrives in many tiny chunks; collect them and render at most once per frame.
    let buffered = '';
    let frame = 0;
    const flush = () => {
      frame = 0;
      const delta = buffered;
      buffered = '';
      if (delta) setPending((p) => p && { ...p, text: p.text + delta });
    };
    try {
      await streamAgent(next, (e) => {
        if (e.type === 'status') setPending((p) => p && { ...p, steps: [...p.steps, e.text] });
        else if (e.type === 'text') {
          buffered += e.delta;
          if (!frame) frame = requestAnimationFrame(flush);
        } else if (e.type === 'done') final = e.text;
        else if (e.type === 'error') throw new Error(e.message);
      });
      if (final) setTurns([...next, { role: 'assistant', content: final }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (frame) cancelAnimationFrame(frame);
      setPending(null);
    }
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
        <strong>Ask Triumvirate</strong>
        {/* The top bar's chat button is the only open/close control; this one starts over. */}
        <button
          className="icon-button"
          onClick={() => { setTurns([]); setError(''); }}
          disabled={busy || turns.length === 0}
          aria-label="New chat"
          title="New chat"
        >
          <Icon name="newChat" />
        </button>
      </header>
      {/* Screen readers hear a short status, not every streamed word of the whole log. */}
      <p className="visually-hidden" role="status">
        {busy ? (pending.text ? 'Writing the answer' : pending.steps.at(-1) ?? 'Thinking') : ''}
      </p>
      <div className="agent__log" ref={logRef} onScroll={onLogScroll}>
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
function Working({ pending }: { pending: Pending }) {
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
function selectionInside(el: HTMLElement) {
  const sel = document.getSelection();
  return !!sel && !sel.isCollapsed && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer);
}
