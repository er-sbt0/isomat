# M4 — Spatial verbs + selective manifest (file-level plan)

> Status: **planning (2026-07-23).** Roadmap milestone M4. Executed by subagents,
> one stage per commit, each ending green in the cheap tier (`./run.sh test` +
> `./run.sh typecheck`). All paths absolute-from-repo-root. Grounded in the M4
> discovery pass — seams verified against the M3 tree (HEAD `e58b494`, 363 tests).

## What M4 adds
1. Spatial acts `move` / `retire` / `replace` folded into `layout` / `retired`.
2. `edit-span` — re-parse one addressable span's tex, id stable (carried from M3;
   same id-stability-under-mutation core as `replace`, solved together).
3. Checkpoint-compaction **real trigger** (replaces the M1 no-op stub). Policy:
   **N acts** (deterministic, threshold injectable; byte-budget can layer later).
4. `scopedManifest(workspace, focus, byteBudget)` — bounded BFS over the
   correspondence graph, nearest-first fill (the `sceneBrief` unbounded precursor).

## Hard constraints (do not violate)
- **The fence.** `packages/workspace/src/import-boundary.test.ts` forbids any
  main-path source importing `@isomat/cell`, a playback basename (`timeline`,
  `player`, `lesson`, `morph`, **`manifest`**, `segments`, `animate`, `supersede`,
  `pacing`, `events`), or a shed discipline. **`retire`/`replace` already exist as
  timeline verbs in the quarantined `cell/` package — DO NOT import them.** M4's
  acts are a fresh implementation on the fold path. The scoped-manifest function
  lives in `brief.ts` (a file named `manifest.ts` on the copilot/workspace path
  fails the fence).
- **No CAS.** `packages/parse/src/fence.test.ts` — only `mathjs.ts` imports mathjs,
  and only `parse`. `edit-span` re-parse routes solely through `parseExpr`/`ast.ts`.
- **The cassette property.** Re-fold yields identical ids. `replace`/`edit-span`
  must keep the object's id stable under mutation — the M4 watch.

---

## Stage A — spatial acts `move` / `retire` (`workspace`)
Pure-projection verbs; no sandbox re-run.

- `packages/workspace/src/act.ts`
  - Extend the union at line 103: `| MoveAct | RetireAct`.
  - `MoveAct { readonly kind: 'move'; readonly target: Id; readonly at: Position }`
    (`Position` already exists, act.ts:40).
  - `RetireAct { readonly kind: 'retire'; readonly target: Id }`.
  - Both extend `Tagged` (`by`/`turn`). Neither joins `ExecutableAct` (they touch
    projections only, run no source).
- `packages/workspace/src/fold.ts`
  - Add `retired: ReadonlySet<Id>` to the `Workspace` type (lines 42-46) — closes
    the M1-deferred field.
  - In `foldLog`, add a `const retired = new Set<Id>()` accumulator beside the
    `layout` map (line 82).
  - Add switch cases (lines 87-109):
    - `move` → validate `act.target` is in `hooks.scene()` (mirror the introduce
      id-check at 96-102), then `layout.set(act.target, act.at)`.
    - `retire` → validate target present, then `retired.add(act.target)`. (Objects
      stay in `objects`/`graph`; `retired` is a filter-projection the UI/loop honors.)
  - Add `retired` to the returned `Workspace` literal (line 120).
- Barrel `packages/workspace/src/index.ts:19-28` — export the two new act types.
- Tests: extend `fold.sandbox.test.ts` (real QuickJS) + `fold.test.ts` (rules) —
  a move relocates `layout[target]`; a retire adds to `retired` and leaves objects
  intact; move/retire on an unknown id → `FoldFailure` with the prior log intact.
- **Exit:** green typecheck + test; `retired` field live on `Workspace`.

## Stage B — `replace` + `edit-span` (`workspace` + `parse`) — id-stability core
Re-mint an object's source under its **existing id**.

- `packages/workspace/src/act.ts`
  - `ReplaceAct { readonly kind: 'replace'; readonly target: Id; readonly js: string;
    readonly source?: string }` — re-runs source that re-declares `target` under its
    own id. Joins `ExecutableAct` + `isExecutable()` (act.ts:108-112).
  - `EditSpanAct { readonly kind: 'edit-span'; readonly target: Id; readonly role:
    string; readonly tex: string }` — edit one addressable span. Joins `ExecutableAct`.
- `packages/workspace/src/fold.ts`
  - `replace` case: `hooks.execute(act.js)` (like an introduce/author), asserting the
    object re-registers under `act.target` (id unchanged). Atomic via the existing
    one-transaction commit path — reject → prior log intact.
  - `edit-span` case: resolve `target`'s current parsed form, splice the new `tex`
    into the addressed `role` fragment, re-run the `introduceExpr` pipeline reusing
    the same `id`/`at`/`bindings`, execute the emitted JS.
- `packages/parse/src/introduce.ts` (reuse, ~46-94) + `ast.ts` (`toFragments`
  154-166, `toJs` 176-224). `source` already carries raw text (introduce.ts:86-88)
  — that is the string `edit-span` re-parses. Add a helper
  `editSpan(parsed, role, tex) → EditSpanAct` (or fold builds the act from the
  existing `ParsedExpr` + role). Stays inside the no-CAS fence (parse-only path).
- Tests: extend the cassette-property test `fold.sandbox.test.ts:143-176` — assert
  the object's id is **unchanged** after a `replace` and after an `edit-span`, and
  that dependents recompute. `replace` atomicity: a throwing replace leaves the
  prior log + live scene intact. Companion at `parse/src/introduce.sandbox.test.ts`.
- **Exit:** green; id stable under `replace`/`edit-span`; replace atomic.

## Stage C — `scopedManifest` (`copilot`)
Bounded BFS; same output shape as `sceneBrief`.

- `packages/copilot/src/brief.ts` — add `scopedManifest(workspace, focus, byteBudget)`
  beside `sceneBrief`. **Keep the file named `brief.ts`** (fence). Reuse the
  per-object line builder (`summarize` + the `- ${id} (${kind})…` shape, brief.ts:51).
  - BFS from `focus` over `workspace.graph.neighbors(h)` (core/correspondence.ts:83),
    nearest-first (frontier queue), appending each object's line while the running
    byte total stays under `byteBudget`; stop when the budget would be exceeded.
    Far (unreached / over-budget) objects excluded. Deterministic ordering
    (id-sorted within a BFS layer).
  - Signature takes the `Workspace` (for `objects` + `graph`); `focus: Id`.
- Barrel `packages/copilot/src/index.ts:49` — export `scopedManifest`.
- Tests (new `brief.test.ts` or extend an existing copilot test): a synthetic
  ~30-object graph → the manifest contains the focus neighborhood, excludes far
  objects, and stays under `byteBudget`; empty/isolated focus handled.
- **Exit:** green; the roadmap's 30-object scoped-manifest exit met.

## Stage D — checkpoint real trigger (`workspace`)
Replace the no-op; policy = **N acts**.

- `packages/workspace/src/checkpoint.ts` — replace `noCheckpoint` (31-34) with a
  real policy factory, e.g. `everyNActs(n: number): CheckpointPolicy`:
  - `shouldCompact(log)` → `log.acts.length >= n` (or acts-since-last-checkpoint).
  - `compact(log, tryFold)` → fold the prefix via the injected `TryFold`
    (commit.ts:20), then synthesize ONE `AuthorAct` whose `js` re-declares every
    folded object under its existing `<base>@<n>` id via `M.parameter(…,{id})` /
    `M.derived(…,{id})` (session.ts:35-39 — the `@n` form is outside core's reserved
    `#n` positional form, so re-declaration keeps `M.byId` resolving). Replace the
    prefix with the synthesized act; keep the suffix. Replay stays
    `O(acts since checkpoint)`.
  - Keep `noCheckpoint` exported for callers that opt out.
- Barrel `packages/workspace/src/index.ts:38-39`.
- Tests: a 100-act log folds identically before vs after a checkpoint (determinism);
  ids preserved across the checkpoint (`M.byId` resolves a pre-checkpoint object);
  post-checkpoint replay length is bounded.
- **Exit:** green; 100-act log deterministic across a checkpoint; ids preserved.

---

## Stage ordering & isolation
Serialized (each committed before the next) to keep commits clean and the fence/
cassette tests green at every step:
- **A → B** share `act.ts`/`fold.ts` (do B on A's result).
- **D** is workspace-only but different files (`checkpoint.ts`/`session.ts`); after B.
- **C** is copilot-only (`brief.ts`); independent, but committed in sequence.

Each stage: subagent implements against this doc → `./run.sh typecheck` +
`./run.sh test` green → I review the diff → commit `M4x: …`. Milestone closes with
the roadmap M4 status block updated.
