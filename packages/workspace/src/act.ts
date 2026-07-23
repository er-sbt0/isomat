/**
 * act.ts — the co-edit act ontology (roadmap M1).
 *
 * This is the *one generalization* the redesign is built on. `conversation.ts`
 * modelled a lesson as an ordered log of three entry kinds — one privileged
 * `program`, later `fragment`s, and student `event`s — replayed into a played
 * timeline. A workspace keeps the ordered-log idea and drops the privilege: an
 * act is one authoring move by EITHER author, and `fold(log)` yields a
 * positioned set of live objects rather than a timeline.
 *
 * ## The `by` tag is the whole point, even with no M1 consumer
 *
 * Every act carries `by: Author`. Nothing in M1 reads it — the fold treats a
 * user's `author` and the copilot's `author` identically. It is on every act
 * anyway because it is the seam the symmetric log exists for: M2 wires the 4c
 * loop, and a copilot turn appends acts tagged `'copilot'` through the exact
 * same `commit` a user's drag goes through. Adding it now, unread, is cheaper
 * and more honest than retrofitting authorship onto a log that pretended every
 * act was the student's.
 *
 * ## Exactly three verbs — no speculative ontology
 *
 * `author`, `introduce`, `set-input`. `conversation.ts` said it best: "adding
 * event types ahead of a conversation that needs them is exactly the
 * speculative ontology this plan's method forbids." `move` / `retire` /
 * `replace` (the spatial verbs) and `edit-span` (the parser front door) are
 * M3/M4 and are deliberately absent — a `Position` type exists here only
 * because `introduce` genuinely needs one now.
 */

import type { Id } from '@isomat/core';

/**
 * Who authored an act. The symmetric-log seam: a user drags and introduces; a
 * copilot (M2) authors and probes. In M1 both fold identically.
 */
export type Author = 'user' | 'copilot';

/** A point on the canvas. `introduce` places one object; M4's `move` will relocate it. */
export interface Position {
  readonly x: number;
  readonly y: number;
}

/** Every act says who made it and on which conversational turn. */
interface Tagged {
  readonly by: Author;
  readonly turn: number;
}

/**
 * A gated JS fragment. This SUPERSEDES conversation.ts's `program` + `fragment`
 * split: a workspace has no privileged first program, so there is one verb for
 * "run authored code against the world." Folds by executing `js` in the
 * sandbox; reaches earlier acts' objects only through `M.byId`, exactly as a
 * conversation fragment did.
 */
export interface AuthorAct extends Tagged {
  readonly kind: 'author';
  /** The executable (a compiled/bundled fragment, or plain JS in a test). */
  readonly js: string;
  /** The author's source, for reading a log / a repair brief. Optional. */
  readonly source?: string;
}

/**
 * Create ONE new object at a canvas position.
 *
 * In M1 this is decoupled from the parser (M3): an `introduce` simply carries
 * JS that mints the object — exactly like an `author` act — PLUS an `at`
 * position and the explicit `id` its source stamps on the new object. The fold
 * executes the source, confirms the id materialized, and records `layout[id] =
 * at`. The LaTeX → source front door is M3; M1 proves the act + the layout
 * projection with hand-authored source.
 *
 * `id` is REQUIRED and must be the explicit, stable id the source mints (via
 * `M.parameter(…, { id })` / `M.derived(…, { id })`). That is the stable-id
 * policy: an introduced object keeps its id under re-fold and under an earlier
 * act being inserted, so a future `replace` (M4) cannot shift a positional id
 * out from under an `M.byId` reference.
 */
export interface IntroduceAct extends Tagged {
  readonly kind: 'introduce';
  readonly js: string;
  readonly source?: string;
  readonly at: Position;
  /** The explicit stable id the source mints for the new object. */
  readonly id: Id;
  /**
   * The parse context, present iff this act came from `introduceExpr` (M3). It
   * is what M4's `edit-span` re-parses and re-emits from; a hand-authored
   * `introduce` omits it and so cannot be edit-spanned (see `ExprMeta`).
   */
  readonly expr?: ExprMeta;
}

/**
 * A hand's set on an interaction-mutable object — unchanged in semantics from
 * conversation.ts's `SetInputEvent`. Folds by resolving `target` in the scene
 * as it now stands and calling its interaction-path setter. A target that is
 * not in the scene is a FAILURE, never a skip (see fold.ts).
 */
export interface SetInputAct extends Tagged {
  readonly kind: 'set-input';
  readonly target: Id;
  readonly value: number;
}

/**
 * Relocate an existing object to a new canvas position (M4). A pure-projection
 * verb: it runs no source, only overwrites `layout[target]`. The target must be
 * in the scene as it now stands — a `move` naming an absent object is a FAILURE,
 * never a skip, exactly as `set-input` is (see fold.ts).
 */
export interface MoveAct extends Tagged {
  readonly kind: 'move';
  readonly target: Id;
  readonly at: Position;
}

/**
 * Retire an existing object from the workspace (M4). A pure-projection verb: the
 * object stays live in `objects`/`graph` (so a later `M.byId` still resolves it
 * and dependents keep recomputing) — `retire` only adds its id to the workspace's
 * `retired` filter-projection, which the UI and the loop honor. The target must
 * be in the scene as it now stands; retiring an absent id is a FAILURE.
 */
export interface RetireAct extends Tagged {
  readonly kind: 'retire';
  readonly target: Id;
}

/**
 * The parse context an `introduceExpr` (M3, `@isomat/parse`) stamps on its act
 * so a later `edit-span` (M4) can re-emit the object from edited source. It is
 * PLAIN DATA — deliberately no `@isomat/parse` type, because `workspace` sits
 * UPSTREAM of `parse` on the DAG — carrying exactly the inputs `introduceExpr`
 * consumed, so re-running the emit against a spliced `text` reproduces the object
 * under the SAME `id`/`at`/`bindings`. Absent on a hand-authored `introduce`
 * (its `js` is not re-parseable), which therefore cannot be edit-spanned.
 */
export interface ExprMeta {
  /** The expression SOURCE (mathjs syntax, not display TeX) the emit parsed. */
  readonly text: string;
  readonly at: Position;
  readonly id: Id;
  readonly domain: readonly [number, number];
  readonly indepVar: string;
  readonly bindings: Readonly<Record<string, Id>>;
  readonly label?: string;
}

/**
 * Re-mint an object's source under its EXISTING id (M4) — the id-stability core.
 *
 * `replace` does NOT append a second declaration of `target`: a second mint of
 * the same explicit id collides with the single-assignment id registry
 * (`core/identity.ts`, by design). Instead the fold's resolve pass folds this
 * act's `js` in at `target`'s ORIGINAL defining position (fold.ts, "Option B —
 * fold-time substitution"), so `target` is minted exactly ONCE — with this js —
 * and every dependent (all necessarily authored after it) recomputes against the
 * new definition. The `js` MUST re-register `target` under its own id; a target
 * no earlier `introduce` defined, or a `js` that mints no such id, is a FAILURE.
 * `target` must be an object minted by an `introduce` act (the acts that carry a
 * statically-known defining id).
 */
export interface ReplaceAct extends Tagged {
  readonly kind: 'replace';
  readonly target: Id;
  readonly js: string;
  readonly source?: string;
}

/**
 * Edit ONE addressable span of a parsed expression (M4). A span is a top-level
 * additive term, role-named `term0`/`term1`/… exactly as `@isomat/parse`'s
 * `toFragments` splits it. `text` is the replacement in the SAME syntax
 * `parseExpr` consumes — mathjs SOURCE, not display TeX — hence `text`, not
 * `tex`. Like `replace`, this appends no declaration: the fold's resolve pass
 * splices `text` into the addressed term's source, re-parses the whole
 * expression, and folds the re-emitted js in at the target's original defining
 * position (id unchanged). Successive edit-spans on one target COMPOSE (each
 * edits the target's current resolved source). The target must be an `introduce`
 * carrying parse metadata (`introduceExpr`); a hand-authored or already-`replace`d
 * object has no re-parseable source and is a FAILURE.
 */
export interface EditSpanAct extends Tagged {
  readonly kind: 'edit-span';
  readonly target: Id;
  readonly role: string;
  readonly text: string;
}

export type WorkspaceAct =
  | AuthorAct
  | IntroduceAct
  | SetInputAct
  | MoveAct
  | RetireAct
  | ReplaceAct
  | EditSpanAct;

export type WorkspaceLog = readonly WorkspaceAct[];

/**
 * The acts that carry runnable `.js` the sandbox executes (as opposed to setting
 * a value or a pure projection). `replace` joins because it carries a `js` the
 * fold runs at its target's defining position; `edit-span` does NOT — it has no
 * `js`, the fold re-emits one from its `text` through `@isomat/parse`.
 */
export type ExecutableAct = AuthorAct | IntroduceAct | ReplaceAct;

export function isExecutable(act: WorkspaceAct): act is ExecutableAct {
  return act.kind === 'author' || act.kind === 'introduce' || act.kind === 'replace';
}
