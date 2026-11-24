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
