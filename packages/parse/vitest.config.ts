import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Each fold boots a fresh QuickJS wasm context; give it headroom.
    testTimeout: 30_000,
  },
});
