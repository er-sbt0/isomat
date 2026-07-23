/**
 * checkpoint.ts — the compaction INTERFACE + a no-op stub (roadmap M1).
 *
 * The real trigger lands in M4: fold the log's prefix into a synthesized
 * `author` act with the ids preserved, so replay stays `O(acts since the last
 * checkpoint)` instead of `O(whole history)`. M1 owes only the seam — the type
 * a future policy implements — and a stub that never fires, so the fold path
 * already speaks to a `CheckpointPolicy` and M4 swaps the implementation
 * without touching callers.
 *
 * Deliberately inert. Wiring a real "every N acts / byte budget" trigger now,
 * with no large log to compact and the trigger policy still an open decision
 * (roadmap "Open decisions"), would be guessing at a shape M4 gets to decide
 * against real data.
 */

import type { WorkspaceLog } from './act.js';
import type { TryFold } from './commit.js';

/**
 * A compaction strategy. `shouldCompact` decides whether a log has grown enough
 * to fold its prefix; `compact` performs it, using `tryFold` to fold the prefix
 * and (in M4) synthesizing an id-preserving `author` act for it.
 */
export interface CheckpointPolicy {
  shouldCompact(log: WorkspaceLog): boolean;
  compact(log: WorkspaceLog, tryFold: TryFold): Promise<WorkspaceLog>;
}

/** The M1 stub: never compacts, returns the log untouched. */
export const noCheckpoint: CheckpointPolicy = {
  shouldCompact: () => false,
  compact: async (log) => log,
};
