/**
 * turn.ts — the co-edit turn (roadmap M2b).
 *
 * `runTurn(log, question, client, deps)` is the headless turn function the whole
 * milestone converges on: one natural-language turn in, a `TurnOutcome` (an
 * advanced log + an answer) out. It has exactly two paths, and which one runs is
 * the point:
 *
 *  1. The CLASSIFIER fast-path — a pure manipulation command ("set spin to 2")
 *     is a `set-input`, recognized deterministically and committed with ZERO
 *     model calls. Routing it through a model would be waste.
 *
 *  2. The AGENTIC path — everything else. The model holds the typed tools; the
 *     loop folds the live scene, hands over the brief, executes whatever tools
 *     the model calls (`runTool`, from the M2a executor), feeds the results back,
 *     and repeats until the model answers. Reads resolve against the live scene;
 *     probes fold throwaway copies; writes `commit` and advance the log — the
 *     live scene re-folds when the log changed.
 *
 * ## Where the seam is paid
 *
 * This module is the loop ↔ executor seam. It owns nothing mathematical: it
 * folds (`deps.fold`), dispatches (`runTool`), and threads the log. The evidence
 * discipline the whole project rests on is enforced HERE, structurally — an
 * answer that declares `sampled`/`exact-comparison` evidence is cross-checked
 * against the probes that actually ran (`evidenceGrounded`), so the loop cannot
 * launder a model's opinion into a proof it never probed for.
 *
 * ## Free and deterministic
 *
 * `client` is the only seam to a provider. With a `ScriptedClient` the whole
 * turn is free and reproducible — a canned move sequence is operationally a
 * replayed cassette. A real Anthropic client (M5) drops into the same seam.
 */

import type { TryFold, WorkspaceLog } from '@isomat/workspace';
import { runTool, setInput } from './tools.js';
import type { CompileFragment, SceneMap, ToolCall, ToolResult } from './tools.js';
import { SYSTEM_PROMPT, TOOL_SPECS } from './client.js';
import type { Evidence, ModelClient, ModelMessage, ToolResultMsg } from './client.js';
import { classify } from './classify.js';
import { sceneBrief } from './brief.js';

/** One executed tool call and what it returned — the turn's audit trail. */
export interface TurnStep {
  readonly call: ToolCall;
  readonly result: ToolResult;
}

/** The environment a turn folds and commits through. */
export interface TurnDeps {
  /** The disposable fold — the live scene, the probes, and the commits all use it. */
  readonly fold: TryFold;
  /** Compile + gate an authored fragment. Required only if the model authors. */
  readonly compile: CompileFragment;
}

/** The classifier fast-path resolved a manipulation, with no model call. */
export interface ManipulatedOutcome {
  readonly kind: 'manipulated';
  readonly log: WorkspaceLog;
  readonly answer: string;
  readonly modelCalls: 0;
  readonly steps: readonly TurnStep[];
}

/** The model probed and answered (possibly authoring along the way). */
export interface AgenticOutcome {
  readonly kind: 'agentic';
  readonly log: WorkspaceLog;
  readonly answer: string;
  /** The evidence the answer declares it rests on, if any. */
  readonly evidence?: Evidence;
  /** Whether that declared evidence is backed by a probe that actually ran. */
  readonly evidenceGrounded: boolean;
  readonly modelCalls: number;
  readonly steps: readonly TurnStep[];
  /** Set when the loop hit its step budget without an answer. */
  readonly truncated?: boolean;
}

export type TurnOutcome = ManipulatedOutcome | AgenticOutcome;

/** A safety rail on a runaway model, not a real limit any turn should approach. */
const MAX_ITERATIONS = 16;

/** The next conversational turn number: one past the highest act already logged. */
function nextTurn(log: WorkspaceLog): number {
  let max = -1;
  for (const act of log) if (act.turn > max) max = act.turn;
  return max + 1;
}

/**
 * The live scene = `fold(log).objects`. A committed log always folds (the
 * `commit` transaction guarantees it), so a fold failure here is an upstream
 * invariant break, not a model concern — surface it loudly.
 */
async function foldScene(fold: TryFold, log: WorkspaceLog): Promise<SceneMap> {
  const outcome = await fold(log);
  if (!outcome.ok) {
    const f = outcome.failure;
    throw new Error(
      `runTurn: the workspace log does not fold (${f.kind} at ${f.index}: ${f.message}). ` +
        `A committed log must always fold — this is an upstream invariant break.`,
    );
  }
  return outcome.workspace.objects;
}

/**
 * The evidence types a run has actually EARNED — the probes that succeeded.
 * `evalAt`/`counterfactual`/`bisectFlip` are the engine sampling live objects
 * (`sampled`); an `inspect` of a claim carries whichever evidence the claim was
 * built with. This is what an answer's declared evidence is checked against.
 */
function groundedEvidence(steps: readonly TurnStep[]): Set<Evidence> {
  const grounded = new Set<Evidence>();
  for (const step of steps) {
    if (!step.result.ok) continue;
    const tool = step.call.tool;
    if (tool === 'evalAt' || tool === 'counterfactual' || tool === 'bisectFlip') {
      grounded.add('sampled');
    } else if (tool === 'inspect') {
      const ev = (step.result.value as { evidence?: unknown }).evidence;
      if (ev === 'exact-comparison' || ev === 'sampled' || ev === 'authored-predicate') {
        grounded.add(ev);
      }
    }
  }
  return grounded;
}

/**
 * Run one co-edit turn. See the module header for the two paths and where the
 * seam is paid.
 */
export async function runTurn(
  log: WorkspaceLog,
  question: string,
  client: ModelClient,
  deps: TurnDeps,
): Promise<TurnOutcome> {
  const turn = nextTurn(log);
  let liveScene = await foldScene(deps.fold, log);

  // ── path 1: the classifier fast-path (zero model calls) ──
  const intent = classify(question, liveScene);
  if (intent) {
    const write = await setInput(log, deps.fold, { id: intent.id, value: intent.value }, { by: 'copilot', turn });
    const answer = write.result.ok
      ? `Set ${intent.label} to ${intent.value}.`
      : `Could not set ${intent.label}: ${write.result.ok ? '' : write.result.error.message}`;
    return { kind: 'manipulated', log: write.log, answer, modelCalls: 0, steps: [] };
  }

  // ── path 2: the agentic loop ──
  let current = log;
  let dirty = false;
  const steps: TurnStep[] = [];
  const messages: ModelMessage[] = [{ role: 'user', content: question }];
  let modelCalls = 0;

  for (let iter = 0; iter < MAX_ITERATIONS; iter += 1) {
    if (dirty) {
      liveScene = await foldScene(deps.fold, current);
      dirty = false;
    }

    const response = await client.respond({
      system: SYSTEM_PROMPT,
      brief: sceneBrief(liveScene),
      messages,
      tools: TOOL_SPECS,
    });
    modelCalls += 1;

    if (response.kind === 'answer') {
      const grounded = groundedEvidence(steps);
      const evidenceGrounded = response.evidence === undefined || grounded.has(response.evidence);
      return {
        kind: 'agentic',
        log: current,
        answer: response.text,
        ...(response.evidence !== undefined ? { evidence: response.evidence } : {}),
        evidenceGrounded,
        modelCalls,
        steps,
      };
    }

    // tool-calls: execute each through the M2a executor, feed results back
    messages.push({ role: 'assistant', calls: response.calls });
    const results: ToolResultMsg[] = [];
    for (const call of response.calls) {
      const out = await runTool(call, {
        scene: () => liveScene,
        log: current,
        fold: deps.fold,
        compile: deps.compile,
        attribution: { by: 'copilot', turn },
      });
      steps.push({ call, result: out.result });
      results.push({ tool: call.tool, result: out.result });
      // a committed write advances the log; the live scene is now stale
      if (out.log && out.log !== current) {
        current = out.log;
        dirty = true;
      }
    }
    messages.push({ role: 'tool', results });
  }

  // the model kept probing past the budget without answering — a rail, not a norm
  return {
    kind: 'agentic',
    log: current,
    answer: 'The turn did not reach an answer within the step budget.',
    evidenceGrounded: true,
    modelCalls,
    steps,
    truncated: true,
  };
}
