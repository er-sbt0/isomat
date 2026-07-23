/**
 * main.tsx — the client-only entry point (Phase 2 decision #6).
 *
 * There is no server, no session, and no hydration: the whole workspace is
 * `fold(log)`, and the log lives in the page.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

const host = document.getElementById('root');
if (!host) throw new Error('no #root element');

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
