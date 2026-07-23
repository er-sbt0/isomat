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
import type { ExecutableAct, ExprMeta, Position, WorkspaceAct, WorkspaceLog } from './act.js';

/**
 * The edit-span re-emit, injected (M4). `workspace` sits UPSTREAM of
 * `@isomat/parse` on the DAG, so the fold cannot re-parse an expression itself.
 * The parse package supplies this: given an introduce's `ExprMeta` plus a span
 * edit, it splices the new term source into the addressed `role`, re-parses the
 * whole expression, and re-emits the object's `js` under the SAME id. Absent in
 * the pure-workspace fold — an `edit-span` folded without a resolver is a FAILURE.
 */
export type SpanResolver = (meta: ExprMeta, role: string, text: string) => ResolvedExpr;

/** What a `SpanResolver` returns: the re-emitted js, its source, and updated meta. */
export interface ResolvedExpr {
  readonly js: string;
  readonly source: string;
  readonly meta: ExprMeta;
}

/**
 * The projection a folded log yields: the live objects the workspace offers,
 * where each introduced one sits, and the correspondence graph relating them.
 *
 * `objects` is the same manifest boundary `sceneIndex` draws for a lesson — an
 * object is reachable iff it was shown. `retired` (M4's `retire` verb) is a
 * filter-projection *over* `objects`: a retired object stays live in `objects`
 * and `graph` (so a later `M.byId` still resolves it and dependents keep
 * recomputing) but is flagged as no longer offered — the UI and the loop honor
 * the flag. `claims` (evidence-typed propositions) remains deferred: no verb yet
 * produces one the fold must track (see the note at the bottom).
 */
export interface Workspace {
  readonly objects: ReadonlyMap<Id, Handle>;
  readonly layout: ReadonlyMap<Id, Position>;
  readonly graph: CorrespondenceGraph;
  readonly retired: ReadonlySet<Id>;
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
  /**
   * The M4 edit-span re-emit (parse-layer, injected). Present only in the
   * parse-enabled fold; a pure-workspace fold leaves it undefined and rejects
   * any `edit-span` act. See `SpanResolver`.
   */
  readonly resolveSpan?: SpanResolver;
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
 * The final resolved definition of one introduced id — the js the fold runs at
 * that id's defining position (pass 2), plus what a later `edit-span` needs to
 * edit further. Seeded by an `introduce`, then mutated by any `replace` /
 * `edit-span` targeting it (M4 Stage B).
 *
 * Exported for M4 Stage D: checkpoint compaction reuses the SAME resolve pass to
 * collapse a prefix's `replace`/`edit-span` churn into each introduced id's FINAL
 * `js` before synthesizing one id-preserving act (see `resolveDefinitions`).
 */
export interface Definition {
  js: string;
  source?: string;
  meta?: ExprMeta;
}

/**
 * Fold a log, in order, against a freshly built world (the caller's hooks own
 * the world). Returns the `Workspace` projection, or the first failure.
 *
 * ## Two passes — `replace` / `edit-span` supersede, never re-mint (M4, Option B)
 *
 * A second declaration of an already-minted explicit id collides with the
 * single-assignment id registry (`core/identity.ts`, by design), and the scene
 * is first-wins, so `replace` / `edit-span` CANNOT append a fresh declaration of
 * their target. Instead the fold resolves in two passes:
 *
 *  1. RESOLVE — walk the log building `id → Definition`. An `introduce`/`author`
 *     seeds a defining id; a `replace` overwrites its target's `js`; an
 *     `edit-span` re-parses and re-emits it (via the injected `resolveSpan`).
 *     Successive edits compose. A `replace`/`edit-span` whose target no earlier
 *     `introduce` defined is a FAILURE — so a defining act always precedes its
 *     superseders and the pass-2 run is order-valid.
 *  2. WALK — execute in order, but at each `introduce` run its FINAL resolved js
 *     (so the id is minted exactly once, with its last definition); a
 *     `replace`/`edit-span` is then a NO-OP (its effect folded in at pass 1).
 *
 * Result: the id is stable (minted once) and every dependent — all necessarily
 * authored AFTER it — binds to that single handle and recomputes against the
 * final definition. Last-write-wins keeps the fold deterministic. This is the
 * same collapse M4 Stage D's checkpoint compaction reuses.
 *
 * ## Documented limitations (M4 Stage B, accepted)
 *
 *  - Only `introduce` acts carry a statically-known defining id, so a
 *    `replace`/`edit-span` may only target an INTRODUCED object — not one an
 *    `author` act minted (whose id is unknown until execution and whose act may
 *    mint several objects, so substituting its source is unsafe).
 *  - A `replace`/`edit-span`'s resolved source runs at the target's ORIGINAL
 *    defining position, so it may reference only what existed there (the target's
 *    original dependency scope). Referencing a newer object surfaces as a
 *    FoldFailure (a `byId` miss), not silent misbehavior.
 *  - A `set-input` applied to a target BEFORE it is replaced is discarded — the
 *    replace's fresh definition supersedes it. In practice `set-input` targets
 *    params while `replace`/`edit-span` target formula objects, so they do not
 *    collide.
 */
export function foldLog(log: WorkspaceLog, hooks: FoldHooks): FoldOutcome {
  // ── Pass 1: resolve (supersede in place; never a second mint) ──
  const defs = new Map<Id, Definition>();
  const resolveFailure = resolvePass(log, hooks, defs);
  if (resolveFailure) return { ok: false, failure: resolveFailure };

  // ── Pass 2: walk & execute ──
  const layout = new Map<Id, Position>();
  const retired = new Set<Id>();

  for (let index = 0; index < log.length; index += 1) {
    const act = log[index]!;
    try {
      switch (act.kind) {
        case 'author':
          hooks.execute(act);
          break;
        case 'introduce': {
          // Run the FINAL resolved js (== act.js unless a replace/edit-span
          // superseded it): the object is minted ONCE, here, with its last
          // definition. `defs` was seeded for every introduce in pass 1.
          const def = defs.get(act.id);
          hooks.execute({ ...act, js: def ? def.js : act.js });
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
        case 'move':
          // A pure-projection move: the target must exist in the scene as it now
          // stands. An absent target is a FAILURE, not a skip — same rule the
          // `introduce` id-check and `set-input` enforce.
          if (!hooks.scene().has(act.target)) {
            throw new Error(
              `move names "${act.target}", which is not in the workspace at this point in the log. ` +
                `An act may only reference something that exists when it is folded.`,
            );
          }
          layout.set(act.target, act.at);
          break;
        case 'retire':
          // A pure-projection retire: flag an existing object as no longer
          // offered. It stays in `objects`/`graph`; only the `retired` set grows.
          if (!hooks.scene().has(act.target)) {
            throw new Error(
              `retire names "${act.target}", which is not in the workspace at this point in the log. ` +
                `An act may only reference something that exists when it is folded.`,
            );
          }
          retired.add(act.target);
          break;
        case 'replace':
        case 'edit-span':
          // No-op: its effect was folded into the target's defining `introduce`
          // in pass 1 (Option B — supersede in place, never a second mint).
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
    workspace: { objects: hooks.scene(), layout, graph: hooks.graph(), retired },
  };
}

/**
 * Pass 1: walk the log in order, resolving each introduced id to its FINAL
 * definition. `introduce` seeds a definition; `replace` overwrites its target's
 * js; `edit-span` re-parses and re-emits it through the injected `resolveSpan`.
 * A `replace`/`edit-span` targeting an id no earlier `introduce` defined — or an
 * `edit-span` on an object with no parse metadata, or without a resolver — is a
 * FoldFailure, at that act's position. `author`/`set-input`/`move`/`retire`
 * define nothing to resolve.
 */
function resolvePass(
  log: WorkspaceLog,
  hooks: { readonly resolveSpan?: SpanResolver },
  defs: Map<Id, Definition>,
): FoldFailure | null {
  for (let index = 0; index < log.length; index += 1) {
    const act = log[index]!;
    try {
      switch (act.kind) {
        case 'introduce':
          defs.set(act.id, { js: act.js, source: act.source, meta: act.expr });
          break;
        case 'replace': {
          const def = requireDef(defs, act.target, 'replace');
          def.js = act.js;
          if (act.source !== undefined) def.source = act.source;
          // Hand-provided js carries no re-parseable expression: a later
          // edit-span on this target now fails cleanly rather than misparsing.
          def.meta = undefined;
          break;
        }
        case 'edit-span': {
          const def = requireDef(defs, act.target, 'edit-span');
          if (!def.meta) {
            throw new Error(
              `edit-span names "${act.target}", which carries no parse metadata — only an object ` +
                `introduced from a parsed expression (introduceExpr) can be span-edited, and not one ` +
                `a plain replace has since redefined.`,
            );
          }
          if (!hooks.resolveSpan) {
            throw new Error(
              `edit-span requires the parse-enabled fold: no span resolver was provided. Fold through ` +
                `@isomat/parse's entry (which wires resolveSpan) to edit a parsed expression.`,
            );
          }
          const resolved = hooks.resolveSpan(def.meta, act.role, act.text);
          def.js = resolved.js;
          def.source = resolved.source;
          def.meta = resolved.meta;
          break;
        }
      }
    } catch (err) {
      return { index, kind: act.kind, message: err instanceof Error ? err.message : String(err) };
    }
  }
  return null;
}

/** The successful shape of `resolveDefinitions`: the final def per introduced id. */
export type ResolvedDefs =
  | { readonly ok: true; readonly defs: ReadonlyMap<Id, Definition> }
  | { readonly ok: false; readonly failure: FoldFailure };

/**
 * Run pass 1 (resolve) alone, exposing the `id → Definition` map — the checkpoint
 * seam (M4 Stage D). `foldLog` runs this internally then walks/executes; a
 * compaction only needs the RESOLVED definitions (each introduced id collapsed to
 * its FINAL `js`, with `replace`/`edit-span` folded in) to synthesize one
 * id-preserving act. `resolveSpan` is required only if the log carries an
 * `edit-span` (same rule as the fold); a `replace`-only or plain log resolves
 * without one.
 */
export function resolveDefinitions(log: WorkspaceLog, resolveSpan?: SpanResolver): ResolvedDefs {
  const defs = new Map<Id, Definition>();
  const failure = resolvePass(log, { resolveSpan }, defs);
  if (failure) return { ok: false, failure };
  return { ok: true, defs };
}

/** A `replace`/`edit-span` may only target an id an EARLIER `introduce` defined. */
function requireDef(defs: Map<Id, Definition>, target: Id, verb: string): Definition {
  const def = defs.get(target);
  if (!def) {
    throw new Error(
      `${verb} names "${target}", which no earlier introduce defined. A ${verb} may only re-mint an ` +
        `object an introduce act created before it in the log.`,
    );
  }
  return def;
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
 * STILL DEFERRED (kept out of the Workspace until a verb populates it):
 *  - `claims`   — evidence-typed propositions. Cheap to project (filter objects
 *                 by kind), but no verb yet produces one the fold must track, and
 *                 the 4c loop (M2) is what will actually read them.
 *
 * `retired` is now live (M4 Stage A): the `retire` verb fills it. It was held
 * back in M1 for exactly the reason `claims` still is — a field with no verb to
 * populate it is a permanently empty projection pretending at an ontology that
 * does not exist yet.
 */
