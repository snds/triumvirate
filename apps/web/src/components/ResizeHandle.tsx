import { useRef, useState } from 'react';
import { clampChatWidth, CHAT_WIDTH } from '../prefs.ts';

/** Drag (or arrow keys) to resize the chat panel; width is measured from the window's right edge. */
export function ResizeHandle({ width, onWidth }: { width: number; onWidth: (w: number) => void }) {
  const [dragging, setDragging] = useState(false);
  const start = useRef({ x: 0, w: 0 });
  const setAppResizing = (on: boolean) => document.querySelector('.app')?.classList.toggle('is-resizing', on);
  return (
    <div
      className={`agent__resize${dragging ? ' is-dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize chat"
      aria-valuemin={CHAT_WIDTH.min}
      aria-valuemax={CHAT_WIDTH.max}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, w: width };
        setDragging(true);
        setAppResizing(true);
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        // Dragging left widens the panel.
        onWidth(clampChatWidth(start.current.w + (start.current.x - e.clientX)));
      }}
      onPointerUp={() => { setDragging(false); setAppResizing(false); }}
      onPointerCancel={() => { setDragging(false); setAppResizing(false); }}
      onDoubleClick={() => onWidth(clampChatWidth(CHAT_WIDTH.default))}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 16;
        if (e.key === 'ArrowLeft') onWidth(clampChatWidth(width + step));
        else if (e.key === 'ArrowRight') onWidth(clampChatWidth(width - step));
        else return;
        e.preventDefault();
      }}
    />
  );
}
