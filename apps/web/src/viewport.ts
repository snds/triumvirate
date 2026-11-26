// iOS 26.1+ (and 27.2) Home Screen apps: WebKit bug 301994 leaves the web view short of the screen.
// The page's layout viewport stops about one status-bar height (62pt on a Pro Max) above the bottom
// edge, and the system paints a band below it that no DOM element can reach. env(safe-area-inset-bottom)
// still reports the home indicator, so bars pad for an indicator they no longer sit over.
// When the shortfall is measured, this marks <html data-viewport-short> and the CSS drops that padding,
// so the tab bar, sheets, and content sit as low as the web view allows.
// https://bugs.webkit.org/show_bug.cgi?id=301994

const MIN_SHORTFALL = 20; // px; anything smaller is rounding, not the bug

function measure() {
  const root = document.documentElement;
  // navigator.standalone is iOS-only, so Android installs (which legitimately exclude the nav bar) never match.
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (!standalone) { delete root.dataset.viewportShort; return; }
  // screen.width/height stay in portrait on iOS; pick the side that matches the current orientation.
  const portrait = window.innerHeight >= window.innerWidth;
  const screenHeight = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
  // clientHeight is the layout viewport: it ignores the on-screen keyboard, which only shrinks the visual viewport.
  const shortfall = screenHeight - root.clientHeight;
  if (shortfall >= MIN_SHORTFALL) root.dataset.viewportShort = String(Math.round(shortfall));
  else delete root.dataset.viewportShort;
}

export function watchViewport() {
  measure();
  window.addEventListener('resize', measure);
  window.addEventListener('orientationchange', measure);
  // iOS can settle the standalone viewport a beat after launch.
  window.addEventListener('pageshow', measure);
  setTimeout(measure, 500);
}
