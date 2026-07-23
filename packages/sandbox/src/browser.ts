/**
 * browser.ts — the browser factory. The mirror of `node.ts`, same contract: a
 * `QuickJSContext` ready for `new QuickJSHost(ctx, ...)`.
 *
 * This is the file `index.ts` and `host.ts` have always pointed at ("the browser
 * builds one from the single-file wasm variant") and that never existed, because
 * Phase 1 was headless. Phase 2 needs it.
 *
 * SINGLE-FILE is the deliberate choice: the wasm is embedded in the ES module, so
 * a bundler ships it as ordinary JavaScript. There is no `.wasm` asset to copy,
 * serve, or MIME-type, and no fetch at boot that could fail on a static host —
 * which is what makes the client-only deploy (Phase 2 decision #6) trivial.
 *
 * Kept out of the barrel for exactly the reason `node.ts` is: neither runtime's
 * loader should ever reach the other's bundle.
 *
 * The wasm MODULE is compiled once and memoized; a CONTEXT is minted per call.
 * That split matters — `fold` boots a brand-new context on every call by design
 * (the cassette property), and paying a fresh wasm compile for each would make
 * every keystroke-driven re-fold cost hundreds of milliseconds.
 */

import variant from '@jitl/quickjs-singlefile-browser-release-sync';
import { memoizePromiseFactory, newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core';
import type { QuickJSContext } from 'quickjs-emscripten-core';

/** Compile the embedded wasm once per page, not once per fold. */
const loadModule = memoizePromiseFactory(() => newQuickJSWASMModuleFromVariant(variant));

/** A fresh sandbox context, ready for `new QuickJSHost(ctx, ...)`. */
export async function newBrowserContext(): Promise<QuickJSContext> {
  const QuickJS = await loadModule();
  return QuickJS.newContext();
}
