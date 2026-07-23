/**
 * env.ts — the sandboxed fold environment, parameterised on its context factory.
 *
 * `fold.ts` is pure and hook-driven; this file is the half that backs those hooks
 * with a real QuickJS world. It was `node.ts`'s body until Phase 2 needed the same
 * wiring in a browser: the world/stage/scope/host assembly is runtime-agnostic, and
 * the ONLY runtime-specific part is which factory mints the `QuickJSContext`. So
 * that one line is now an argument, and `node.ts` / `browser.ts` are five-line
 * adapters that supply it.
 *
 * This keeps the property those two files exist to protect: the pure fold logic
 * never drags a wasm loader into a bundle that shouldn't have it. `env.ts` imports
 * NEITHER loader — it only names the shape they both satisfy.
 *
 * `state = fold(log)`: every `fold` call boots a BRAND-NEW world + scope + VM and
 * replays the whole log from scratch. That is what makes a workspace a cassette —
 * the same log folds to the same ids every time — and what makes a disposable
 * candidate fold (for `commit`) never touch a live one.
 */

import { createWorld } from '@isomat/core';
import type { CorrespondenceGraph, Handle, Id } from '@isomat/core';
import { createStage, sceneIndex } from '@isomat/objects';
import { createNativeScope } from '@isomat/objects';
import { QuickJSHost, isolate } from '@isomat/sandbox';
import type { ExecutableAct, WorkspaceLog } from './act.js';
import { foldLog } from './fold.js';
import type { FoldHooks, FoldOutcome, SpanResolver } from './fold.js';

/**
 * Whatever `QuickJSHost` accepts as its context. Derived from the constructor
 * rather than imported from `quickjs-emscripten-core` on purpose: `workspace`
 * depends on `@isomat/sandbox`, not on the wasm library directly, and this keeps
 * it that way.
 */
export type SandboxContext = ConstructorParameters<typeof QuickJSHost>[0];

/** The one runtime-specific seam: `newNodeContext` or `newBrowserContext`. */
export type NewContext = () => Promise<SandboxContext>;

export interface FoldEnv {
  readonly hooks: FoldHooks;
  readonly dispose: () => void;
}

/**
 * A fresh, independent fold world: its own reactive world, program scope, and
 * QuickJS VM. The hooks execute authored acts in the sandbox (wrapped in
 * `isolate` so two acts declaring `const x` do not collide — the IIFE scoping the
 * real pipeline gets for free from esbuild) and resolve the scene through the same
 * `sceneIndex` boundary the manifest and `byId` use.
 *
 * `lintGate: false`: act source is hand-authored in tests; the gate is the compile
 * hook's job (M2), not the fold's.
 */
export async function createFoldEnvWith(
  newContext: NewContext,
  resolveSpan?: SpanResolver,
): Promise<FoldEnv> {
  const world = createWorld();
  const stage = createStage(world);
  const scope = createNativeScope(world, stage);
  const ctx = await newContext();
  const host = new QuickJSHost(ctx, { budget: { authorMs: 10_000 }, lintGate: false });
  host.defineScope(scope as unknown as Record<string, unknown>);

  const hooks: FoldHooks = {
    execute: (act: ExecutableAct) => host.run(isolate(act.js)),
    scene: (): ReadonlyMap<Id, Handle> => sceneIndex(stage),
    graph: (): CorrespondenceGraph => world.graph,
    // The edit-span re-emit is a parse-layer capability (M4). `workspace` is
    // upstream of `@isomat/parse`, so it is injected by the caller; the pure
    // workspace fold leaves it undefined and rejects edit-span acts.
    ...(resolveSpan ? { resolveSpan } : {}),
  };
  // NOTE: the returned Workspace keeps reading these handles after fold returns
  // (a derived's `.value` re-invokes a guest closure the bridge retains), so the
  // VM must stay alive as long as the workspace is read — do not dispose the env
  // whose workspace you still hold. `dispose` is for throwaway candidate folds.
  return { hooks, dispose: () => host.dispose() };
}

/** Fold a log into a `Workspace` through a fresh sandbox built by `newContext`. */
export async function foldWith(
  newContext: NewContext,
  log: WorkspaceLog,
  resolveSpan?: SpanResolver,
): Promise<FoldOutcome> {
  const env = await createFoldEnvWith(newContext, resolveSpan);
  return foldLog(log, env.hooks);
}
