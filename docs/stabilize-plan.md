# isomat — Stabilize milestone plan (DISCOVERY output)

> Status: **plan, 2026-07-23.** Read-only investigation. Nothing here has been
> executed. This document is the file-level demolition plan for the "Stabilize"
> milestone: shed the discipline libraries, rename to a flat workspace-native
> authoring surface, quarantine the playback machinery, and invert the host test
> coupling so `host` stands on `core` alone. The five decisions in the task brief
> are taken as given and are not relitigated here.

The M0 lesson — *this repo's dependency graph has non-obvious couplings* — held
up. The two biggest ones are surfaced up front because they reshape the whole
plan:

1. **The workspace's own M1 acceptance tests are written in the vocabulary being
   removed.** `packages/workspace/src/fold.sandbox.test.ts` authors act-source
   that calls `lesson.beat`, `lesson.expose`, `lesson.show(View.plot(...))`, and
   `Calc.fn(...)` — i.e. the quarantined lesson verbs and a *shed* discipline lib
   (`calculus`). `workspace` source imports no timeline and no discipline (clean),
   but the **scope it injects into the sandbox** (`createProgramScope`) is the
   full lesson + 6-discipline surface, so guest fragments reach all of it. The
   shed/quarantine therefore breaks green workspace tests, and the native surface
   must land *together with* rewritten fold tests. This is the core of the work,
   not a side effect.

2. **`sceneIndex` — the manifest boundary `workspace.fold` depends on — is
   implemented by walking the demoted `world.timeline`.** `sceneIndex(stage)`
   (in `render/src/manifest.ts:408`) iterates `stage.world.timeline.root` to find
   shown/retired objects, *then* `stage.views`. It is live substrate (imported by
   `workspace/src/node.ts:18` and `library/src/scope.ts:46`), yet its
   implementation is coupled to the very thing Stabilize quarantines. It must be
   re-homed as a native scene boundary that does not import `timeline`.

---

## 0. Current dependency DAG (declared) and the real coupling

Declared package deps (`package.json`):

```
core → lesson → render → library → host → workspace
                 (render also → core)     (host → core,lesson,library,render)
                                          (workspace → core,host,library,render)
```

Real SOURCE coupling (imports in non-test `.ts`), which is much shallower than
the declared graph:

| package | source imports (non-test) |
|---|---|
| `core` | nothing |
| `lesson` | `core` only |
| `render` | `core` + `lesson` **types** (+ `createLesson` value in playback modules) |
| `library` | `core`, `lesson`, `render` |
| `host` | **`core` only** — every `host/src/*.ts` non-test file imports only `@isomat/core` (Handle/Id/isHandle) plus intra-`host` relative imports (verified below) |
| `workspace` | `fold.ts`/`commit.ts`/`act.ts`/`session.ts` import `core` types only; **`node.ts` alone** imports `render` (`createStage`,`sceneIndex`), `library` (`createProgramScope`), `host` (`QuickJSHost`,`isolate`,`newNodeContext`) |

The instability the roadmap named is entirely a **test-time** phenomenon in
`host`, and a **scope-injection / test-fixture** phenomenon in `workspace`. No
substrate source file needs the discipline libraries.

---

## 1. Dependency cascade of the shed

### 1.1 The discipline cluster is internally interconnected, externally reached from 3 hubs

Shed set: `automata`, `graph`, `probability`, `calculus`, `linalg`, `field`
(all in `packages/library/src/`), plus their shared helper `structure.ts` and the
`nerode` fixture.

Internal edges among the shed files (all in `library/src`):

- `graph.ts:53` imports `automata.ts` (`MachineEdge`, `StateMachine`).
- `field.ts:37-38` imports `linalg.ts` (`matrix2`, `Matrix2`).
- `automata.ts:29` and `graph.ts:52` import `structure.ts` (`byLabel`, `findOr`,
  `reportDiagnostics`). `structure.ts` is imported by **nothing else** (verified:
  no external users of those three names outside `automata`/`graph`/`index`), so
  it sheds with the cluster.

External references INTO the cluster come from exactly **three hub files** plus
`index.ts`:

| hub | discipline coupling | line refs |
|---|---|---|
| `library/src/scope.ts` | imports & constructs **all six** (`createAutomata`, `createProbability`, `createCalculus`, `createLinearAlgebra`, `createGraphLib`, `createFieldLib`), spreads `...automata` into `M`, exposes `Prob/Calc/LinAlg/Graph/Field` on `ProgramScope` | 26-45, 55, 100-110, 136-142 |
| `library/src/views.ts` | imports discipline **types** (`Partition`, `StateMachine`, `Graph`, `Distribution`, `Fn`, `Accumulation`, `Matrix2`, `VectorField`, …) + `integrate` from `calculus`; the `View.*` methods for tokens/partition/stateGraph/graph/table/matrix/bars/history/region/strip/riemann/field/heatmap/loop/tiling/coordinatePlane/vectors are discipline-shaped | 50-56, 53 (`integrate`) |
| `library/src/index.ts` | re-exports the whole discipline surface | 16-95 |

`calculus.ts` also feeds the KEPT `plot`: `View.plot` takes `Fn | Accumulation`
(`views.ts:112-119`) and `samplerFor` calls `integrate` (`views.ts:353-357`). The
render `PlotView` itself takes only `sample:(x)=>number` (`plot.ts:26-34`), so the
coupling is in the *library wrapper*, not the view — see §5 for the lean `fn`
replacement.

**What breaks on deletion, and where the surgery lands:** deleting the six files
+ `structure.ts` produces compile errors *only* in `scope.ts`, `views.ts`,
`index.ts`. Those three are rewritten (§5), not deleted. Nothing in `render`,
`host`, or `core` references the disciplines.

### 1.2 Tests that die with the shed (library)

Pure-discipline test files, deleted outright:

| file | test cases | note |
|---|---|---|
| `automata.test.ts` | 17 | |
| `graph.test.ts` | 22 | |
| `probability.test.ts` | 14 | |
| `calculus.test.ts` | 12 | |
| `linalg.test.ts` | 19 | |
| `field.test.ts` | 27 | |
| `green.compose.test.ts` | 5 | composes `Field`+`LinAlg`+`Calc` (`green.compose.test.ts:41,46`) |
| `secondderivative.compose.test.ts` | 6 | composes `Field.gradient`→`Field.hessian`→`LinAlg.eigen`→`M.claim` |
| `acceptance.nerode.test.ts` | 9 | see §1.4 |

Total deleted: **131 test cases**.

Rewritten/shrunk (they exercise the shed surface but their *subject* survives):

- `scope.test.ts` (7) — asserts the full `M/Prob/Calc/…` scope; rewrite to the
  lean native scope.
- `views.test.ts` (3) — rewrite to `plot/readout/claim/formula` only.
- `manifest.test.ts` (11) — this is the **library-side** scene-manifest test
  ("why did that turn red?"); it builds a claim scene. It couples to the render
  manifest (quarantine) but its evidence-typing subject is a keeper. Rewrite as a
  claim/evidence contract test at the workspace level (§6).

KEEP with at most cosmetic edits: `claim.test.ts` (9), `parameter.test.ts` (5),
`live.test.ts` (13).

### 1.3 Tests that die with the shed (render, host)

Render discipline-shaped view tests (SHED with their views, §2):
`views/stateGraph.test.ts` (3), `layout/graph.test.ts` (11), and the discipline
half of `views/continuous.test.ts` (29 total — but it mixes **PlotView (KEEP)**
with Region/Strip/Riemann (SHED) at `continuous.test.ts:18-21,125-163`, so it is
**split**, not deleted). `views/protocols.test.ts` (9) tests morph/buildUp
protocols — quarantine with lesson.

Host: `field.sandbox.test.ts` (Field in the sandbox) SHEDS. `perf.test.ts` uses
`createProbability` (`perf.test.ts:18`) — rewrite against a native primitive or
delete.

### 1.4 The `nerode` fixture and its acceptance test

`packages/library/src/__fixtures__/nerode/` (`api.ts`, `beats.ts`, `README.md`):

- `api.ts:19` re-exports `Word` from `../../automata.js` and `api.ts:8` pulls
  `getActiveScope` from `scope.ts`. `beats.ts` is a recorded automata lesson
  program authored against `M`(automata)/`View.stateGraph`/`lesson.*`.
- `acceptance.nerode.test.ts:21` imports `createProgramScope`, `setActiveScope`
  and runs the fixture through the full scope, asserting beat titles / op counts /
  morph legality (the "frozen acceptance fixture" the project CLAUDE.md warns about).

**Verdict: DELETE the fixture and its acceptance test entirely.** It is an
automata lesson; automata is shed; there is no native-surface equivalent to
rewrite it into (the native surface has no state machines). This is a
*rewrite-vs-delete* decision resolved as delete, because the thing it asserts
(machine morphs, deferred edges) is exactly the discipline vocabulary being
removed. The precedent is explicit: the sibling repo deleted its Markov fixture
+ acceptance tests deliberately for the same reason ("a frozen lesson reads as
content to preserve"). Do **not** port it to `objects/__fixtures__`.

A separate acceptance test, `lesson/src/acceptance.myhill-nerode.test.ts` (9),
builds **its own** minimal machine over core ops (`acceptance.myhill-nerode.test.ts:25-111`)
and imports no discipline lib — it exercises `lesson.*` verbs. It quarantines
with `lesson` (§2.2), not with the shed.

---

## 2. Substrate vs demote split inside `render`, `lesson`, `library`

Verdict legend: **KEEP** = substrate for a kept primitive, folds into the native
surface. **QUARANTINE** = playback-in-a-cell, moved behind a cell boundary the
workspace/copilot must not import. **SHED** = deleted (discipline-shaped or dead).

### 2.1 `render` (per file)

Base infrastructure the kept primitive views stand on — **KEEP**:

| file | why |
|---|---|
| `stage.ts` | core-only container (imports `core` only, `stage.ts:11-12`); views mount here |
| `registry.ts` | node registry, core-only |
| `view.ts` | view base class — KEEP, but prune its `implements MorphSubject` (`view.ts:41`) and the morph/`elements` affordance into an optional so the base does not drag lesson playback types |
| `theme.ts`, `util.ts`, `tex.ts` | pure rendering helpers |
| `views/frame.ts` | coordinate frame, core-only (`frame.ts:20`) |
| `views/plot.ts` | **the `plot` primitive.** Takes `sample:(x)=>number` — no discipline coupling (`plot.ts:17-18`) |
| `views/readout.ts` | **the `readout` primitive**, core + `NumericHandle` only (`readout.ts:15-16`) |
| `views/claim.ts` | **the `claim` view**, core + `NumericHandle`/`Verdict` (`claim.ts:15-16`) |
| `views/formulaView.ts` | **the `expr` render.** KEEP, but prune the `TransformFormulaPayload` morph coupling (`formulaView.ts:23`) — the static span render is substrate, the formula-morph is playback |
| `views/layout.ts` | generic `columns/stack/overlay` containers |
| `index.ts` | KEEP, prune the shed/quarantine exports |

Playback machinery — **QUARANTINE**:
`player.ts`, `segments.ts`, `events.ts`, `animate.ts`, `pacing.ts`,
`supersede.ts`, `views/narration.ts` (renders `lesson.say`), and **the prose half
of `manifest.ts`** (`sceneManifest`, `transitionFeed`, `ManifestBeat/Move/…`).

Discipline-shaped views — **SHED** (dead once the disciplines are gone; nothing
constructs them): `views/bars.ts`, `views/history.ts`, `views/stateGraph.ts`,
`views/partition.ts`, `views/tokens.ts`, `views/table.ts`, `views/matrix.ts`,
`views/region.ts`, `views/strip.ts`, `views/riemann.ts`, `views/plane.ts`,
`views/vectors.ts`, `views/field.ts`, `views/heatmap.ts`, `views/loop.ts`,
`views/tiling.ts`, `views/experiment.ts`, `layout/graph.ts` (graph auto-layout,
used only by `stateGraph`).

**`manifest.ts` is SPLIT (the load-bearing render decision).** `sceneIndex`
(`manifest.ts:408-419`) is KEEP substrate but must be **decoupled from
`world.timeline`**: today it walks `timeline.root` to discover shown/retired
objects. In a workspace world with no lesson verbs, `timeline.root` is empty, so
introduced objects surface only via the `stage.views` branch. The native
`sceneIndex` must instead read a workspace-native registration (stage views +
introduced-object set), not the timeline. Extract it into a small `scene.ts`
substrate module in the sandbox/objects boundary; quarantine the rest of
`manifest.ts`.

### 2.2 `lesson` (per file)

| file | verdict | note |
|---|---|---|
| `formula.ts` | **KEEP** | the `expr`/`F.tex` span model; core-only (`formula.ts:25`). The implementation of the `expr` primitive |
| `types.ts` | **SPLIT** | substrate types `Live<T>`, `NumericHandle`, `VarySettable`, `Verdict`, `Polarity`, `MorphSubject` (`types.ts:17-23,132-167`) are needed by the kept views/primitives → extract to a lean home (§4). The `*Payload`, verb-opt, `Experiment`, morph-route types (`types.ts:40-114,202-363`) → QUARANTINE with `lesson.ts` |
| `lesson.ts` | **QUARANTINE** | the beat/say/morph/vary/demonstrate authoring class. Every verb emits a `world.timeline.step(...)`. `say`→`note`, `link`→`link`, `expose`→native drag are *salvaged as concepts* into the native surface (reimplemented, not lifted) — see §5 |
| `morph.ts` | **QUARANTINE** | morph legality/routing, playback-only |
| `index.ts` | rewrite | re-export only `formula` + the extracted substrate types |

Lesson test files (`acceptance.myhill-nerode`, `demonstrate`, `compare`,
`transformFormula`, `morph`, `verbs`) QUARANTINE with `lesson.ts`; `formula.test.ts`
(the `expr` model) KEEPs.

### 2.3 `library` (per file)

| file | verdict | note |
|---|---|---|
| `live.ts` | **KEEP** | the reactive cell for any type (`live.ts:24-25`, core + `Live` type). Backs `derive` and `claim.verdict` |
| `numeric.ts` | **KEEP** | `derivedNumber`/`constNumber`/`numOf` — the `derive` primitive impl (`numeric.ts:17-19`) |
| `parameter.ts` | **KEEP** | `createParameter` — the `param` primitive (`parameter.ts:15-16`, core + `VarySettable`) |
| `claim.ts` | **KEEP** | the `claim` primitive **and where evidence-typing lives** (`ClaimEvidence` at `claim.ts:51`). core + lesson types only |
| `scope.ts` | **REWRITE** | → lean native scope (§5). Drop all discipline construction |
| `views.ts` | **REWRITE** | → lean `View` with `plot/readout/claim/formula` only; drop discipline view methods and the `integrate`/`Fn` coupling |
| `index.ts` | **REWRITE** | export only the native surface |
| `automata.ts`, `graph.ts`, `probability.ts`, `calculus.ts`, `linalg.ts`, `field.ts`, `structure.ts` | **SHED** | §1.1 |
| `interaction.ts` | **SHED** | mints `lesson.enableInteraction` drag rails (`interaction.ts:13-14`, tied to the quarantined `Interaction` payload). Native param drag is a `set-input` act; the rail is a playback affordance. Used only by `scope.ts`/`index.ts` |
| `__fixtures__/nerode/*` | **SHED** | §1.4 |

**Evidence-typing location, confirmed (not a surprise, but pinned):** the
`ClaimEvidence` union (`exact-comparison` / `sampled` / `authored-predicate`)
lives in `library/src/claim.ts:51` and is mirrored (by hand) as `ManifestEvidence`
in `render/src/manifest.ts:62`. The `Verdict`/`Polarity` types it leans on live in
`lesson/src/types.ts:17-23`. Keeping evidence-typing intact means keeping `claim.ts`
+ extracting `Verdict`/`Polarity` (§4). The manifest mirror quarantines.

---

## 3. The host test-coupling inversion

### 3.1 Host source already stands on core alone (verified)

Every non-test file under `host/src` imports only `@isomat/core` plus intra-host
relative modules:

- `bridge.ts:24` `isHandle` from core; `budget.ts`, `guest-error.ts`, `host.ts`,
  `prelude.ts`, `protocol.ts`, `node.ts`, `lint.ts` — core types or nothing.
- `conversation.ts:60` — `Id` type from core only.
- `tools.ts:29` — `Handle`,`Id` from core; imports `commitEntry` + types from
  `./conversation.js` (intra-host).

`lint.ts` (232 lines) contains **no discipline vocabulary** (grep for
automata/probability/graph/calculus/linalg/field/markov/nerode: zero hits) — it
is a pure static gate. `prelude.ts` has no discipline references. So no host
source change is forced by the shed; the whole problem is the test files' deps.

### 3.2 The coupled host tests, and where each goes

| host test | imports | disposition |
|---|---|---|
| `bridge.test.ts` | render, library | **move to sandbox-integration** (workspace/objects). It boots a real world+stage+scope to test the bridge end-to-end — a legitimate integration test, wrong package |
| `substrate.smoke.test.ts` | render, library | **move to workspace** (it is the M0 QuickJS smoke test; workspace already owns render+library) |
| `conversation.sandbox.test.ts` | render, library | **rewrite at workspace level** — conversation replay is superseded by `fold`; the sandbox coverage it gives is already `fold.sandbox.test.ts`'s job |
| `tools.sandbox.test.ts` | render, library | **move with `tools.ts`** to the future copilot seam (§3.3); parked as a workspace-level test until then |
| `tools.test.ts` | render, library | same as above |
| `field.sandbox.test.ts` | render, library | **DELETE** (Field is shed) |
| `perf.test.ts` | library (`createProbability`) | **rewrite** against a native primitive, or delete |

Core-only host tests stay put and green: `budget.test.ts`, `lint.test.ts`,
`conversation.test.ts`, `guest-error.test.ts`.

### 3.3 `tools.ts` and `conversation.ts` fates in Stabilize

- **`conversation.ts`** is superseded by `workspace` (which re-implemented
  `foldLog`/`commit`/`coalesce`). BUT one export is still live substrate:
  `isolate` (`conversation.ts:114`) is imported by `workspace/src/node.ts:20`.
  **Action:** extract `isolate` into a tiny host util (e.g. `host/src/scope.ts`),
  re-point `workspace` at it, then the replay half of `conversation.ts`
  (`replayLog`/`commitEntry`/`foldSource`/`studentEvents`/`coalesce`/the entry
  types) becomes dead-except-`tools.ts`. Keep it only as long as `tools.ts`
  imports it (`tools.ts:30`); it is core-only so it is not an *instability*,
  just legacy to park with `tools.ts`.
- **`tools.ts`** is the 4c tool executor destined for a future `copilot` package
  (roadmap M2). In Stabilize it is **parked** (core-only, harmless) with its
  tests moved out of the host build. Do not wire it live and do not delete it —
  M2 lifts it. Once `isolate` is extracted, `tools.ts` + the replay half of
  `conversation.ts` can be moved together into a `legacy/` or future `copilot/`
  area off the main DAG.

### 3.4 The mechanical inversion

1. Extract `isolate` from `conversation.ts` → `host/src/scope.ts`; update
   `workspace/src/node.ts` and `host/src/index.ts`.
2. Move/rewrite/delete the 7 coupled host tests per §3.2.
3. Remove `@isomat/lesson`, `@isomat/library`, `@isomat/render` from
   `packages/host/package.json` dependencies (leave only `core` + quickjs).
4. `host` now typechecks and tests on `core` alone. This is the root-instability
   kill: the M0 "core→lesson→render→library→host" closure collapses to
   "core→host".

---

## 4. Target package layout

Recommended end-state DAG (acyclic, shallow):

```
core
 ├─→ sandbox      (was: host — core-only substrate: bridge/prelude/budget/lint/
 │                 guest-error/host/protocol/node + isolate)
 ├─→ objects      (was: library — live/numeric/parameter/claim + the shared
 │                 substrate types Live/NumericHandle/VarySettable/Verdict/Polarity
 │                 + the kept render views plot/readout/claim/formula + scene.ts)
 └─→ (types)      lean substrate types, see below

sandbox ─┐
objects ─┼─→ workspace   (fold/commit/session/checkpoint/node — the keeper)
core   ──┘

                cell/ (quarantine, OFF the DAG — imported by NOTHING on the
                       main path): player, segments, manifest-prose, events,
                       pacing, supersede, narration, lesson.ts, morph.ts,
                       the discipline-shaped views, transformFormula
                copilot/ (future, M2) ← tools.ts + conversation replay + isolate-consumer
```

### 4.1 Rename recommendations (with churn cost)

- **`host` → `sandbox`: recommend YES.** Once it is core-only QuickJS execution
  it *is* the sandbox; "host" is inherited framing. Churn: rename dir + package
  name + `@isomat/host`→`@isomat/sandbox` in `workspace/node.ts` (2 import sites)
  and the `./node` subpath. Low, one-time. Do it in S4 (the lock step) so the
  structural work in S2/S3 is not fighting a rename.
- **`library` → `objects`: recommend YES, but AFTER the shed.** The name
  "library" meant "discipline libraries"; post-shed it holds the object
  primitives. Rename churn touches `workspace/node.ts` (`createProgramScope`
  import) and any moved tests. Also low.
- **`render`: do NOT rename, DO split.** The KEEP views + scene boundary migrate
  into `objects`; the playback modules move to `cell/`. `render` as a package
  name disappears (its substrate absorbed into `objects`, its playback into
  `cell`). Alternatively keep a thin `render` holding only frame/tex/theme/stage
  if `objects` importing DOM feels wrong — decide in S3 by whether `objects`
  wants a DOM dependency. **Recommendation:** fold stage/view/frame/theme/tex/
  the 4 kept views into `objects` (they are the object *renderings*), so a math
  object and its view live together; keep `cell/` for playback.

### 4.2 What each package contains (target)

- **`core`** — unchanged. `timeline.ts` stays in core (it is imported by `cell/`
  playback) but nothing on the workspace path imports it. Acceptable: core
  exporting a type the main path ignores is not a cycle.
- **`sandbox`** (ex-`host`) — bridge, prelude, budget, lint, guest-error, host,
  protocol, node, `isolate`. Deps: `core` + quickjs only.
- **`objects`** (ex-`library` + KEEP render) — `live`, `numeric`, `parameter`,
  `claim`, the lean `scope`/`views`, `formula` (moved from lesson), the substrate
  types, and stage/view/frame/plot/readout/claim-view/formula-view/theme/tex,
  plus the decoupled `scene.ts` (native `sceneIndex`). Deps: `core`.
- **`workspace`** — unchanged in shape; `node.ts` now injects the lean scope and
  imports `sandbox`/`objects`. Deps: `core`, `sandbox`, `objects`.
- **`cell/`** (quarantine) — off the main DAG, not imported by workspace. Holds
  everything demoted. May be a package or a top-level `quarantine/` tree; keep it
  building (typecheck green) but out of the workspace closure.

---

## 5. The flat native authoring surface

Drop the `M.` / `View.` / `lesson.` / `F` / `Prob` / `Calc` / … namespaces. Inject
**one flat scope** of ~8 functions into the guest (replacing the `ProgramScope`
object graph in `scope.ts`). Flat functions (not a namespaced object) match the
"workspace-native" intent and make the injected surface trivially enumerable for
a lint allowlist.

Proposed signatures (salvage source noted):

```ts
// expr — addressable live math expression (salvage: lesson/src/formula.ts createF)
//   Stabilize keeps the tagged-template span builder; M3 swaps the body for the
//   mathjs-backed parser. Signature is stable across that swap.
expr(strings: TemplateStringsArray, ...parts: (string | Span)[]): Expr
span(role: string, tex: string): Span            // the F.span helper, flattened

// param — live draggable scalar with a range (salvage: library/src/parameter.ts)
param(name: string, value: number,
      opts: { range: [number, number]; id?: string }): Param

// derive — live computed scalar (salvage: library/src/numeric.ts derivedNumber)
derive(fn: () => number, opts?: { label?: string; id?: string }): Derived

// plot — render an expr/function (salvage: render PlotView + a LEAN fn type)
//   Replaces View.plot's `Fn | Accumulation` with a plain sampler. The
//   `Accumulation`/`integrate` branch is DROPPED (it was calculus).
plot(subject: Expr | ((x: number) => number),
     opts: { domain: [number, number]; label?: string; showAxes?: boolean }): Plot

// readout — live numeric display (salvage: render ReadoutView, unchanged)
readout(quantity: Derived | Param,
        opts?: { label?: string; compareTo?: Derived | Param }): Readout

// claim — evidence-typed proposition (salvage: library/src/claim.ts, UNCHANGED)
claim(opts: ClaimSides | ClaimPredicate): Claim   // evidence-typing preserved

// link — correspondence edge between objects (salvage: world.graph.link /
//   lesson.link's edge-minting, minus the timeline step)
link(a: Handle, b: Handle | Handle[], rel: Relation): void

// note — narration as an editable text object (salvage: lesson.say's template +
//   mention-linking, reimplemented as a first-class text OBJECT, not a timeline
//   step; renders via a trimmed narration view, no player)
note(strings: TemplateStringsArray, ...mentions: (Handle | string | number)[]): Note
```

Plus the reach-back and placement primitives the fold actually needs (these exist
today only as `M.byId` + the `introduce` act's layout):

```ts
byId<T = Handle>(id: string): T                   // salvage: scope.ts M.byId
```

An author-act fragment calls these as **bare functions** injected into the guest
global by `sandbox.defineScope({ expr, param, derive, plot, readout, claim, link,
note, byId })`. This is a strictly smaller injection than today's
`createProgramScope` object; `workspace/node.ts` builds it instead of the 13-member
scope.

### 5.1 Gaps the 8 primitives cannot express yet (flag, do not fill)

- **"Show / place on screen" — RESOLVED (2026-07-23): auto-register on
  construction.** Any object an act builds auto-appears in the scene; there is NO
  `show`/`place`/`expose` verb. Rationale (user's framing): the product goal is
  the LLM *reasoning about and changing* math/visualizations/content, not a rich
  object-manipulation surface — so the authoring surface carries the least
  ceremony. The `introduce` act's `at` position supplies layout; `scene.ts` (the
  timeline-free `sceneIndex`, §2.1) surfaces objects from `stage.views` + the
  introduced/registered set, never from `timeline`. Objects an `author` act builds
  register the same way. This is S3 work (built with the native surface).
- **Drag exposure — RESOLVED: params interactive by default.** A `param` accepts a
  `set-input` act by default (no `expose` marker). Interactivity is cheap and not
  the focus; no opt-in ceremony.
- **`plot` loses the accumulation/antiderivative curve** (was the FTC showpiece).
  Acceptable for Stabilize (no calculus), but note it as a capability regression.
- **No morph / build-up / demonstrate.** Deliberately quarantined; the native
  surface has no representation-change verb. Fine per the decisions.

---

## 6. Test strategy

### 6.1 Die (deleted)

- The 131 discipline test cases in §1.2.
- `acceptance.nerode.test.ts` (9) + fixture (§1.4).
- Render discipline-view tests: `stateGraph.test.ts` (3), `layout/graph.test.ts`
  (11), the Region/Strip/Riemann portion of `continuous.test.ts`.
- `host/src/field.sandbox.test.ts`.
- Lesson verb/morph tests move to `cell/` (quarantine), not deleted, but leave
  the workspace-path suite: `acceptance.myhill-nerode`, `demonstrate`, `compare`,
  `transformFormula`, `morph`, `verbs`, plus render `player/segments/events/
  supersede/pacing/manifest.transition/protocols`.

### 6.2 Rewritten to the native surface

- `workspace/src/fold.sandbox.test.ts` — **the priority rewrite.** Re-author its
  act-source from `lesson.beat`/`expose`/`show(View.plot(Calc.fn(...)))` to the
  flat surface: `param(...)`, `derive(...)`, `plot((x)=>a.value*x, ...)`,
  `readout(...)`. Its assertions (ids stable, drag propagates, one transaction)
  are surface-independent and survive.
- `scope.test.ts`, `views.test.ts` → lean-scope + `plot/readout/claim/formula`.
- `library/manifest.test.ts` → a workspace-level evidence/manifest contract.
- `host` coupled tests → moved/rewritten per §3.2.

### 6.3 New CONTRACT tests to add

- **Import-boundary check** (the guard that keeps the win): a test asserting no
  file in `workspace`/`objects`/`sandbox` (the main-path packages) imports from
  `cell/` or from `@isomat/*` timeline/player/lesson. Cheap static check over
  source; this is the regression fence for the whole Stabilize.
- **Fold determinism** — re-fold a native log twice, identical ids (exists in
  spirit in `fold.sandbox.test.ts:138`; keep and re-point).
- **Evidence-typing** — `claim` with `≈` / explicit tolerance / predicate yields
  `sampled` / `authored-predicate`, and the native scene/manifest carries it
  verbatim. Salvage from `claim.test.ts` + `library/manifest.test.ts`.
- **Sandbox budget** — a native author act that busy-loops is killed by
  `FrameBudget` (rehome from `perf.test.ts`, natively).
- **Scene boundary** — `sceneIndex`/`scene.ts` surfaces introduced objects with
  **no timeline** present (the §2.1 decoupling, directly asserted).

### 6.4 Estimated test-count delta

Baseline ~534 (roadmap M1). Deletions: ~131 (disciplines) + 9 (nerode) + ~14
(render discipline views) + field.sandbox (~a few) ≈ **~160 removed**. Quarantined
(moved to `cell/`, still counted if `cell/` stays in the vitest workspace): lesson
verb tests + render playback ≈ 80–100 (net zero if kept building, or removed from
the main tier if excluded). New contract tests: ~10–15. **Net main-path suite:
roughly 300–340**, deliberately smaller and entirely on the substrate the product
actually ships.

---

## 7. Staged execution plan (each stage ends green)

**S1 — Fence first (green, no deletion).** Add the import-boundary contract test
(§6.3) in its intended final form but scoped to what is already true (workspace
source imports no timeline). This makes every later stage's regressions visible
immediately. Extract `isolate` → `host/src/scope.ts`, re-point `workspace`. Green.

**S2 — Structural decoupling (green).** The host inversion (§3.4): move/rewrite
the 7 coupled host tests, delete `field.sandbox`, drop lesson/library/render from
`host/package.json`. Extract the substrate types from `lesson/types.ts` into their
lean home and re-point `render`/`library` at them. Extract `sceneIndex` → decoupled
`scene.ts`. End: `host` builds on core alone; substrate types no longer live
behind lesson playback. Green (nothing deleted from the disciplines yet).

**S3 — Vocabulary redesign (green).** Build the flat native surface (§5) in the
lean `scope.ts`/`views.ts`. Rewrite `fold.sandbox.test.ts`, `scope.test.ts`,
`views.test.ts` to it. Resolve the scene-registration gap (§5.1). Then SHED the
six disciplines + `structure.ts` + `interaction.ts` + `nerode` fixture and delete
their 131+9 tests. Split `continuous.test.ts` (keep PlotView half). End: the
workspace folds native logs; disciplines gone; green.

**S4 — Quarantine + lock (green).** Move the demoted modules (lesson.ts, morph.ts,
render playback, discipline-shaped views, prose manifest, transformFormula) into
`cell/` off the main DAG. Rename `host`→`sandbox`, `library`→`objects`; fold KEEP
render into `objects` (or keep thin `render`). Tighten the import-boundary test to
forbid main-path→`cell/` imports. Park `tools.ts` + conversation-replay with the
future `copilot` seam. End: shallow acyclic DAG (core → sandbox/objects →
workspace), `cell/` quarantined, everything green + typecheck clean.

**S5 — `run.sh` prune (housekeeping).** Delete the dead `dev`/`build`/`start`/
`examples`/`regenerate`/`verify`/`remount`/`gate`/`record` commands (they dispatch
to `@isomat/web`/`@isomat/planner`, which do not exist — `run.sh:87-166`). Keep
`test` + `typecheck`. Can land anytime; grouped at the end to avoid churn.

---

## 8. Risks & surprises

1. **[Biggest] The workspace's green M1 tests speak the doomed vocabulary.**
   `fold.sandbox.test.ts` authors `lesson.beat`/`expose`/`show`/`View.plot`/
   `Calc.fn`. The shed cannot land before the native surface exists AND that test
   is rewritten — S3 sequences this, but it means "shed the disciplines" and
   "build the native surface" are one indivisible stage, not two.

2. **`sceneIndex` is implemented on the demoted timeline.** The manifest boundary
   the fold depends on (`render/src/manifest.ts:408`, walks `timeline.root`) must
   be re-homed to a timeline-free `scene.ts`. If introduced objects currently
   surface *only* because `lesson.show`/`expose` put them on the timeline, then
   removing those verbs silently empties the scene — the S3 scene-registration
   gap (§5.1) is load-bearing, not cosmetic. **Verify early** (S2) how a bare
   `param` with no `expose` appears in `sceneIndex` today.

3. **`plot`'s subject type is a discipline type.** `View.plot` takes calculus's
   `Fn | Accumulation` and `samplerFor` calls `integrate` (`views.ts:112,353`).
   The lean `plot` must define its own sampler type and drop the accumulation
   branch — a real behaviour change (the FTC antiderivative curve is lost), not a
   pure move.

4. **Substrate types are buried in `lesson/types.ts`.** `Live`, `NumericHandle`,
   `VarySettable`, `Verdict`, `Polarity`, `MorphSubject` sit in the same file as
   every playback payload type (`types.ts`). They must be surgically extracted;
   `render`'s KEEP views and `library`'s KEEP primitives all import from here, so
   a botched split breaks the substrate. `render/view.ts:41` even `implements
   MorphSubject` — the view base structurally depends on a lesson type.

5. **`formulaView.ts` mixes substrate and playback in one file.** It imports
   `TransformFormulaPayload` (`formulaView.ts:23`) — the static span render is
   KEEP, the formula-morph animation is playback. Prune within the file, don't
   move it wholesale.

6. **`isolate` is the one live tendril of the superseded `conversation.ts`.**
   `workspace/node.ts:20` imports it from `@isomat/host`. Extract it before
   parking conversation-replay, or the workspace build breaks.

7. **Evidence-typing has a hand-maintained mirror.** `ClaimEvidence`
   (`claim.ts:51`) is duplicated as `ManifestEvidence` (`manifest.ts:62`). The
   canonical copy is in the KEEP `claim.ts`; the mirror quarantines with the prose
   manifest. Ensure the native scene boundary re-derives evidence from the claim,
   not from the quarantined mirror.

8. **`core/timeline.ts` stays in `core` but must stay unreachable from the main
   path.** No workspace source imports it today (verified — only comments). The
   import-boundary test must forbid it going forward, or a future `fold` feature
   could quietly re-couple to the demoted timeline.

9. **Rename churn is cheap but ordering-sensitive.** `host`→`sandbox` /
   `library`→`objects` touch `workspace/node.ts` import sites and the `./node`
   subpath. Do them in S4 after the structural moves, so S2/S3 are not rebasing on
   a moving package name.
