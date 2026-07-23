/**
 * @isomat/workspace — the co-edit workspace substrate (roadmap M1).
 *
 * The redesign's pivot: `fold(log)` stops producing a played timeline and
 * starts producing a *positioned set of live math objects* — a `Workspace` —
 * that a user and an LLM co-edit through an authorship-tagged act log. This is
 * the generalization of `@isomat/sandbox`'s `conversation.ts` (3 entry kinds,
 * timeline replay) into an N-verb, two-author log whose fold is a projection.
 *
 * M1 implements exactly three verbs — `author`, `introduce`, `set-input` — and
 * the machinery around them: the pure hook-driven `foldLog`, the one-
 * transaction `commit`, drag `coalesce`, the `SessionIds` stable-id allocator,
 * and an inert checkpoint-compaction seam. The QuickJS-backed `fold` lives at
 * the `./node` subpath.
 */

export type {
  Author,
  Position,
  AuthorAct,
  IntroduceAct,
  SetInputAct,
  WorkspaceAct,
  WorkspaceLog,
  ExecutableAct,
} from './act.js';
export { isExecutable } from './act.js';

export { foldLog } from './fold.js';
export type { Workspace, FoldHooks, FoldFailure, FoldOutcome, Settable } from './fold.js';

export { commit, coalesce } from './commit.js';
export type { CommitResult, TryFold } from './commit.js';

export { SessionIds } from './session.js';

export { noCheckpoint } from './checkpoint.js';
export type { CheckpointPolicy } from './checkpoint.js';
