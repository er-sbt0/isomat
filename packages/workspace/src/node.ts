/**
 * node.ts — the sandboxed fold environment, Node/test flavour.
 *
 * The wiring itself lives in `env.ts` (runtime-agnostic); this file supplies the
 * one runtime-specific ingredient — the Node wasm loader — and re-exports the
 * public surface unchanged. `browser.ts` is its mirror. Kept a separate subpath
 * (like `@isomat/sandbox/node`) so the pure fold logic never drags the Node wasm
 * loader into a browser bundle.
 */

import { newNodeContext } from '@isomat/sandbox/node';
import type { WorkspaceLog } from './act.js';
import type { FoldOutcome, SpanResolver } from './fold.js';
import { createFoldEnvWith, foldWith } from './env.js';
import type { TryFold } from './commit.js';

export type { FoldEnv, NewContext, SandboxContext } from './env.js';

/** A fresh, independent fold world backed by a Node QuickJS context. */
export const createFoldEnv = (resolveSpan?: SpanResolver) =>
  createFoldEnvWith(newNodeContext, resolveSpan);

/**
 * Fold a log into a `Workspace` through a fresh sandbox. The headline entry
 * point: `fold(log): Promise<Workspace-or-failure>`.
 */
export const fold = (log: WorkspaceLog, resolveSpan?: SpanResolver): Promise<FoldOutcome> =>
  foldWith(newNodeContext, log, resolveSpan);

/**
 * The disposable candidate fold `commit` wants: fold a candidate somewhere
 * throwaway and report only whether it stood. Adapts `fold` to `TryFold`.
 */
export const tryFold: TryFold = (candidate: WorkspaceLog) => fold(candidate);

/**
 * A `TryFold` bound to a span resolver — the commit-time candidate fold for a log
 * containing `edit-span` acts (M4). The pure `tryFold` above cannot resolve an
 * edit-span; the parse package builds one of these with its resolver.
 */
export const tryFoldWith =
  (resolveSpan: SpanResolver): TryFold =>
  (candidate) =>
    fold(candidate, resolveSpan);
