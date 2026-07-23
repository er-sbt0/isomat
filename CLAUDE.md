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
core → substrate / sandbox / objects → workspace → copilot    ← the product path
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
math-ai's lesson concepts), and **M2** (copilot — **M2a** executor ↔ workspace seam
+ **M2b** the loop, classifier, `ModelClient` seam / `ScriptedClient` fake) are all
**DONE and committed**. Green: typecheck 7/7, **347 tests**. Working tree clean.
The one billed real-Claude session is deferred to M5 (flagship cassette); everything
M2 proves runs free with the scripted fake client.

## The plan
- `docs/roadmap.md` — the living plan. **Read it first.** Milestones M0/M1/Stabilize
  are marked done; M2–M5 + Phase 2 (UI) are ahead.
- `docs/stabilize-plan.md` — the executed file-level Stabilize demolition plan.

**NEXT: M3** — the parser front door (`packages/parse`): mathjs for parse + numeric
eval, wrapped into an addressable span tree (target shape = `objects/formula.ts`'s
`F.tex` spans), with the symbolic/simplify APIs **fenced off** (the no-CAS line). Adds
the `introduce` act (LaTeX → live object) and `edit-span` (in-place term edit). The
riskiest new seam — watch for parser scope-creep toward a CAS; the fence test is the
mitigation. See roadmap M3. (M2's real-Claude cassette is deferred to M5.)

## Locked decisions
- **No CAS.** The LLM reasons (fallibly); the engine makes math manipulable/visible/
  probeable; claims are **evidence-typed** (`exact-comparison`/`sampled`/
  `authored-predicate`) so a model can't narrate an opinion as a proof.
- **Stateless POC** — the workspace is `fold(log)`; no server session.
- **Shed, don't hoard** — discipline libraries and lesson concepts were deleted
  deliberately. Don't reintroduce them to "restore coverage"; add coverage the lean
  substrate can express.
- **Commit straight to `main`** — no feature branches, no PRs.
- Milestones are run by subagents against a written plan, each ending green in the
  cheap tier, committed per milestone; big/destructive milestones get a read-only
  discovery pass first (map the dependency cascade before deleting green code).
