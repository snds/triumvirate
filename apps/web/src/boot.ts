// The app loader in index.html: it paints before this code arrives and keeps animating until the
// first load settles. Then the V completes, the mark shrinks away, and the app rises in behind it.

/** True while the index.html loader is still on screen (the app's first load hasn't settled yet). */
export const bootShowing = () => !!document.getElementById('boot')?.isConnected;

/** Completes the V, then plays the exit and removes the loader. Safe to call more than once. */
export function dismissBoot() {
  const el = document.getElementById('boot');
  if (!el || el.dataset.leaving) return;
  el.dataset.leaving = '1';
  el.classList.add('is-resolved');
  const remove = () => el.remove();
  setTimeout(() => {
    el.classList.add('is-leaving');
    el.addEventListener('animationend', remove, { once: true });
    setTimeout(remove, 600); // in case animations are off and animationend never fires
  }, 120);
}
