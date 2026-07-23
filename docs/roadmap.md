# isomat — build roadmap

> Status: **planning (2026-07-23).** Nothing below is built yet. This roadmap
> implements the *co-edit workspace* model — the MathCopilot flagship redesign —
> as isomat's foundation. The README frames isomat as "the math ↔ LLM interface
> layer other projects build on"; that layer **is** the workspace substrate here.
> Proof visualization (`qed`) and content (`undergrad`) become consumers of the
> same object / correspondence / evidence substrate, not separate stacks.

## The concept in one line

`fold(log)` stops producing a *timeline you play* and starts producing a
*positioned set of live math objects you and an LLM co-edit*. Everything beneath
`fold` — reactivity, identity, correspondence, the QuickJS sandbox,
evidence-typing — is lifted from math-ai unchanged. The redesign is **one
deletion** (timeline-as-root-artifact) and **one generalization** (a 3-kind
lesson log → an authorship-tagged N-verb co-edit log).

## Decisions (locked 2026-07-23)

| # | Question | Decision |
|---|---|---|
| 1 | Bootstrap | **Lift `core` + `host` verbatim** from math-ai; cherry-pick `library` (live, claim, numeric, views, formula). Build `workspace` / `parse` / `copilot` fresh. |
| 2 | Phase-1 target | **The spatial co-edit workspace** — full verb set, fold→positioned objects, selective manifest. Ambitious; front-loads the redesign. |
| 3 | Parser | **mathjs for parse + numeric eval; own addressable span tree** wrapping its AST. Symbolic APIs fenced off (the no-CAS line). |
| 4 | UI / app stack | **Deferred.** Phase 1 proves the spatial engine **headless** in the cheap test tier; the browser canvas is Phase 2. |

## The reuse boundary

| Lift verbatim (the substrate) | Build fresh (the divergence) |
|---|---|
| `packages/core` — identity, reactive (`Slot`/`Derived`/`Collection`/`Incremental`), correspondence, world, provenance, timeline* | `packages/workspace` — the act ontology, `fold(log)→Workspace`, generalized `commitEntry`, checkpoint compaction |
| `packages/host` — bridge, prelude, budget, guest-error, lint | `packages/parse` — LaTeX/text → span tree + numeric evaluator (mathjs-backed) |
| `library` subset — live, claim (evidence-typing), numeric, views, formula (span model) | `packages/copilot` — the 4c loop wired live + scoped manifest + probe toolset |

*`timeline` comes along in the lift but demotes: it stops being the root artifact
and becomes cell-scoped (playback-in-a-cell, Phase 2). `conversation.ts` does
**not** lift — `workspace` supersedes it.

## Milestones

Each milestone's exit criteria are provable in the **cheap tier** (headless
vitest + `typecheck`), matching math-ai's discipline. UI is out of every Phase-1
milestone by decision #4.

### M0 — Substrate lift & green build ✅ DONE (2026-07-23)
Stand up the monorepo with the reusable half of math-ai moved over unchanged.
- pnpm workspace, `vitest.workspace.ts`, tsconfig, `run.sh` (nvm wiring) copied from math-ai.
- Lift `core` and `host` verbatim; cherry-pick the `library` subset. Leave `lesson/*`, `planner`, `render` behind for now.
- **Exit:** `./run.sh typecheck` green; lifted `core`/`host` unit tests pass unchanged; a smoke test boots QuickJS and runs a trivial program headless.
- **Proves:** the "lift verbatim" decision — that `core`/`host` carry no hidden lesson coupling.

**M0 outcome — the plan was too optimistic about isolation.** There is no
buildable "core + host only" configuration: host's *tests* import `@isomat/render`
and `@isomat/library`, and host's tsconfig includes its tests, so the real lift
closure is **core → lesson → render → library → host** — all five packages, not
two. The verbatim thesis still held (the *only* edits were the `@math-ai/*`→
`@isomat/*` scope rename; zero source changes forced), and everything is green:
`typecheck` clean, **519 lifted tests pass unchanged + 1 new QuickJS smoke test**
(`packages/host/src/substrate.smoke.test.ts`), ~2.3s. 173 files, uncommitted.

Consequence for the redesign: `lesson` and `render` (the layers we planned to
*demote*) are already in the tree, so M1 onward is **subtractive on a full engine**,
not additive on a minimal base. Two artifacts rode along that do **not** belong in
isomat and are cleanup debt: the repo-root `examples/` corpus +
`examples.smoke.test.ts` (planner-recorded model output — isomat has no generation
story), and `run.sh`'s dead `dev`/`build`/`verify`/`record`/`gate`/etc. commands
(they reference `@isomat/web`/`@isomat/planner`, which don't exist). Delete/prune
when `workspace` lands.

### M1 — Workspace log & fold (3 verbs) ✅ DONE (2026-07-23)
`packages/workspace`. The pivot, minimally.
- `WorkspaceAct` union with `by: Author` + `turn`; implement **only** `author`, `introduce`, `set-input`.
- `fold(log): Workspace` → `{ objects, layout, graph, claims, retired }`.
- `commitEntry` lifted from `conversation.ts`, generalized to N verbs — the one-transaction rule (fold candidate headlessly; reject → prior log untouched).
- `coalesce` for drags; `isolate()` for author scoping. **Stable-id policy decided now:** introduced objects get explicit session-counter ids, not positional ones.
- Checkpoint-compaction *interface* + no-op stub (real trigger lands M4).
- **Exit:** fold a hand-built log (author creates a param+plot object; set-input drags it) → correct `Workspace`; a throwing author act leaves the prior log intact; re-fold yields identical ids (the cassette property).

**M1 outcome — landed, all green, `conversation.ts` generalized cleanly.**
`packages/workspace` = `act.ts` (the 3-verb union, every act `by`-tagged),
`fold.ts` (hook-driven `foldLog`, generalizes `replayLog`), `commit.ts` (the
one-transaction rule, generalizes `commitEntry`), `session.ts` (`SessionIds`
stable-id allocator, `<base>@<n>`), `checkpoint.ts` (interface + no-op stub),
`node.ts` (QuickJS-backed `fold`/`tryFold`). **17 new tests, full suite green:
`typecheck` clean across 6 packages, 534 tests pass** (~2s). `examples/` corpus +
its smoke test deleted (sole reader confirmed). The M1 `Workspace` is the minimal
`{ objects, layout, graph }` — `claims`/`retired` **deferred to M4** (no M1 verb
fills them; a permanently-empty field would be speculative ontology).

Findings carried forward:
- **Substrate seam (the one place `conversation.ts` didn't cover):** guest source
  couldn't mint an explicit *engine* id through `M`. Fixed additively — `opts.id`
  threaded through `M.parameter`/`M.derived` → `createParameter`/`derivedNumber` →
  `world.handle(kind, id)`. Backward-compatible (all lifted tests green). **Open
  question for M2/M3:** should stable-id minting be *first-class* in the authoring
  vocabulary rather than an optional opt on two constructors? M3's `introduce`
  (LaTeX→object) and M4's `replace` both lean on this seam.
- **VM lifetime:** a folded `Workspace` keeps its QuickJS VM alive (a derived's
  `.value` re-invokes a bridge-retained guest closure), so `fold()` must not
  dispose it. M4 checkpoint-compaction needs a disposal/lifetime story so old VMs
  don't accumulate across a long session.
- **Empty correspondence graph:** simple hand-authored programs record no edges
  (`M.parameter`/`M.derived` don't emit them; edges come from `defineOp`/authored
  `link`). M4's `scopedManifest` BFS needs the copilot (M2) to author programs
  that actually record edges — watch when the loop starts writing fragments.

### M2 — 4c loop, live and headless
`packages/copilot`. Light up what math-ai built but never wired.
- Lift `runToolLoop`, tool-defs, the intent classifier, and the loop cassette from `planner`.
- Adapt `ToolExecutor` to run against `Workspace` + `fold` (replacing conversation replay).
- A headless turn fn: `(log, question) → { answer | manipulated | newLog }`.
- **Exit:** classifier fast-path manipulates a param with **zero** model calls; a cassette-driven agentic turn probes (`evalAt`/`counterfactual`) then answers with evidence-typing, replayed free; `appendFragment` commits through `commitEntry`.
- **Proves:** the executor ↔ workspace seam — where "4c dark → live" is actually paid.

### M3 — Parser front door + introduce/edit
`packages/parse`. The riskiest new seam.
- mathjs for parse + numeric eval; wrap its AST into the addressable span tree (target shape = `formula.ts`'s `F.tex` spans).
- **Fence off** mathjs symbolic/simplify APIs behind a wrapper — the no-CAS boundary.
- `introduce` act: LaTeX → live object (span tree + numeric evaluator feeding `View.plot`'s `samplerFor`). `edit-span` act: in-place term edit.
- **Exit:** type `x^2 + a*x` → live object, plot renders headless, drag `a` updates; edit a span's tex → re-parse + dependents recompute + id stable; a guard test asserts no symbolic call escapes the wrapper.
- **Watches:** parser scope creep toward a CAS. The fence test is the mitigation.

### M4 — Spatial verbs + selective manifest
The workspace becomes genuinely spatial and large-notebook-ready.
- Add `move`, `retire`, `replace` acts; fold into `layout` / `retired` projections.
- Checkpoint compaction **real trigger** (every N acts or byte budget): fold prefix → synthesized `author` act, ids preserved → replay stays `O(acts since checkpoint)`.
- `scopedManifest(workspace, focus, byteBudget)`: bounded BFS over `CorrespondenceGraph.neighbors`/`reachable`, nearest-first fill.
- **Exit:** a 30-object workspace yields a scoped manifest under budget containing the focus neighborhood and excluding far objects; `replace` is atomic (reject → intact); a 100-act log folds cheaply and stays deterministic across a checkpoint.
- **Watches:** id stability under `replace`; compaction determinism. Both get direct tests.

### M5 — Integrated co-edit workspace + probe toolset (Phase-1 goal)
Everything converges; the spatial co-edit engine is real, headless, and tested.
- Grow the loop's tools: `plot`, `tabulate`, `numeric-equivalence`, `numeric-root` — each returns typed evidence, none certify.
- Canonical interaction end-to-end: *"is d/dx of this equal to that?"* → LLM derivative → numeric probe at sampled points → **`sampled`** evidence, never "proven."
- Hammer the symmetric log: 100+ interleaved acts from both authors (user introduce/drag/edit + copilot probe/author/arrange) through one foldable log.
- **Exit:** a headless integration test drives a full multi-object co-edit session — deterministic, no half-apply, `M.byId` robust; one billed `record`-style session captured as the flagship cassette.

## Phase 2 — deferred (revisit when M5 lands)
- Decide the UI/app stack (decision #4).
- Browser canvas over the `Workspace`; drag/layout surface.
- Playback-in-a-cell: `Player` scoped to a cell sub-world (the `timeline` lifted in M0).
- `qed` / `undergrad` consuming isomat as the shared substrate.

## Open decisions (not yet forced)
- **Checkpoint trigger policy** — N acts vs byte budget vs turn boundary. Decide with real data at M4.
- **mathjs fence durability** — if the symbolic boundary proves leaky, swap to a lighter numeric lib.
- **Substrate sharing model** — do `qed`/`undergrad` import isomat as a package or copy it (divergent-stacks, at the substrate level)?
- **UI/app stack** — deferred to Phase 2 by decision #4.

## Testing discipline (carried over from math-ai)
- **The cheap tier is the loop:** headless vitest + `typecheck`. Every Phase-1 exit is provable there — no browser on the critical path.
- **Cassettes:** billed once per real generation, replayed free forever. Record *failures* too — a rejected turn pins a real defect for free.
- **Billed paths are named and never accidental** (`record`, live generation). Ask before running one; none is the right way to check an engine change.

## Not in scope (deliberately)
- No CAS / symbolic kernel. The LLM reasons; the engine probes; claims are evidence-typed.
- No verifier, no grading, no proof checker in the core (an external one may later join as *one more probe returning evidence*).
- No accounts / persistence / server-side session — the workspace is `fold(log)`, posted up per turn.
- No lesson-authoring vocabulary at the root — beats/`Player` live inside cells only (Phase 2).
