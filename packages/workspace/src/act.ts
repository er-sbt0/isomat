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

export type WorkspaceAct = AuthorAct | IntroduceAct | SetInputAct | MoveAct | RetireAct;

export type WorkspaceLog = readonly WorkspaceAct[];

/** The acts that fold by running source in the sandbox (as opposed to setting a value). */
export type ExecutableAct = AuthorAct | IntroduceAct;

export function isExecutable(act: WorkspaceAct): act is ExecutableAct {
  return act.kind === 'author' || act.kind === 'introduce';
}
