/**
 * commit.ts — the one-transaction rule, generalized to N verbs (roadmap M1).
 *
 * `conversation.ts`'s `commitEntry` is the direct ancestor: append an act, but
 * only if the resulting log still folds. `tryFold` is handed the CANDIDATE log
 * and folds it somewhere disposable — a fresh headless world. On rejection the
 * caller gets its previous log back, unchanged: nothing is half-applied,
 * because nothing was applied to the live workspace at all.
 *
 * The only generalization over the ancestor is that a candidate now folds to a
 * `Workspace` rather than replaying a timeline, and any of the three verbs may
 * be the one that breaks — the transaction does not care which. That the
 * throwing act leaves the prior log intact is the property, and it is the same
 * one, whether the act was a copilot's `author` or a user's `set-input`.
 */

import type { WorkspaceAct, WorkspaceLog } from './act.js';
import type { FoldOutcome } from './fold.js';

/** Fold a CANDIDATE log somewhere disposable. The transaction machinery as a hook. */
export type TryFold = (candidate: WorkspaceLog) => Promise<FoldOutcome> | FoldOutcome;

export type CommitResult =
  | { readonly ok: true; readonly log: WorkspaceLog }
  | { readonly ok: false; readonly log: WorkspaceLog; readonly errors: readonly string[] };

/**
 * Append an act, but only if the resulting log still folds. On rejection the
 * previous log is returned untouched and the error names the offending act's
 * position — the same shape `commitEntry` returns, so a caller (and, in M2, a
 * copilot tool result) reads a rejection identically.
 */
export async function commit(
  log: WorkspaceLog,
  act: WorkspaceAct,
  tryFold: TryFold,
): Promise<CommitResult> {
  const candidate = [...log, act];
  const outcome = await tryFold(candidate);
  if (outcome.ok) return { ok: true, log: candidate };
  return {
    ok: false,
    log,
    errors: [
      `the ${outcome.failure.kind} at position ${outcome.failure.index} broke the workspace: ` +
        outcome.failure.message,
    ],
  };
}

/**
 * Collapse consecutive `set-input` acts on the SAME target down to the last —
 * what a drag sweep actually meant. Lifted from conversation.ts's `coalesce`,
 * with its rule intact: ONLY consecutive ones merge, because an executable act
 * (author / introduce) landing between two sets may have been authored against
 * the first value, and merging across it would silently rewrite the world that
 * act was written for.
 */
export function coalesce(log: WorkspaceLog): WorkspaceLog {
  const out: WorkspaceAct[] = [];
  for (const act of log) {
    const prev = out[out.length - 1];
    if (act.kind === 'set-input' && prev?.kind === 'set-input' && prev.target === act.target) {
      out[out.length - 1] = act;
      continue;
    }
    out.push(act);
  }
  return out;
}
