/**
 * fold.ts — `fold(log) → Workspace` (roadmap M1, the pivot).
 *
 * `conversation.ts`'s `replayLog` walked a log into a *played timeline*; this
 * walks a log into a *positioned set of live math objects*. Same load-bearing
 * rule — order matters, replay from scratch reproduces the state, a missing
 * `set-input` target is a FAILURE not a skip — but the output is a projection,
 * not a scene you press play on.
 *
 * ## Pure, hook-driven, browser-free
 *
 * Exactly like `replayLog`: execution and scene resolution arrive as hooks, so
 * the fold logic is testable with no QuickJS. The node wiring that backs the
 * hooks with a real sandbox lives in `node.ts`; a stub backs them in unit
 * tests. `foldLog` itself never imports the host.
 *
 * ## The three verbs
 *
 *  - `author`  — run the fragment's `js` in the sandbox (`execute`).
 *  - `introduce` — run the source that mints the object, CONFIRM the declared
 *    stable id materialized, then record `layout[id] = at`.
 *  - `set-input` — resolve `target` in the scene as it now stands and call its
 *    interaction-path setter. A target the scene does not offer is a failure:
 *    quietly dropping it would make the folded workspace differ from the
 *    recorded one, which is exactly the property a foldable log protects.
 */

import type { CorrespondenceGraph, Handle, Id } from '@isomat/core';
import type { ExecutableAct, Position, WorkspaceAct, WorkspaceLog } from './act.js';

/**
 * The projection a folded log yields: the live objects the workspace offers,
 * where each introduced one sits, and the correspondence graph relating them.
 *
 * `objects` is the same manifest boundary `sceneIndex` draws for a lesson — an
 * object is reachable iff it was shown, and a retired one (M4) is absent — so a
 * later act's `M.byId` can name exactly what the workspace offers and nothing
 * else. `claims` / `retired` are deferred to M4 (see the note at the bottom):
 * M1 keeps the Workspace to the three projections the three verbs actually
 * populate.
 */
export interface Workspace {
  readonly objects: ReadonlyMap<Id, Handle>;
  readonly layout: ReadonlyMap<Id, Position>;
  readonly graph: CorrespondenceGraph;
}

/** What a `set-input` act needs of its target: the interaction-path setter. */
export interface Settable {
  setValueLive?(next: number): void;
  setValue?(next: number): void;
}

/**
 * The seams `foldLog` folds through. `execute` runs authored code in the
 * sandbox; `scene` reports the objects as they NOW stand (built per read, so an
 * act sees what earlier acts in the same fold created); `graph` is the
 * correspondence graph of that same world.
 */
export interface FoldHooks {
  readonly execute: (act: ExecutableAct) => void;
  readonly scene: () => ReadonlyMap<Id, Handle>;
  readonly graph: () => CorrespondenceGraph;
}

/** Which act broke the fold, and how — the position, not merely that one did. */
export interface FoldFailure {
  readonly index: number;
  readonly kind: WorkspaceAct['kind'];
  readonly message: string;
}

export type FoldOutcome =
  | { readonly ok: true; readonly workspace: Workspace }
  | { readonly ok: false; readonly failure: FoldFailure };

/**
 * Fold a log, in order, against a freshly built world (the caller's hooks own
 * the world). Returns the `Workspace` projection, or the first failure.
 */
export function foldLog(log: WorkspaceLog, hooks: FoldHooks): FoldOutcome {
  const layout = new Map<Id, Position>();

  for (let index = 0; index < log.length; index += 1) {
    const act = log[index]!;
    try {
      switch (act.kind) {
        case 'author':
          hooks.execute(act);
          break;
        case 'introduce': {
          hooks.execute(act);
          // The stable-id contract, checked: the source PROMISED to mint an
          // object with this id. If it did not, a later `M.byId(act.id)` would
          // fail somewhere unrelated — reject here, where the act is named.
          if (!hooks.scene().has(act.id)) {
            throw new Error(
              `introduce declares id "${act.id}", but its source minted no object with that id. ` +
                `An introduce act's source must stamp the declared id (M.parameter(…, { id }) / ` +
                `M.derived(…, { id })).`,
            );
          }
          layout.set(act.id, act.at);
          break;
        }
        case 'set-input':
          applySetInput(act.target, act.value, hooks.scene());
          break;
      }
    } catch (err) {
      return {
        ok: false,
        failure: { index, kind: act.kind, message: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  return {
    ok: true,
    workspace: { objects: hooks.scene(), layout, graph: hooks.graph() },
  };
}

/**
 * Apply one `set-input`, resolving the target in the scene as it now stands.
 * A missing or unsettable target throws — the caller turns that into a
 * `FoldFailure`. Lifted verbatim in spirit from conversation.ts's `applyEvent`,
 * including the rule and its reasoning.
 */
function applySetInput(target: Id, value: number, scene: ReadonlyMap<Id, Handle>): void {
  const found = scene.get(target) as (Handle & Settable) | undefined;
  if (!found) {
    throw new Error(
      `set-input names "${target}", which is not in the workspace at this point in the log. ` +
        `An act may only reference something that exists when it is folded.`,
    );
  }
  // `setValueLive` is the interaction path: same clamp policy, no timeline step.
  const apply = found.setValueLive ?? found.setValue;
  if (!apply) {
    throw new Error(
      `set-input names "${target}", which is not settable. Only exposed Parameters (and matrix ` +
        `cells) can receive one.`,
    );
  }
  apply.call(found, value);
}

/*
 * DEFERRED to M4, deliberately (kept out of the M1 Workspace):
 *  - `claims`   — evidence-typed propositions. Cheap to project (filter objects
 *                 by kind), but no M1 verb produces one the fold must track, and
 *                 the 4c loop (M2) is what will actually read them.
 *  - `retired`  — populated by the `retire` verb, which is M4. With no verb to
 *                 fill it, a `retired` projection would be a permanently empty
 *                 field pretending at an ontology that does not exist yet —
 *                 exactly the speculation the act set avoids.
 */
