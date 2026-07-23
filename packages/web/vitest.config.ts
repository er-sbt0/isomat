import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    // The components are DOM-bound, so this project (alone in the repo) runs
    // jsdom. Still the cheap tier — no browser on the critical path.
    environment: 'jsdom',
    // Each fold boots a fresh QuickJS context; give it the same headroom the
    // other sandbox-backed projects get.
    testTimeout: 30_000,
  },
});
