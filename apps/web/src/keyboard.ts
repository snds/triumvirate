// iOS Safari leaves fixed-position bars behind the on-screen keyboard. This measures how much of the
// layout viewport the keyboard covers and writes it to --keyboard-inset, so a bar can sit above it.
import { useEffect } from 'react';

export function useKeyboardInset(active: boolean) {
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    if (!active || !vv) { root.style.removeProperty('--keyboard-inset'); return; }
    const update = () => {
      const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty('--keyboard-inset', `${Math.round(covered)}px`);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.style.removeProperty('--keyboard-inset');
    };
  }, [active]);
}
