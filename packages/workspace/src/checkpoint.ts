/**
 * checkpoint.ts — the compaction INTERFACE + the real N-acts trigger (M4 Stage D).
 *
 * The seam (roadmap M1) was an inert stub. M4 lands the real policy: when a log
 * grows past a threshold, fold its PREFIX into ONE synthesized `author` act that
 * reproduces the prefix's objects under their EXISTING `<base>@<n>` ids, so
 * replay stays `O(acts since the last checkpoint)` instead of `O(whole history)`
 * — and `fold(compacted)` is identical to `fold(original)` (the cassette
 * property, now under compaction).
 *
 * ## How the synthesized act reproduces the objects (the risky seam)
 *
 * A folded object's live value CANNOT be re-serialized to source — a `derive`/
 * `plot` is a guest closure, not a re-emittable expression. So the checkpoint
 * does NOT reconstruct from folded handles; it reuses the object's own SOURCE.
 * Concretely it replays the prefix's pass-2 execution as one act's `js`:
 *
 *  - `introduce` → its FINAL resolved `js` (from `resolveDefinitions`, so every
 *    `replace`/`edit-span` on that id is already collapsed in — Stage B's two-pass
 *    substitution), each step wrapped in its own scope (`isolate`).
 *  - `author`    → its `js` verbatim, isolated.
 *  - `set-input` → transcribed inline as `byId(<id>).setValueLive(<value>)`, IN
 *    LOG ORDER, so a later step that captures a param's live value at mint time
 *    sees exactly what it saw in the original fold (the interleaving is preserved,
 *    which a "declare-then-bake-final-values" scheme would break).
 *  - `replace` / `edit-span` → nothing (their effect is folded into the
 *    introduce's final `js`).
 *
 * Because the same objects construct in the same order, every id — explicit
 * `<base>@<n>` AND positional `<kind>#<n>` — is minted identically, so `M.byId`
 * still resolves post-checkpoint. The explicit ids are minted exactly ONCE (the
 * prefix's defining acts are REMOVED by compaction, so there is no second mint to
 * collide with the single-assignment registry — unlike Stage B, which had to keep
 * the original acts and therefore substitute in place).
 *
 * ## Layout + retired: the projection tail
 *
 * An `author` act carries no `layout`/`retired` projection (only `introduce`/
 * `move` set layout, only `retire` fills retired). So after the synthesized act
 * the checkpoint appends a BOUNDED tail — one `move` per folded layout entry (to
 * its FINAL position) and one `retire` per retired id — restoring both projections
 * exactly. The tail is `O(live objects)`, independent of prefix LENGTH, so the
 * `replace`/`edit-span`/re-drag churn still collapses away.
 *
 * ## Accepted limitation (documented, out of the determinism guarantee)
 *
 * A prefix-introduced object is FROZEN by compaction: it survives as source
 * inside the synthesized `author` act, not as an `introduce`, so a LATER
 * (post-checkpoint) `replace`/`edit-span` targeting it fails `resolvePass`'s
 * "no earlier introduce defined" check. In practice the checkpoint boundary is a
 * point past which pre-checkpoint objects are no longer span-edited; a caller that
 * needs an old object editable keeps it in the un-compacted suffix (`keepRecent`).
 */

import { isolate } from '@isomat/sandbox';
import type { Id } from '@isomat/core';
import type { AuthorAct, MoveAct, RetireAct, WorkspaceAct, WorkspaceLog } from './act.js';
import type { TryFold } from './commit.js';
import { resolveDefinitions } from './fold.js';
import type { Definition, SpanResolver } from './fold.js';

/**
 * A compaction strategy. `shouldCompact` decides whether a log has grown enough
 * to fold its prefix; `compact` performs it, using `tryFold` to fold the prefix
 * and synthesizing an id-preserving `author` act (plus a layout/retired tail).
 */
export interface CheckpointPolicy {
  shouldCompact(log: WorkspaceLog): boolean;
  compact(log: WorkspaceLog, tryFold: TryFold): Promise<WorkspaceLog>;
}

/** The opt-out: never compacts, returns the log untouched. */
export const noCheckpoint: CheckpointPolicy = {
  shouldCompact: () => false,
  compact: async (log) => log,
};

/** Tuning for {@link everyNActs}. */
export interface EveryNActsOptions {
  /**
   * The parse-layer span re-emit, threaded into `resolveDefinitions`. Required
   * only to compact a prefix that contains an `edit-span`; a `replace`-only or
   * plain log compacts without one. Wire `@isomat/parse`'s resolver here, the
   * same one the fold gets.
   */
  readonly resolveSpan?: SpanResolver;
  /**
   * How many of the most-recent acts to leave UN-compacted (the live suffix).
   * Default `0` — the whole log folds into the checkpoint. Keep a window when
   * recent objects must stay individually `replace`/`edit-span`-targetable.
   */
  readonly keepRecent?: number;
}

/**
 * The real policy: compact once a log reaches `n` acts. Deterministic and
 * threshold-injectable. `compact` folds the prefix into `[synthesized, ...tail,
 * ...suffix]`, where the tail restores layout/retired and `suffix` is the last
 * `keepRecent` acts (default none).
 *
 * `shouldCompact` measures TOTAL length: after a compaction the prefix is a
 * single act, so the count naturally becomes `1 + tail + sinceCheckpoint`, and
 * the next trigger fires `n` acts after the checkpoint — i.e. it is effectively
 * "n acts since the last checkpoint".
 */
export function everyNActs(n: number, opts: EveryNActsOptions = {}): CheckpointPolicy {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`everyNActs: n must be a positive integer, got ${n}`);
  }
  const keepRecent = Math.max(0, Math.trunc(opts.keepRecent ?? 0));

  return {
    shouldCompact: (log) => log.length >= n,

    compact: async (log, tryFold) => {
      const boundary = Math.max(0, log.length - keepRecent);
      // Nothing to gain collapsing 0 or 1 acts into 1 act.
      if (boundary <= 1) return log;

      const prefix = log.slice(0, boundary);
      const suffix = log.slice(boundary);

      // 1. Resolve the prefix's FINAL definitions — Stage B's two-pass collapse,
      //    reused: each introduced id's `js` with its replace/edit-span folded in.
      const resolved = resolveDefinitions(prefix, opts.resolveSpan);
      if (!resolved.ok) return log; // a prefix that will not resolve is left intact

      // 2. Fold the prefix authoritatively for its layout + retired projections
      //    (and to confirm it stands before we rewrite it).
      const outcome = await tryFold(prefix);
      if (!outcome.ok) return log;
      const { layout, retired } = outcome.workspace;

      // 3. ONE synthesized author act replaying the prefix's execution in order.
      const attribution = prefix[prefix.length - 1]!;
      const synthesized: AuthorAct = {
        kind: 'author',
        by: attribution.by,
        turn: attribution.turn,
        js: synthesizeJs(prefix, resolved.defs),
        source: `/* checkpoint: ${prefix.length} acts collapsed, ids preserved */`,
      };

      // 4. Bounded projection tail: restore what an author act cannot carry.
      const moves: MoveAct[] = [...layout].map(([target, at]) => ({
        kind: 'move',
        by: attribution.by,
        turn: attribution.turn,
        target,
        at,
      }));
      const retires: RetireAct[] = [...retired].map((target) => ({
        kind: 'retire',
        by: attribution.by,
        turn: attribution.turn,
        target,
      }));

      return [synthesized, ...moves, ...retires, ...suffix];
    },
  };
}

/**
 * Build the synthesized act's `js`: the prefix's executable steps concatenated in
 * LOG ORDER, each object-minting step isolated in its own scope and each
 * `set-input` transcribed to a live setter call. This is a faithful replay of the
 * fold's pass-2 execution, so the resulting scene (ids and values) is identical.
 */
function synthesizeJs(prefix: WorkspaceLog, defs: ReadonlyMap<Id, Definition>): string {
  const steps: string[] = [];
  for (const act of prefix) {
    switch (act.kind) {
      case 'author':
        steps.push(isolate(act.js));
        break;
      case 'introduce': {
        // The FINAL resolved js (== act.js unless a replace/edit-span superseded
        // it): the id is minted once, here, with its last definition.
        const def = defs.get(act.id);
        steps.push(isolate(def ? def.js : act.js));
        break;
      }
      case 'set-input':
        // The interaction path, transcribed. `setValueLive` clamps to the param's
        // range exactly as `applySetInput` did, so the value reproduces verbatim.
        steps.push(`byId(${JSON.stringify(act.target)}).setValueLive(${numberLiteral(act.value)});`);
        break;
      // 'replace' / 'edit-span' — folded into the target introduce's final js.
      // 'move' / 'retire' — pure projections, restored by the checkpoint tail.
    }
  }
  return steps.join('\n');
}

/** A JS numeric literal for a set-input value. `String` yields a valid literal for
 *  every finite number and the `NaN`/`Infinity`/`-Infinity` globals alike. */
function numberLiteral(value: number): string {
  return String(value);
}
