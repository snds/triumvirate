// One conversation with the agent: its turns, the answer being streamed, and sending. Shared by
// the docked chat panel and the side-chats that open next to an item dialog.
import { useCallback, useRef, useState } from 'react';
import { saveChat, streamAgent, type ChatTurn } from './api.ts';

/** An assistant reply while it's being made: the steps taken so far and the text written so far. */
export interface Pending {
  steps: string[];
  text: string;
}

export function useAgentChat(chatId: string, onStart?: () => void) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState('');
  // Read through refs so `send` keeps one identity and always sees the latest turns.
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const chatRef = useRef(chatId);
  chatRef.current = chatId;
  const onStartRef = useRef(onStart);
  onStartRef.current = onStart;
  const busyRef = useRef(false);

  const send = useCallback(async (text: string) => {
    const question = text.trim();
    if (!question || busyRef.current) return;
    busyRef.current = true;
    const next: ChatTurn[] = [...turnsRef.current, { role: 'user', content: question }];
    setTurns(next);
    setError('');
    setPending({ steps: [], text: '' });
    onStartRef.current?.();
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
      if (final) {
        const done: ChatTurn[] = [...next, { role: 'assistant', content: final }];
        setTurns(done);
        // Saved after every answer, so it shows up in Past chats; a failed save shouldn't interrupt.
        saveChat(chatRef.current, done).catch(() => {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (frame) cancelAnimationFrame(frame);
      setPending(null);
      busyRef.current = false;
    }
  }, []);

  return { turns, setTurns, pending, error, setError, busy: pending !== null, send };
}
