# M5 — Integrated co-edit workspace + probe toolset (file-level plan)

> Status: **planning (2026-07-23).** Roadmap milestone M5 — the Phase-1
> convergence goal. Executed by subagents, one stage per commit, each ending green
> in the cheap tier (`./run.sh test` + `./run.sh typecheck`). Grounded in the M5
> discovery pass against HEAD `ea17e45` (403 tests). **All of M5a–M5c runs FREE**
> (headless, `ScriptedClient`). **M5d is BILLED and GATED on explicit user
> approval** — the one real-Claude flagship cassette.

## What M5 adds
1. Four probe tools — `plot`, `tabulate`, `numericEquivalence`, `numericRoot` — each
   returns TYPED EVIDENCE, none certify.
2. The canonical interaction end-to-end: *"is d/dx of f equal to g?"* → the LLM
   supplies the derivative (fallibly) → the engine samples numerically → **`sampled`**
   evidence, never "proven." The engine catches a wrong derivative.
3. The symmetric-log hammer: 100+ interleaved acts from both authors through one
   foldable log, deterministic, no half-apply, `M.byId` robust.
4. (BILLED, GATED) a real Anthropic client behind the `ModelClient` seam + a cassette
   record/replay harness + one captured flagship cassette.

## Hard constraints (do not violate)
- **No CAS.** `packages/parse/src/fence.test.ts` bans importing `derivative`/
  `simplify`/… from mathjs. `numericEquivalence`/`numericRoot` **only sample** — the
  LLM supplies the derivative as TEXT; the engine never differentiates. `ast.ts`'s
  `toJs` already throws on any non-arithmetic node (second layer of the same line).
- **The import fence.** `packages/workspace/src/import-boundary.test.ts` — `copilot`
  and `parse` are main-path + workspace-facing. `calculus` and `interaction` are
  banned basenames everywhere: a numeric-root/derivative probe **cannot** live in or
  import a file named `calculus.ts`. No `@isomat/cell` / playback imports.
- **Numeric eval stays in the sandbox** (M3's design): mathjs parses, QuickJS
  evaluates. A `plot`-from-text tool routes through `introduceExpr` → fold; sampling
  a live `fn` uses the object's own authored `at` closure (the `evalAt` seam).
- **Evidence discipline is structural.** A `sampled` answer must be grounded by a
  probe that actually sampled (`groundedEvidence`, turn.ts:117-132). The four new
  tools join the `sampled`-yielding set.

---

## Stage M5a — the four probe tools (`copilot`) — FREE
All four attach to `packages/copilot/src/tools.ts` at the four coordinated points the
discovery found: the `ToolCall` union (tools.ts:88-102), a `ToolErrorCode` if needed
(tools.ts:58-72), a new executor fn, and a `runTool` switch arm (tools.ts:677-709).
Plus `TOOL_SPECS` (client.ts:115-151), `SYSTEM_PROMPT` (client.ts:159-165), the
`groundedEvidence` extension (turn.ts:122), and the barrel (index.ts:18-42).

Tool contracts (camelCase names to match the existing `evalAt`/`setInput`/`bisectFlip`
convention; the roadmap's kebab `numeric-equivalence` is the concept name):

- **`plot(text, domain, id?)`** — WRITE. The model supplies math TEXT (e.g. its
  derivative candidate); the engine `introduceExpr(text, …)` → `commit` an
  `IntroduceAct` → a live plotted `fn`. This is the parse-gated "model supplies text,
  engine compiles" boundary (complements `appendFragment`'s raw-js author). Result
  `{ id, sampled: [[x,y],…] }`; evidence `sampled`. Mirrors the `appendFragment` write
  path (tools.ts:622-648) for the commit + `introduceExpr` (introduce.ts:46) for the
  act.
- **`tabulate(id, from, to, count)`** — READ. Sample a live `fn`'s `at` at `count`
  points across `[from,to]`; result `{ rows: [[x,y],…] }`; evidence `sampled`. Mirrors
  `evalAt`'s `at.call(h, x)` sampling (tools.ts:301-302); pure read, live scene never
  moves.
- **`numericEquivalence(idA, idB, from, to, count, tolerance?)`** — READ. Sample both
  live `fn`s at `count` points; `equivalent = max|a−b| ≤ tolerance` (default a small
  epsilon). Result `{ equivalent, maxAbsDiff, points, tolerance }`; evidence
  `sampled`. **Never certifies** — the answer must be phrased as sampled. This is the
  engine that catches a wrong LLM derivative.
- **`numericRoot(id, from, to, count?, tolerance?)`** — READ. Scan `[from,to]` for a
  sign change in the `fn`'s `at`, then bisect to a root. Result `{ root | null,
  bracket }`; evidence `sampled`. Mirrors `bisectFlip`'s bracket-search skeleton
  (tools.ts:525-571) but on a numeric value, not a claim verdict.

Evidence grounding: extend turn.ts:122 so `plot | tabulate | numericEquivalence |
numericRoot` all add `'sampled'` to the grounded set (all four sample numerically).

Tests: `tools.test.ts` (rules tier — arg validation, error codes) + `tools.workspace.
test.ts` (real QuickJS — each new tool against a folded workspace; the live scene
never moves under the reads; `plot` commits and advances the log). Assert
`numericEquivalence` reports `equivalent:false` with a real `maxAbsDiff` for a
mismatched pair.

**Exit:** green; four tools dispatch, return typed `sampled` evidence, and the
grounding check accepts them.

## Stage M5b — the canonical evidence flow (`copilot`) — FREE
A turn-level integration test (extend `turn.test.ts` scaffolding: `START`/`compile`/
`deps`/`idByLabel`/`ScriptedClient`, turn.test.ts:23-57). Two scripted turns:

- **Correct path:** question "is d/dx of f equal to g?" → the model `plot`s its
  (correct) derivative candidate as a live `fn` → `numericEquivalence(candidate, g,…)`
  → the probe returns `equivalent:true` → the model answers with `evidence:'sampled'`,
  phrased as *sampled agreement, not a proof*. Assert `out.evidence === 'sampled'`,
  `out.evidenceGrounded === true`, and the probe result provably fed back (`onRequest`).
- **Wrong-derivative path (the load-bearing negative):** the model `plot`s a WRONG
  derivative → `numericEquivalence` returns `equivalent:false` with a real
  `maxAbsDiff` → the correct behavior is the model does NOT claim equivalence. Pins
  "the engine catches the model's fallible math." Assert the sampled result
  contradicts any equivalence claim.

**Exit:** green; the canonical flow is `sampled`-evidenced and never certifies; the
engine surfaces a wrong derivative.

## Stage M5c — the symmetric-log hammer (`copilot`) — FREE
A new integration test file (e.g. `session.workspace.test.ts`) driving 100+ interleaved
acts, both authors, through one foldable log. Reuse `turn.test.ts` scaffolding + the
log-threading pattern (thread each `runTurn`'s `out.log` into the next).
- Interleave: user `introduceExpr` acts (`by:'user'`), user drags (classifier fast-path
  `set-input`), user `edit-span`/`move`/`retire` (M4 verbs), and copilot agentic turns
  (probe → author/`plot` → arrange) via `ScriptedClient`.
- Accumulate 100+ acts across many objects.
- Assert: `fold(finalLog)` is deterministic — re-fold yields identical ids (the
  cassette property, fold.sandbox.test.ts:229 pattern); no half-apply (a rejected turn
  leaves the log intact); `byId` resolves every live object; a checkpoint compaction
  (M4 `everyNActs`) over the long log preserves the fold.

**Exit:** green; a full multi-object both-authors session folds deterministically at
scale, exercising every verb + probe.

## Stage M5d — real Anthropic client + cassette + flagship session — **BILLED, GATED**
**Do NOT start without explicit user approval.** Needs an API key and adds an SDK
dependency; it is the one billed path in the repo. Split:
- **M5d-code (free, buildable without a key):** a cassette record/replay harness —
  record `(ModelRequest → ModelResponse)` pairs to a fixture, replay them free like
  `ScriptedClient` (mirror client.ts:82-107). A replay test over a hand-authored
  fixture cassette proves the seam with zero billing.
- **M5d-billed (gated):** install `@anthropic-ai/sdk`, a real `AnthropicClient`
  implementing `ModelClient.respond` (translate `ModelRequest` → Messages API with
  `system`/`tools=TOOL_SPECS`/message thread, and `stop_reason` → `ModelResponse`),
  wire the key, run ONE `record`-style session → capture the flagship cassette. Use
  the latest model (see the `claude-api` skill / CLAUDE.md model IDs). **Ask first;
  report the expected cost before running.**

**Exit (roadmap M5):** the headless integration test (M5a-c) is green + deterministic;
the flagship cassette is captured (M5d, once approved) and replays free forever.

---

## Stage ordering & isolation
- **M5a first** (the tools everything else drives).
- **M5b + M5c** both depend on M5a and add disjoint test files — can run in parallel,
  commit by path.
- **M5d** is gated: after M5a-c land green, STOP and ask the user before any billed
  step. Build M5d-code free if desired; run M5d-billed only on explicit approval with
  a key.

Each free stage: subagent implements against this doc → `./run.sh typecheck` +
`./run.sh test` green → review the diff → commit `M5x: …`. Milestone closes (its
headless half) with the roadmap M5 status block updated; the billed cassette is noted
as the remaining gated step.
