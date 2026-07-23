# isomat — working notes

**What it is:** a lean **co-edit math workspace** substrate. `fold(log) → Workspace`
— a positioned set of live math objects an LLM and a user co-edit — **not** a lesson
you play. Intended as the math↔LLM foundation the sibling projects (`qed`,
`undergrad`) build on. Design origin: math-ai's `docs/projects/mathcopilot.md` (the
"one deletion + one generalization" reframe: delete timeline-as-root, generalize a
lesson log into an authorship-tagged co-edit log).

## Node is not on PATH
node/pnpm live under nvm. **Use `./run.sh <cmd>`** (`test`, `typecheck`, `install`).
A bare `pnpm`/`tsc` fails with "command not found".

## Testing — the cheap tier is the whole loop
```
./run.sh test        # vitest, headless, ~1.4s, 343 tests
./run.sh typecheck   # strict tsc --noEmit, 6 packages
```
Everything is provable headless. There is **no browser gate** (the lesson engine's
`verify`/`remount`/`gate` and all billed paths were pruned in Stabilize). No API
key, no billed path exists in the repo today.

## The package DAG — acyclic, depth 3
```
core → substrate / sandbox / objects → workspace → copilot / parse   ← the product path
cell/    ← ALL demoted playback, OFF the main DAG (nothing on the path imports it)
```
- **core** — identity/stable-ids, reactive graph (`Slot`/`Derived`/`Collection`/
  `Incremental`), correspondence graph, world, provenance. `timeline.ts` lives here
  but is **unreachable from the workspace path** (fence-guarded; keep it out of
  core's public barrel).
- **substrate** — shared leaf types (`Live`, `NumericHandle`, `VarySettable`,
  `Verdict`, `Polarity`).
- **sandbox** (was `host`) — QuickJS bridge/prelude/budget/lint/guest-error. Builds
  on `core` alone. (The parked `tools.ts` + `conversation.ts` are **gone** as of
  M2a: the executor moved to `copilot/` retargeted onto `workspace`; `conversation.ts`
  was superseded by `workspace` and deleted.)
- **objects** (was `library` + the kept `render` views) — the native primitives,
  their views, `formula`/`expr`, and the timeline-free `scene.ts`.
- **workspace** — the pivot: the `WorkspaceAct` log, `fold(log) → Workspace`, and
  the one-transaction `commit`. The keeper this whole project is built around.
- **copilot** (M2) — the workspace as an instrument. **M2a:** the 4c tool executor
  (`inspect`/`evalAt`/`whyChanged`/`counterfactual`/`bisectFlip`/`setInput`/
  `appendFragment`/`runTool`) retargeted onto `WorkspaceLog`/`commit`. **M2b:** the
  loop — `runTurn(log, question, client, deps)` with a deterministic classifier
  fast-path (zero model calls), the `ModelClient` seam + free `ScriptedClient` fake,
  the `sceneBrief` manifest, and structural evidence-grounding. Both **done**.
- **parse** (M3) — the parser front door: `parseExpr(text)` → TeX + addressable span
  tree + emitted sandbox sampler; `introduceExpr(...)` → an `IntroduceAct` the fold
  runs in QuickJS (numeric eval stays in the sandbox). mathjs is walled behind
  `mathjs.ts` (imports only `parse`); `fence.test.ts` is the no-CAS guard. **Done**;
  `edit-span` deferred to M4.
- **cell/** (quarantine) — lesson verbs, morph, player/segments/events, prose
  manifest, playback-only views. Kept building + tested, but **off the DAG**.

## The native authoring vocabulary
A guest **author-act fragment** calls these as **bare globals** (no `M`/`View`/
`lesson` namespaces): `expr` `span` `param` `derive` `plot` `readout` `claim`
`link` `note` `byId`. No discipline libraries, **no CAS**. Objects **auto-register
on construction** — there is no `show`/`place`/`expose` verb; the scene reads
`stage.registered` + `stage.views`, never the timeline. `plot` is **numeric-rule-only
until M3's parser**; `expr`/`claim` register but their views materialize **lazily**
(errors-as-data — don't evaluate predicates at construction).

## The fence — do not weaken it
`packages/workspace/src/import-boundary.test.ts` fails the build if any main-path
source imports `cell/`, a playback module (`timeline`/`player`/`lesson`/`morph`/…),
or a shed discipline. This test is what keeps isomat from drifting back into a
lesson engine. If you find yourself wanting something from `cell/`, that's a signal
to reconsider, not to relax the fence.

## Status (2026-07-23)
**M0** (substrate lift), **M1** (`workspace` fold), **Stabilize** (decouple from
math-ai's lesson concepts), **M2** (copilot — **M2a** executor ↔ workspace seam +
**M2b** the loop, classifier, `ModelClient` seam / `ScriptedClient` fake), **M3**
(the `parse` front door — mathjs walled to `parse`-only, `introduceExpr` → sandbox
fold, no-CAS fence), and **M4** (spatial verbs `move`/`retire`/`replace`/`edit-span`
+ real checkpoint compaction + `scopedManifest`) are all **DONE and committed**.
**M5** (probe toolset + convergence — **M5a** `plot`/`tabulate`/`numericEquivalence`/
`numericRoot`, **M5b** the canonical *"is d/dx of f = g?"* sampled-evidence flow,
**M5c** the 113-act both-authors symmetric-log hammer) is **headless-half DONE and
committed**; only **M5d** (the billed real-Claude flagship cassette) remains, GATED on
explicit approval. Green: typecheck 8/8, **421 tests**. Working tree clean. No API key
/ SDK / billed path exists in the repo today — everything so far runs free.

**M4 shape to know:** `fold(log)` is now **two-pass** — a resolve pass collapses each
introduced id to its FINAL definition (so `replace`/`edit-span` supersede in place,
never a second mint against the single-assignment id registry), then the walk mints
each id once. `replace`/`edit-span` target an **introduced** id only; `edit-span`
edits top-level additive terms in mathjs SOURCE (field `text`) via an injected
`SpanResolver` (`@isomat/parse`'s `resolveSpan`; `workspace` never imports `parse`).
Checkpoint `everyNActs(n)` collapses a prefix into one synthesized `author` act by
replaying each object's **source** (guest closures aren't serializable) + a bounded
`move`/`retire` projection tail; `fold(compacted) === fold(original)`.

## The plan
- `docs/roadmap.md` — the living plan. **Read it first.** M0/M1/Stabilize/M2/M3/M4
  are marked done; M5d + Phase 2 (the web app, W0–W4) are ahead.
- `docs/m4-plan.md` — the executed file-level M4 plan (spatial verbs + manifest).
- `docs/stabilize-plan.md` — the executed file-level Stabilize demolition plan.

**NEXT: M5d** — the one remaining M5 step, **BILLED and GATED**. M5a–c (the probe
toolset + the canonical sampled-evidence flow + the symmetric-log hammer) are DONE and
committed; the headless Phase-1 exit is met. M5d is the flagship real-Claude cassette:
a real `AnthropicClient` behind the existing `ModelClient` seam + a cassette record/
replay harness (the free `M5d-code` half is buildable without a key; a fixture replay
proves the seam), then ONE billed `record`-style session captured as the cassette
(replayed free forever after). **No API key / SDK / billed path exists in the repo —
building the SDK client and running the session both need explicit user approval.** See
roadmap M5 + `docs/m5-plan.md` M5d.

**ALSO NEXT — Phase 2 (the web app), and it is NOT blocked by M5d.** Decision #4 (UI
stack) was **resolved 2026-07-23**: **React + Vite SPA, client-only, React-native
views** (roadmap decisions #5–#7). W0 (stand up `packages/web`, fold a hardcoded log
in-browser) can start today; only **W3** (the in-app LLM turn loop) waits on M5d. See
roadmap "Phase 2 — the web app", milestones W0–W4.

## Phase 2 — what to know before touching the web app
**The engine does not change.** `core`/`substrate`/`objects`/`sandbox`/`workspace`/
`parse`/`copilot` run in the browser as-is: the QuickJS host already builds its context
from the single-file wasm variant, and `sandbox/node.ts` is the only Node-specific
module — **it must stay out of the bundle**. The app is a shell, not a port. Client-only
is the stateless-POC decision honoured literally: no server, no session, static deploy.

**The decision-#7 trap — do not fall into it.** "Rebuild views as React components"
means replace **only** the DOM half. `View` splits model from DOM: constructors build
handles/subscriptions (node-testable), and `render(doc)` is a `protected abstract`
called **only** by `mount()`. The view *models* stay, because `sceneIndex(stage)`
(`objects/src/scene.ts`) builds `Workspace.objects` — what every copilot tool resolves
against and what `sceneBrief`/`scopedManifest` scope — from `stage.registered` **plus
`stage.views` and each `v.elements`**. Delete the view objects and the LLM silently
loses addressable handles; nothing errors, the manifest just shrinks. So: **construct
views as today, never call `mount()`**, and let React render from the same live objects.
W1 carries a guard test pinning `Workspace.objects` identical with and without the app.

**The reactive bridge.** `Slot`/`Collection`/`Derived`/`Incremental` all expose
`subscribe(fn) → Unsubscribe` — exactly `useSyncExternalStore`'s shape. But `Live<T>`
guarantees only `.value` (it extends `Handle`), so `useLive` must pull `.value` and
subscribe only where the backing node supports it.

**The cheap tier stays the loop.** React components are testable headless (jsdom +
Testing Library) against the same folded workspaces. Reserve a real browser only for the
wasm-boot smoke test — no browser on the critical path, same as Phase 1.

## Locked decisions
- **No CAS.** The LLM reasons (fallibly); the engine makes math manipulable/visible/
  probeable; claims are **evidence-typed** (`exact-comparison`/`sampled`/
  `authored-predicate`) so a model can't narrate an opinion as a proof.
- **Stateless POC** — the workspace is `fold(log)`; no server session. Phase 2's
  client-only web app (decision #6) is this decision carried into the browser: a
  key-holding proxy would be the first thing forcing a server — defer it to W3.
- **UI stack (decisions #5–#7, 2026-07-23)** — **React + Vite SPA**, **client-only**,
  **React-native views over kept view models**. Supersedes decision #4's deferral.
- **Shed, don't hoard** — discipline libraries and lesson concepts were deleted
  deliberately. Don't reintroduce them to "restore coverage"; add coverage the lean
  substrate can express.
- **Commit straight to `main`** — no feature branches, no PRs.
- Milestones are run by subagents against a written plan, each ending green in the
  cheap tier, committed per milestone; big/destructive milestones get a read-only
  discovery pass first (map the dependency cascade before deleting green code).
