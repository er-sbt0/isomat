/**
 * node.ts — the sandboxed fold environment (the Node/test factory).
 *
 * `fold.ts` is pure and hook-driven; this file is the half that backs those
 * hooks with a real QuickJS world, exactly as `conversation.sandbox.test.ts`
 * and `tools.sandbox.test.ts` wire one. Kept separate (a `./node` subpath, like
 * `@isomat/host/node`) so the pure fold logic never drags the Node wasm loader
 * into a browser bundle.
 *
 * `state = fold(log)`: every `fold` call boots a BRAND-NEW world + scope + VM
 * and replays the whole log from scratch. That is what makes a workspace a
 * cassette — the same log folds to the same ids every time — and what makes a
 * disposable candidate fold (for `commit`) never touch a live one.
 */

import { createWorld } from '@isomat/core';
import type { CorrespondenceGraph, Handle, Id } from '@isomat/core';
import { createStage, sceneIndex } from '@isomat/render';
import { createNativeScope } from '@isomat/library';
import { QuickJSHost, isolate } from '@isomat/host';
import { newNodeContext } from '@isomat/host/node';
import type { ExecutableAct, WorkspaceLog } from './act.js';
import { foldLog } from './fold.js';
import type { FoldHooks, FoldOutcome } from './fold.js';
import type { TryFold } from './commit.js';

export interface FoldEnv {
  readonly hooks: FoldHooks;
  readonly dispose: () => void;
}

/**
 * A fresh, independent fold world: its own reactive world, program scope, and
 * QuickJS VM. The hooks execute authored acts in the sandbox (wrapped in
 * `isolate` so two acts declaring `const x` do not collide — the IIFE scoping
 * the real pipeline gets for free from esbuild) and resolve the scene through
 * the same `sceneIndex` boundary the manifest and `M.byId` use.
 *
 * `lintGate: false`: M1 hand-authors act source in tests; the gate is the
 * compile hook's job (M2), not the fold's.
 */
export async function createFoldEnv(): Promise<FoldEnv> {
  const world = createWorld();
  const stage = createStage(world);
  const scope = createNativeScope(world, stage);
  const ctx = await newNodeContext();
  const host = new QuickJSHost(ctx, { budget: { authorMs: 10_000 }, lintGate: false });
  host.defineScope(scope as unknown as Record<string, unknown>);

  const hooks: FoldHooks = {
    execute: (act: ExecutableAct) => host.run(isolate(act.js)),
    scene: (): ReadonlyMap<Id, Handle> => sceneIndex(stage),
    graph: (): CorrespondenceGraph => world.graph,
  };
  // NOTE: the returned Workspace keeps reading these handles after fold returns
  // (a derived's `.value` re-invokes a guest closure the bridge retains), so the
  // VM must stay alive as long as the workspace is read — do not dispose the env
  // whose workspace you still hold. `dispose` is for throwaway candidate folds.
  return { hooks, dispose: () => host.dispose() };
}

/**
 * Fold a log into a `Workspace` through a fresh sandbox. The headline entry
 * point: `fold(log): Promise<Workspace-or-failure>`.
 */
export async function fold(log: WorkspaceLog): Promise<FoldOutcome> {
  const env = await createFoldEnv();
  return foldLog(log, env.hooks);
}

/**
 * The disposable candidate fold `commit` wants: fold a candidate somewhere
 * throwaway and report only whether it stood. Adapts `fold` to `TryFold`.
 */
export const tryFold: TryFold = (candidate: WorkspaceLog) => fold(candidate);
