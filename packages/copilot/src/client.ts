/**
 * client.ts — the model seam (roadmap M2b).
 *
 * The loop driver (`turn.ts`) never talks to a provider directly; it talks to a
 * `ModelClient`. That one seam is what keeps M2b free and deterministic — the
 * `ScriptedClient` below returns a CANNED sequence of moves, operationally
 * identical to a replayed cassette, so a whole agentic turn runs headless with
 * zero billed calls. A real Anthropic client (M5) implements the same interface
 * and drops in unchanged; the shapes here are deliberately the tool-use API's
 * shapes (a response is either "call these tools" or "here is the final answer",
 * matching `stop_reason: 'tool_use'` vs `'end_turn'`).
 *
 * The message thread the loop hands back is the real one: user question, then
 * alternating assistant-tool-calls / tool-results as the loop executes them. A
 * scripted client may ignore it or assert on it (via `onRequest`) — the latter
 * is how a test proves the executor's results actually reached the "model".
 */

import type { ClaimEvidence } from '@isomat/objects';
import type { Json, ToolCall, ToolResult } from './tools.js';

/**
 * How an answer is grounded. Reuses the engine's own claim vocabulary — the
 * whole point of the no-CAS line is that a model reports the evidence a probe
 * returned rather than narrating an opinion as a proof. Probe tools
 * (`evalAt`/`counterfactual`/`bisectFlip`) yield `sampled`; a claim inspect
 * carries whichever of the three the claim was built with.
 */
export type Evidence = ClaimEvidence;

/** One tool the model is offered — name, prose, and an opaque input schema. */
export interface ToolSpec {
  readonly name: ToolCall['tool'];
  readonly description: string;
  /** JSON-schema-ish; opaque to the loop, carried through for the real client. */
  readonly input: Json;
}

/** One tool's outcome as it goes back to the model. */
export interface ToolResultMsg {
  readonly tool: ToolCall['tool'];
  readonly result: ToolResult;
}

/** The running thread. Grows as the loop executes the model's tool calls. */
export type ModelMessage =
  | { readonly role: 'user'; readonly content: string }
  | { readonly role: 'assistant'; readonly calls: readonly ToolCall[] }
  | { readonly role: 'tool'; readonly results: readonly ToolResultMsg[] };

/** What the loop hands the model each iteration. */
export interface ModelRequest {
  readonly system: string;
  /** The scene brief — what the manifest offers this turn (see `brief.ts`). */
  readonly brief: string;
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ToolSpec[];
}

/**
 * The model's next move: probe further, or answer. An answer may declare the
 * evidence it rests on; the loop checks that declaration against the probes
 * that actually ran (`turn.ts`'s `evidenceGrounded`).
 */
export type ModelResponse =
  | { readonly kind: 'tool-calls'; readonly calls: readonly ToolCall[] }
  | { readonly kind: 'answer'; readonly text: string; readonly evidence?: Evidence };

export interface ModelClient {
  respond(req: ModelRequest): Promise<ModelResponse> | ModelResponse;
}

/**
 * A canned client: return a fixed sequence of moves, one per `respond` call.
 * This is the free, deterministic stand-in for a recorded cassette — the loop
 * cannot tell it from a replayed real session, which is exactly why M2b proves
 * the loop ↔ executor seam without a billed call.
 *
 * `onRequest` lets a test observe each request the loop built — the surest proof
 * that the executor's tool results were fed back to the "model" verbatim.
 */
export class ScriptedClient implements ModelClient {
  private cursor = 0;
  constructor(
    private readonly script: readonly ModelResponse[],
    private readonly opts?: { readonly onRequest?: (req: ModelRequest, index: number) => void },
  ) {}

  respond(req: ModelRequest): ModelResponse {
    this.opts?.onRequest?.(req, this.cursor);
    const next = this.script[this.cursor];
    if (!next) {
      throw new Error(
        `ScriptedClient exhausted: the loop asked for move #${this.cursor + 1}, but the script ` +
          `has ${this.script.length}. A turn that keeps probing past the script means the canned ` +
          `answer never arrived — add the terminating { kind: 'answer' } move.`,
      );
    }
    this.cursor += 1;
    return next;
  }

  /** How many moves the loop has drawn — i.e. the model-call count. */
  get calls(): number {
    return this.cursor;
  }
}

/**
 * The tools the model holds. Data, not behavior — the loop dispatches by
 * `ToolCall['tool']` through `runTool`; these specs are what a real client would
 * send as the `tools` array. Kept terse and honest: every one probes, reads,
 * folds, or commits — none computes mathematics.
 */
export const TOOL_SPECS: readonly ToolSpec[] = [
  {
    name: 'inspect',
    description: "The full structured value of one object by id — a claim's verdict + evidence type, a parameter's value + range, a scalar's value.",
    input: { id: 'string' },
  },
  {
    name: 'evalAt',
    description: 'Sample a plotted fn at a coordinate x. The engine runs the object\'s own rule; never compute this yourself.',
    input: { id: 'string', args: 'number[]' },
  },
  {
    name: 'whyChanged',
    description: 'The dependency path from a derived value or claim verdict back to the root inputs — causality read off the reactive graph.',
    input: { id: 'string' },
  },
  {
    name: 'counterfactual',
    description: 'Set some inputs to hypothetical values, fold a throwaway copy, and read requested objects there. Nothing on screen moves; the answer is engine-grounded (evidence: sampled).',
    input: { set: '{ id: string, value: number }[]', read: 'string[]' },
  },
  {
    name: 'bisectFlip',
    description: "Binary-search the parameter value where a claim's verdict flips — the exact threshold, one throwaway fold per probe (evidence: sampled).",
    input: { param: 'string', claim: 'string', lo: 'number', hi: 'number', maxProbes: 'number?' },
  },
  {
    name: 'setInput',
    description: 'Commit a set on an interaction-mutable object. Advances the log; a bad target is rejected verbatim.',
    input: { id: 'string', value: 'number' },
  },
  {
    name: 'appendFragment',
    description: 'Author new objects: gate + commit a program fragment that reaches earlier objects only by id (byId). A gate rejection comes back as your retry brief.',
    input: { source: 'string' },
  },
];

/**
 * The role brief. States the standing division of labour (the model reasons; the
 * engine probes; claims are evidence-typed) so a real client narrates from the
 * tool results rather than from memory. The scripted client ignores it; it is
 * built anyway because it is the real seam and a test asserts on it.
 */
export const SYSTEM_PROMPT = [
  'You co-edit a live math workspace with a user. You CANNOT compute mathematics yourself —',
  'use the tools to probe the actual live objects, which the engine evaluates exactly.',
  'Claims carry an evidence type: exact-comparison, sampled, or authored-predicate. Never',
  'present a sampled agreement or an authored predicate as a proof — report the evidence the',
  'engine returned. Reach objects only by the ids the scene brief offers.',
].join(' ');
