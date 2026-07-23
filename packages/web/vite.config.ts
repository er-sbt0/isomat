/**
 * vite.config.ts — the client-only app build (Phase 2 decision #6).
 *
 * Two things here are load-bearing:
 *
 * 1. `optimizeDeps.exclude` — the workspace packages ship RAW TypeScript
 *    (`"main": "./src/index.ts"`), so they must be processed as source rather
 *    than pre-bundled as opaque dependencies. Without this, esbuild's dep
 *    scanner treats them as prebuilt CJS/ESM and the build fails on the .ts.
 *
 * 2. No wasm plugin, no `assetsInclude`, no COOP/COEP headers. The sandbox uses
 *    the SINGLE-FILE QuickJS variant (see `@isomat/sandbox/browser`), which
 *    embeds the wasm in the JS module. That is what lets this deploy as plain
 *    static files with no server and no special MIME configuration.
 */

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: [
      '@isomat/core',
      '@isomat/substrate',
      '@isomat/objects',
      '@isomat/sandbox',
      '@isomat/workspace',
    ],
  },
  server: { port: 5173 },
  build: { target: 'es2022' },
});
