# isomat — build roadmap

> Status: **M0–M4 DONE (2026-07-23); NEXT is M5.** This roadmap implements the
> *co-edit workspace* model — the MathCopilot flagship redesign — as isomat's
> foundation. The README frames isomat as "the math ↔ LLM interface layer other
> projects build on"; that layer **is** the workspace substrate here. Proof
> visualization (`qed`) and content (`undergrad`) become consumers of the same
> object / correspondence / evidence substrate, not separate stacks.

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

### Stabilize — decouple from math-ai's concepts ✅ DONE (2026-07-23)
Inserted before M2 to pay down the M0 "whole engine" debt and make isomat its own
lean thing. Decisions: excise + quarantine, rename to a flat workspace-native
vocabulary, shed ALL discipline libraries. Executed in 5 verified stages (each
ended green; see `docs/stabilize-plan.md`):
- **S1/S2** (`14affc2`) — import-boundary fence; host inverted to build on `core`
  alone (killed the M0 root instability); substrate types extracted to
  `@isomat/substrate`; `sceneIndex`→timeline-free `scene.ts`.
- **S3** (`7aaa35e`) — the flat native surface (`expr`/`span`/`param`/`derive`/
  `plot`/`readout`/`claim`/`link`/`note`/`byId`, bare guest globals); **auto-register
  on construction** (no show/place verb; scene reads `stage.registered`+views,
  timeline-free); **shed** the 6 discipline libs + `nerode` fixture + ~140 tests.
- **S4/S5** (`60b1422`) — playback quarantined to a `cell/` package OFF the main
  DAG; renamed `host`→`sandbox`, `library`→`objects` (render+lesson folded/deleted);
  fence forbids main-path→`cell`; pruned dead `run.sh`/verify.

**Final DAG (acyclic, depth 3):** `core → substrate/sandbox/objects → workspace`;
`cell/` off to the side. Green: typecheck 6/6, **343 tests** (was 534 — the delta is
shed disciplines, not lost coverage; quarantined tests still run in `cell/`).

Carried into M2:
- **`tools.ts` + `conversation.ts` are parked in `sandbox`** (core-only, tests
  already in `workspace`). M2 lifts them into a real `copilot/` package.
- `plot` is **numeric-rule-only until M3's parser**; `expr`/`claim` register but
  their views materialize **lazily** (errors-as-data) — M2/M3 wiring a renderer
  must honor that.
- `core/timeline.ts` stays in `core` but must remain unreachable from the
  workspace path (fence guards it; keep it out of `core`'s public barrel).

### M2 — 4c loop, live and headless
`packages/copilot`. Light up what math-ai built but never wired.

**Discovery correction (2026-07-23):** the original plan's "lift `runToolLoop`,
tool-defs, the intent classifier, and the loop cassette from `planner`" is stale —
`planner` was never lifted in M0, and there is **zero model-client code in the repo**
(no `runToolLoop`, classifier, or cassette harness anywhere). What survived is the
**tool executor** (`tools.ts`) alone, parked in `sandbox` and already proven headless
against a QuickJS fold — but speaking the superseded `ConversationLog`. So M2 is
**build-the-loop-fresh around a proven executor**, and splits cleanly:

#### M2a — the executor ↔ workspace seam ✅ DONE (2026-07-23)
- New `packages/copilot` (`@isomat/copilot`; deps core/objects/sandbox/workspace).
- Retargeted the executor from `ConversationLog`/`commitEntry`/`ReplayFailure` →
  `WorkspaceLog`/`commit`/`FoldFailure`. The disposable-fold hook IS workspace's
  `TryFold`, so `commit` takes it directly (the old `asTryFold` shim is gone); a
  committed write lands a real authorship-tagged `SetInputAct`/`AuthorAct`.
- **Deviation from the original plan** (which said "lift both `tools.ts` +
  `conversation.ts`"): `conversation.ts` was **deleted, not lifted** — `workspace`
  supersedes it (its `replayLog`/`commitEntry`/`coalesce` live on as `foldLog`/
  `commit`/`coalesce`), and once the executor stopped importing it, it was dead. Its
  self-test went too (coverage is in `workspace`'s fold/commit tests).
- Shed the discipline-era `inspect`/`evalAt` arms (matrix/loop/segment/distribution/
  field kinds) — they can't be constructed by the flat native surface; `evalAt` is
  `fn`-only until M3/M5 grow the substrate to express more.
- Extended the Stabilize fence to cover `copilot` (main-path + workspace-facing).
- **Exit (met):** the full tool sequence — inspect → evalAt → whyChanged →
  counterfactual → bisectFlip → setInput → appendFragment — green against a real
  QuickJS-folded `Workspace` (`tools.workspace.test.ts`), plus the rules tier
  (`tools.test.ts`) over an in-process `foldLog`; `appendFragment` commits through
  `commit`; the live workspace never moves under a probe. **typecheck 7/7, 332 tests.**

#### M2b — the loop driver + classifier ✅ DONE (2026-07-23)
Decision taken: **scripted fake client** (free, deterministic), billed real-Claude
cassette deferred to M5's flagship session. What landed in `packages/copilot`:
- `runTurn(log, question, client, deps) → TurnOutcome` — the headless co-edit turn,
  two paths: a `manipulated` fast-path and an `agentic` loop. `TurnOutcome` carries
  the advanced log + the answer (generalizes the plan's `{ answer | manipulated |
  newLog }`).
- `classify.ts` — the intent fast-path: recognizes a PURE manipulation command
  ("set spin to 2", "spin = -1") against the live scene's params and commits a
  `set-input` with **zero model calls**. Deliberately narrow + anchored so a
  compound question ("set spin to 2 and explain") falls through to the model rather
  than being silently manipulated.
- `client.ts` — the `ModelClient` seam (tool-use-API-shaped: a response is
  `tool-calls` or a final `answer`), a free `ScriptedClient` fake (a canned move
  sequence, operationally a replayed cassette), plus `TOOL_SPECS` + `SYSTEM_PROMPT`.
  A real Anthropic client (M5) drops into the same seam unchanged.
- `brief.ts` — `sceneBrief(scene)`: the terse id-addressable scene manifest the
  loop hands the model (the M4 `scopedManifest` precursor; same one-line-per-object
  shape, unbounded for now). Named `brief`, not `manifest`, to stay fence-legal.
- The loop ↔ executor seam: reads resolve against the live scene, probes fold
  throwaway copies, writes `commit` and advance the log, and the live scene
  **re-folds when the log changed** so a later read sees a model's own write.
- **Evidence discipline enforced structurally:** an answer's declared evidence
  (`sampled`/`exact-comparison`/`authored-predicate`) is cross-checked against the
  probes that actually ran (`evidenceGrounded`) — the loop cannot launder an
  opinion into a proof it never probed for.
- **Exit (met):** classifier fast-path manipulates with zero model calls; a
  scripted agentic turn runs counterfactual → evidence-typed answer, the probe
  result provably fed back, evidence grounded; a model-authored `setInput` commits
  and the re-folded live scene reflects it; a runaway model is cut off as
  `truncated`. **typecheck 7/7, 347 tests** (+15: 9 classify, 6 turn).

**Proves (M2 overall):** the executor ↔ workspace seam — where "4c dark → live" is
actually paid (M2a) — then the loop around it, free and deterministic (M2b). The one
billed real-Claude session is deferred to M5 as the flagship cassette.

### M3 — Parser front door ✅ DONE (2026-07-23)
`packages/parse`. The riskiest new seam. Decisions taken at the start:
**mathjs** (honor decision #3) and **edit-span deferred to M4** (below).

What landed:
- `parseExpr(text) → ParsedExpr`: math text (mathjs syntax, NOT LaTeX) → display
  TeX + an addressable span tree (`{ tex, role? }`, the `formula.ts` shape, top-level
  additive terms role-named `term0`/`term1`) + the free variables + a numeric
  sampler emitter. The AST is WALKED (`ast.ts`), never simplified/differentiated.
- **The integration is the "LaTeX → source front door" `act.ts` promised, not a new
  fold path:** `introduceExpr(...)` emits SANDBOX JS (`plot((x) => Math.pow(x,2) +
  v0.value*x, { … , id })`, bound free vars reached by `byId`) and packages it as an
  ordinary `IntroduceAct`. The existing fold runs it in QuickJS. **Numeric eval
  therefore happens in the sandbox** (one lint-gated, deterministic evaluation
  site), NOT in a host-side mathjs — a deliberate reading of "mathjs for parse +
  numeric eval": mathjs parses; the sandbox evaluates the emitted arithmetic.
- The no-CAS fence: `mathjs.ts` is the SOLE importer of mathjs and imports only
  `parse`; `fence.test.ts` fails the build if anything else imports mathjs, if the
  runtime import brings in more than `parse`, or if any CAS op name (simplify/
  derivative/rationalize/resolve/evaluate/…) appears in a mathjs import anywhere.
  The arithmetic grammar (numbers, vars, + − × ÷, ^, unary minus, parens, a
  sin/cos/tan/exp/log/sqrt/abs whitelist) throws on anything outside it — the
  no-CAS line enforced at parse time, not trusted.
- Small additive change to `@isomat/objects`: `PlotOpts.id?` threads a stable id
  through `plot` → the `fn` handle (the same seam `param`/`derive` already carry),
  so an introduced curve survives re-fold and is reachable by id.
- **Exit (met):** `x^2 + a*x` → a live plotted object folded through QuickJS; the
  sampler evaluates the real arithmetic (12 at x=3,a=1); a `set-input` on `a` +
  re-fold updates it (15 at x=3,a=2 — "drag updates" IS re-fold, since a plot
  samples once per fold); the fn id is stable across the re-fold; the fence guard
  asserts no symbolic call escapes. **typecheck 8/8, 363 tests** (+16).
- **Deferred to M4 (deviation from the original exit):** `edit-span` (in-place term
  edit → re-parse + dependents recompute + id stable). It is the SAME
  id-stability-under-mutation problem M4's `replace` is built around; consolidated
  there so it is solved once. The span tree M3 produces is already the shape it
  edits.
- **Watches (held):** parser scope-creep toward a CAS. The fence test is the
  mitigation, and mathjs is now imported behind exactly one `parse`-only wall.

### M4 — Spatial verbs + selective manifest ✅ DONE (2026-07-23)
The workspace becomes genuinely spatial and large-notebook-ready. Executed by
subagents against `docs/m4-plan.md`, one stage per commit, each ending green.
- Add `move`, `retire`, `replace` acts; fold into `layout` / `retired` projections.
- **`edit-span`** (moved here from M3): edit a parsed expression's span tex →
  re-parse (via `@isomat/parse`) + dependents recompute + **id stable**. Same
  id-stability-under-mutation core as `replace`; solve both together here.
- Checkpoint compaction **real trigger** (every N acts or byte budget): fold prefix → synthesized `author` act, ids preserved → replay stays `O(acts since checkpoint)`.
- `scopedManifest(workspace, focus, byteBudget)`: bounded BFS over `CorrespondenceGraph.neighbors`/`reachable`, nearest-first fill.
- **Exit:** a 30-object workspace yields a scoped manifest under budget containing the focus neighborhood and excluding far objects; `replace` is atomic (reject → intact); a 100-act log folds cheaply and stays deterministic across a checkpoint.
- **Watches:** id stability under `replace`; compaction determinism. Both get direct tests.

**M4 outcome — landed in four committed stages, all green (403 tests, typecheck
8/8).** Plan at `docs/m4-plan.md`.
- **M4a** (`7b7367a`) `move`/`retire` — pure-projection verbs; `retired: ReadonlySet<Id>`
  now live on `Workspace` (the M1-deferred field). Absent-target move/retire is a
  fold FAILURE (prior log intact).
- **M4b** (`c744ce1`) `replace`/`edit-span` — **the id-stability-under-mutation core.**
  A re-declaration can't append (core's id registry is single-assignment by design;
  the scene is first-wins), so `foldLog` became **two-pass** (Option B, chosen with
  the user): pass 1 resolves each introduced id to its FINAL definition (introduce
  seeds; `replace` overwrites the js; `edit-span` re-parses+re-emits via an injected
  `SpanResolver`); pass 2 mints each id ONCE with its final js, `replace`/`edit-span`
  are no-ops. Id stays stable; dependents (all authored after) recompute against the
  new definition. `commit`'s append-only contract + `identity`'s collision guard +
  the first-wins scene are all untouched. DAG stays acyclic via dependency inversion
  — `workspace` defines `ExprMeta`/`SpanResolver` as plain data; `@isomat/parse`
  implements `resolveSpan` (new `editspan.ts`, a source-side `additiveTermSources`/
  `toSource` twin of `toFragments`, no CAS). `edit-span` addresses top-level additive
  terms in mathjs SOURCE (field `text`, not `tex`).
- **M4c** (`6415a88`) `scopedManifest` — byte-budgeted nearest-first BFS over the
  correspondence graph from a focus id; id-sorted within each layer (deterministic,
  cassette-safe); shares one `objectLine` formatter with `sceneBrief`. Stays in
  `brief.ts` (a copilot-path `manifest.ts` fails the fence).
- **M4d** (`a2d0449`) checkpoint compaction — real `everyNActs(n, opts?)` trigger. A
  folded `derive`/`plot` is a guest closure (unserializable), so the synthesized
  `author` act reconstructs from each object's **source**, not its handle: it replays
  the prefix's pass-2 execution (each introduce's FINAL resolved js via the reused
  `resolveDefinitions`; set-inputs transcribed inline as `byId(id).setValueLive(v)`
  in log order), so every id mints identically and exactly once. A bounded
  `move`/`retire` tail restores the layout/retired projections an `author` act can't
  carry. `fold(compacted) === fold(original)`.
- **Deviations from the original spec (accepted):** (1) checkpoint bound is
  `1+|layout|+|retired|+|suffix|` (still `O(live objects)`, independent of prefix
  length), not a literal `1+|suffix|`; (2) a compacted object is frozen — a
  post-checkpoint `replace`/`edit-span` on it needs `keepRecent` to hold it in the
  live suffix; (3) `replace`/`edit-span` may only target an **introduced** id (not an
  `author`-minted one), and its resolved source runs in the target's original
  dependency scope. `edit-span` is NOT in `ExecutableAct` (it has no `.js`; it is
  re-emitted through parse). Checkpoint trigger policy chosen: **N acts** (byte
  budget can layer on later).

### M5 — Integrated co-edit workspace + probe toolset (Phase-1 goal) — headless half ✅ DONE (2026-07-23); billed cassette (M5d) GATED
Everything converges; the spatial co-edit engine is real, headless, and tested.
Executed by subagents against `docs/m5-plan.md`, one stage per commit.
- Grow the loop's tools: `plot`, `tabulate`, `numeric-equivalence`, `numeric-root` — each returns typed evidence, none certify.
- Canonical interaction end-to-end: *"is d/dx of this equal to that?"* → LLM derivative → numeric probe at sampled points → **`sampled`** evidence, never "proven."
- Hammer the symmetric log: 100+ interleaved acts from both authors (user introduce/drag/edit + copilot probe/author/arrange) through one foldable log.
- **Exit:** a headless integration test drives a full multi-object co-edit session — deterministic, no half-apply, `M.byId` robust; one billed `record`-style session captured as the flagship cassette.

**M5 outcome — the headless half (M5a–c) is DONE and committed (421 tests green,
typecheck 8/8); the billed flagship cassette (M5d) is the one remaining GATED step.**
- **M5a** (`72e2044`) probe toolset — `plot`/`tabulate`/`numericEquivalence`/`numericRoot`,
  each returning typed `sampled` evidence, none certifying. `plot(text, domain)` is the
  parse-gated write (model TEXT → `introduceExpr` → live `fn`); the other three sample
  objects' own `at()` closures. No CAS — the LLM supplies the derivative, the engine
  only samples. `groundedEvidence` grounds all four as `sampled`. camelCase tool names
  (roadmap's kebab is the concept). `copilot → parse` dep added (acyclic).
- **M5b** (`7377dbc`) canonical flow — the *"is d/dx of f equal to g?"* interaction
  end-to-end via `ScriptedClient`: model plots its derivative TEXT, samples it against
  `g` with `numericEquivalence`, answers `sampled` (never "proven"). The load-bearing
  negative: a wrong derivative (`2*x+1`) is CAUGHT — the probe returns
  `equivalent:false`, `maxAbsDiff≈1`, and that finding provably fed back before the
  answer. The engine cannot launder a wrong opinion into a proof.
- **M5c** (`bb3d8fc`) symmetric-log hammer — a 113-act both-authors session (15 objects,
  every verb + probe) folds deterministically; no half-apply (rejected acts leave the
  log reference intact); `byId` robust; ids stable under `edit-span`/`replace`; an
  `everyNActs(50)` checkpoint (M4d) over the long log folds to the same workspace.
- **M5d — BILLED, GATED (not started; needs explicit user approval + an API key).** A
  real `AnthropicClient` behind the `ModelClient` seam + a cassette record/replay
  harness + one captured flagship cassette. Verified absent today: no SDK, no key, no
  billed path exists. Free `M5d-code` (harness + replay over a fixture) is buildable
  without a key; the one billed `record` session is the only paid step in the repo.

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
