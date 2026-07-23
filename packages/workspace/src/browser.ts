/**
 * browser.ts — the sandboxed fold environment, browser flavour.
 *
 * The mirror of `node.ts`: identical surface, identical semantics, one different
 * ingredient — `newBrowserContext` (the single-file wasm variant) instead of the
 * Node loader. Everything else comes from the shared `env.ts`.
 *
 * This subpath is what makes Phase 2's client-only decision (#6) real: the whole
 * fold — QuickJS included — runs in the page, so there is no server and no
 * session. Importing THIS file instead of `./node` is the entire difference.
 */

import { newBrowserContext } from '@isomat/sandbox/browser';
import type { WorkspaceLog } from './act.js';
import type { FoldOutcome, SpanResolver } from './fold.js';
import { createFoldEnvWith, foldWith } from './env.js';
import type { TryFold } from './commit.js';

export type { FoldEnv, NewContext, SandboxContext } from './env.js';

/** A fresh, independent fold world backed by an in-page QuickJS context. */
export const createFoldEnv = (resolveSpan?: SpanResolver) =>
  createFoldEnvWith(newBrowserContext, resolveSpan);

/** Fold a log into a `Workspace` through a fresh in-page sandbox. */
export const fold = (log: WorkspaceLog, resolveSpan?: SpanResolver): Promise<FoldOutcome> =>
  foldWith(newBrowserContext, log, resolveSpan);

/** The disposable candidate fold `commit` wants, in the browser. */
export const tryFold: TryFold = (candidate: WorkspaceLog) => fold(candidate);

/** A `TryFold` bound to a span resolver — the commit-time fold for `edit-span`. */
export const tryFoldWith =
  (resolveSpan: SpanResolver): TryFold =>
  (candidate) =>
    fold(candidate, resolveSpan);
