/**
 * session.ts — the log is the state; the workspace is `fold(log)`.
 *
 * W1 folded once and then poked the world in place. That is the interaction
 * path, and it is deliberately not co-edit: a poke leaves no trace in the log,
 * so it is not attributable, not undoable, and invisible to the copilot. W2
 * promotes real mutations into ACTS, which means the app's state is the log and
 * every committed change goes through `commit`'s one-transaction rule.
 *
 * Three things here are load-bearing:
 *
 * 1. THE TRANSACTION. `commit` folds the CANDIDATE somewhere disposable and
 *    returns the previous log untouched if it fails. Nothing is ever
 *    half-applied. A rejected act is a no-op plus an error string, not a
 *    corrupted workspace.
 *
 * 2. VM LIFETIME. Every fold boots a brand-new QuickJS context, and the folded
 *    `Workspace` keeps reading handles that live inside it — a derived's
 *    `.value` re-invokes a guest closure the bridge retains. So the VM must stay
 *    alive exactly as long as the workspace is displayed, and the PREVIOUS one
 *    must be disposed when a new fold supersedes it. Without that an
 *    interactive session leaks a wasm context per act. This is why the code
 *    below uses `createFoldEnv` + `foldLog` rather than the convenience `fold`,
 *    which never disposes anything.
 *
 * 3. COALESCE. A drag emits one act on release, but consecutive `set-input`s on
 *    the same target still collapse to the last — what the sweep actually meant.
 *    Coalescing AFTER the transaction is safe: it only merges consecutive
 *    same-target sets, and folding `[a=1, a=2]` and `[a=2]` reaches the same
 *    state, so the workspace we already folded still describes the stored log.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { coalesce, commit, foldLog } from '@isomat/workspace';
import type { FoldOutcome, Workspace, WorkspaceAct, WorkspaceLog } from '@isomat/workspace';
import { createFoldEnv } from '@isomat/workspace/browser';
import type { FoldEnv } from '@isomat/workspace/browser';

export interface SessionState {
  readonly log: WorkspaceLog;
  readonly workspace: Workspace;
  /** Wall-clock of the most recent fold, in ms. */
  readonly ms: number;
}

export interface Session {
  readonly state: SessionState | null;
  /** Non-null when the LAST attempted act was rejected. Cleared by the next success. */
  readonly error: string | null;
  readonly busy: boolean;
  /** Append an act under the one-transaction rule. Resolves true if it stood. */
  apply(act: WorkspaceAct): Promise<boolean>;
  /** Drop the last act and re-fold. Undo is log truncation — free, given `fold`. */
  undo(): Promise<void>;
  /** The next conversational turn number for a new act. */
  nextTurn(): number;
}

export function useSession(initialLog: WorkspaceLog): Session {
  const [state, setState] = useState<SessionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  /** The env whose VM backs the CURRENTLY displayed workspace. Never dispose it. */
  const envRef = useRef<FoldEnv | null>(null);

  /**
   * Fold a log in a fresh env, and on success adopt it — disposing whatever env
   * the previous workspace was living in. On failure the new env is disposed
   * immediately and the displayed workspace is left exactly as it was.
   */
  const foldAndAdopt = useCallback(async (log: WorkspaceLog): Promise<FoldOutcome> => {
    const started = performance.now();
    const env = await createFoldEnv();
    const outcome = foldLog(log, env.hooks);
    if (!outcome.ok) {
      env.dispose();
      return outcome;
    }
    envRef.current?.dispose();
    envRef.current = env;
    setState({ log, workspace: outcome.workspace, ms: Math.round(performance.now() - started) });
    return outcome;
  }, []);

  // The initial fold.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const outcome = await foldAndAdopt(initialLog);
      if (!alive) return;
      if (!outcome.ok) setError(`the initial log does not fold: ${outcome.failure.message}`);
      setBusy(false);
    })();
    return () => {
      alive = false;
    };
    // Runs once: the initial log is a fixture, not a prop that changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dispose the last live VM when the app goes away.
  useEffect(
    () => () => {
      envRef.current?.dispose();
      envRef.current = null;
    },
    [],
  );

  const apply = useCallback(
    async (act: WorkspaceAct): Promise<boolean> => {
      const current = state;
      if (!current) return false;
      setBusy(true);
      try {
        // `commit` owns the transaction; `foldAndAdopt` is the disposable fold it
        // is handed, which also keeps the successful workspace rather than
        // throwing it away and folding a second time.
        const result = await commit(current.log, act, foldAndAdopt);
        if (!result.ok) {
          setError(result.errors.join('; '));
          return false;
        }
        setError(null);
        // Safe after the fact — see the coalesce note in the header.
        const collapsed = coalesce(result.log);
        setState((s) => (s ? { ...s, log: collapsed } : s));
        return true;
      } finally {
        setBusy(false);
      }
    },
    [state, foldAndAdopt],
  );

  const undo = useCallback(async (): Promise<void> => {
    const current = state;
    if (!current || current.log.length === 0) return;
    setBusy(true);
    try {
      const outcome = await foldAndAdopt(current.log.slice(0, -1));
      setError(outcome.ok ? null : `undo failed: ${outcome.failure.message}`);
    } finally {
      setBusy(false);
    }
  }, [state, foldAndAdopt]);

  const nextTurn = useCallback(
    () => (state ? state.log.reduce((m, a) => Math.max(m, a.turn), 0) + 1 : 1),
    [state],
  );

  return { state, error, busy, apply, undo, nextTurn };
}
