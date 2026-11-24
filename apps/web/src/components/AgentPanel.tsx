import { useEffect, useRef, useState } from 'react';
import { askAgent, type ChatTurn } from '../api.ts';
import { Icon } from './Icon.tsx';

const STARTERS = [
  'What should I dismantle first?',
  'Which of my weapons are god rolls?',
  'Suggest a Solar build for my Warlock using what I own.',
];

// Stays mounted while collapsed (just hidden) so the conversation survives toggling.
export function AgentPanel({ enabled, open, onClose, ask }: {
  enabled: boolean; open: boolean; onClose: () => void;
  /** A question sent from elsewhere (e.g. an item panel); `id` changes on each new ask. */
  ask?: { id: number; text: string };
}) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, busy]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    const next: ChatTurn[] = [...turns, { role: 'user', content: question }];
    setTurns(next);
    setDraft('');
    setBusy(true);
    setError('');
    try {
      const reply = await askAgent(next);
      setTurns([...next, { role: 'assistant', content: reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
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
      <header className="agent__header">
        <strong>Ask Triumvirate</strong>
        <button className="icon-button" onClick={onClose} aria-label="Collapse chat" title="Collapse chat"><Icon name="panelClose" /></button>
      </header>
      <div className="agent__log">
        {!enabled && <p className="muted">Add ANTHROPIC_API_KEY to your .env file and restart to turn this on.</p>}
        {enabled && turns.length === 0 && (
          <div className="agent__starters">
            <p className="muted">Ask about your gear. Answers only use items you own.</p>
            {STARTERS.map((s) => (
              <button key={s} className="button" onClick={() => void send(s)}>{s}</button>
            ))}
          </div>
        )}
        {turns.map((t, n) => (
          <div key={n} className={`bubble bubble--${t.role}`}>{t.content}</div>
        ))}
        {busy && <div className="bubble bubble--assistant muted">Checking your vault…</div>}
        {error && <p className="error">{error}</p>}
        <div ref={endRef} />
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
