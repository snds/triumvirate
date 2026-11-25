import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'material-symbols/rounded.css'; // self-hosted icon font, no network needed
import './tokens.css';
import './app.css';
import { App } from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Only the built app registers the service worker; in dev it would cache Vite's live files.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
