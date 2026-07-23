/**
 * anthropic.ts — the real `ModelClient` (roadmap M5d, code half).
 *
 * `turn.ts` never talks to a provider; it talks to a `ModelClient`. This is the
 * implementation that puts a real model behind that seam. Everything else in the
 * repo stays free: the loop cannot tell this from `ScriptedClient` or from a
 * replayed cassette, which is the whole point of the seam.
 *
 * ## NOT in the barrel — deliberately
 *
 * This module is reachable only as `@isomat/copilot/anthropic`, exactly like
 * `@isomat/sandbox/node`. `@isomat/web` imports the copilot BARREL, and the
 * barrel must never pull the Anthropic SDK into a browser bundle — that would
 * ship ~100KB of Node-shaped HTTP client to the page and invite putting an API
 * key in client-side code. `import-boundary.test.ts` fails the build if the web
 * app reaches this subpath.
 *
 * ## Two translations, and why neither is automatic
 *
 * 1. TOOLS. `ToolSpec.input` is an informal shorthand (`'number?'`,
 *    `'{ from: number, to: number }'`) written for a human reading the code, NOT
 *    JSON Schema. Auto-converting it would silently emit wrong schemas for the
 *    compound cases, and a wrong schema doesn't fail loudly — the model just
 *    sends malformed arguments and the turn degrades. So the schemas below are
 *    hand-written and a test asserts every `TOOL_SPECS` entry has one, which
 *    turns "someone added a tool" into a build failure instead of a silent gap.
 *
 * 2. THE ANSWER. `ModelResponse` carries an optional EVIDENCE TYPE, and the
 *    project's locked decision is that a model must not narrate an opinion as a
 *    proof. Scraping that out of prose would be exactly the laundering the
 *    design forbids, so the model finishes by CALLING an `answer` tool whose
 *    `evidence` is a closed enum. Structured, or absent — never inferred.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Json, ToolCall } from './tools.js';
import { SYSTEM_PROMPT, TOOL_SPECS } from './client.js';
import type { Evidence, ModelClient, ModelRequest, ModelResponse, ToolSpec } from './client.js';

/** The current, most capable model. Overridable per client. */
const DEFAULT_MODEL = 'claude-opus-4-8';

/**
 * Non-streaming, so keep the ceiling under the SDK's HTTP timeout. A turn's
 * moves are small — a few tool calls or a paragraph — so this is generous.
 */
const DEFAULT_MAX_TOKENS = 16_000;

// ───────────────────────────── the tool schemas ─────────────────────────────

/** The SDK's own input-schema type — a literal `type: 'object'` plus JSON Schema. */
type JsonSchema = Anthropic.Tool.InputSchema;

const str = { type: 'string' } as const;
const num = { type: 'number' } as const;

const object = (props: Record<string, unknown>, required: readonly string[]): JsonSchema => ({
  type: 'object' as const,
  properties: props,
  required: [...required],
  additionalProperties: false,
});

/**
 * Hand-written JSON Schema per tool. Keyed by `ToolCall['tool']`, so a new tool
 * that lacks an entry is a TYPE error here and a test failure in `anthropic.test.ts`.
 */
const SCHEMAS: Record<ToolCall['tool'], JsonSchema> = {
  inspect: object({ id: str }, ['id']),
  evalAt: object({ id: str, args: { type: 'array', items: num } }, ['id', 'args']),
  whyChanged: object({ id: str }, ['id']),
  counterfactual: object(
    {
      set: { type: 'array', items: object({ id: str, value: num }, ['id', 'value']) },
      read: { type: 'array', items: str },
    },
    ['set', 'read'],
  ),
  bisectFlip: object({ param: str, claim: str, lo: num, hi: num, maxProbes: num }, [
    'param',
    'claim',
    'lo',
    'hi',
  ]),
  setInput: object({ id: str, value: num }, ['id', 'value']),
  appendFragment: object({ source: str }, ['source']),
  plot: object(
    {
      text: str,
      domain: object({ from: num, to: num }, ['from', 'to']),
      id: str,
      // Free variable name → the scene id it reads live. Open-ended by nature.
      bindings: { type: 'object', additionalProperties: str },
    },
    ['text', 'domain'],
  ),
  tabulate: object({ id: str, from: num, to: num, count: num }, ['id', 'from', 'to', 'count']),
  numericEquivalence: object(
    { idA: str, idB: str, from: num, to: num, count: num, tolerance: num },
    ['idA', 'idB', 'from', 'to', 'count'],
  ),
  numericRoot: object({ id: str, from: num, to: num, count: num, tolerance: num }, [
    'id',
    'from',
    'to',
  ]),
};

/** The evidence vocabulary, as a closed enum the model must choose from. */
const EVIDENCE_VALUES: readonly Evidence[] = ['exact-comparison', 'sampled', 'authored-predicate'];

/**
 * The terminal tool. The model ends its turn by calling this rather than by
 * writing prose, so `evidence` arrives as data instead of being inferred from
 * wording — see the header.
 */
const ANSWER_TOOL = {
  name: 'answer',
  description:
    'Give the final answer and end the turn. Call this exactly once, when probing is done. ' +
    'Set `evidence` ONLY to the type a probe actually returned this turn — omit it if no probe ' +
    'backs the answer. Sampled agreement is never a proof; say so in the text when it applies.',
  input_schema: object(
    {
      text: { type: 'string', description: 'The answer, in prose, for the user.' },
      evidence: {
        type: 'string',
        enum: [...EVIDENCE_VALUES],
        description: 'How the answer is grounded. Omit when no probe backs it.',
      },
    },
    ['text'],
  ),
} as const;

const toolParam = (spec: ToolSpec) => ({
  name: spec.name,
  description: spec.description,
  input_schema: SCHEMAS[spec.name],
});

/** Exposed for the coverage test: every offered tool must have a schema. */
export const schemaFor = (name: ToolCall['tool']): JsonSchema | undefined => SCHEMAS[name];

// ──────────────────────────── request translation ────────────────────────────

/**
 * The running thread → Anthropic messages.
 *
 * Two shapes matter. An assistant turn that called tools must be replayed as
 * `tool_use` blocks with the SAME ids the results reference, and all results for
 * one assistant turn must come back in ONE user message — splitting them across
 * messages teaches the model to stop calling tools in parallel.
 *
 * Our `ModelMessage` carries no ids (the loop pairs by position), so ids are
 * synthesized deterministically from the turn index. Deterministic matters: a
 * cassette recorded today must replay byte-identically tomorrow.
 */
function toMessages(req: ModelRequest): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  let turn = 0;

  for (const msg of req.messages) {
    if (msg.role === 'user') {
      out.push({ role: 'user', content: msg.content });
      continue;
    }

    if (msg.role === 'assistant') {
      const index = turn++;
      out.push({
        role: 'assistant',
        content: msg.calls.map((call, i) => ({
          type: 'tool_use' as const,
          id: callId(index, i),
          name: call.tool,
          input: inputOf(call),
        })),
      });
      continue;
    }

    // Tool results pair positionally with the assistant turn just emitted.
    const index = turn - 1;
    out.push({
      role: 'user',
      content: msg.results.map((r, i) => ({
        type: 'tool_result' as const,
        tool_use_id: callId(index, i),
        content: JSON.stringify(r.result.ok ? r.result.value : r.result.error),
        is_error: !r.result.ok,
      })),
    });
  }

  return out;
}

const callId = (turn: number, i: number): string => `toolu_${turn}_${i}`;

/** A `ToolCall` minus its discriminant — the argument object the API wants. */
function inputOf(call: ToolCall): Record<string, unknown> {
  const { tool: _tool, ...rest } = call as unknown as Record<string, unknown> & { tool: string };
  return rest;
}

// ──────────────────────────── response translation ────────────────────────────

function toResponse(message: Anthropic.Message): ModelResponse {
  const toolUses = message.content.filter(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  );

  const answer = toolUses.find((b) => b.name === ANSWER_TOOL.name);
  if (answer) {
    const input = (answer.input ?? {}) as { text?: unknown; evidence?: unknown };
    const evidence = EVIDENCE_VALUES.find((e) => e === input.evidence);
    return {
      kind: 'answer',
      text: typeof input.text === 'string' ? input.text : '',
      // Only a value from the closed enum survives; anything else is dropped
      // rather than passed through as an unearned evidence claim.
      ...(evidence ? { evidence } : {}),
    };
  }

  const probes = toolUses.filter((b) => b.name !== ANSWER_TOOL.name);
  if (probes.length > 0) {
    return {
      kind: 'tool-calls',
      calls: probes.map((b) => ({ tool: b.name, ...(b.input as object) }) as ToolCall),
    };
  }

  // The model wrote prose and stopped without calling `answer`. Take the text as
  // the answer, but declare NO evidence — nothing structured backs it.
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  return { kind: 'answer', text };
}

// ────────────────────────────────── the client ──────────────────────────────────

export interface AnthropicClientOpts {
  /** Defaults to `claude-opus-4-8`. */
  readonly model?: string;
  readonly maxTokens?: number;
  /**
   * Pass a pre-built SDK client to control auth, base URL, or retries. Omit and
   * one is constructed from the ambient credentials the SDK resolves.
   */
  readonly sdk?: Anthropic;
}

/**
 * The billed client. Constructing it costs nothing; only `respond` spends money.
 *
 * Adaptive thinking is on: `claude-opus-4-8` runs WITHOUT thinking when the
 * field is omitted, and a workspace probe loop is exactly the multi-step
 * reasoning it helps. `budget_tokens` and the sampling parameters are not passed
 * — they are rejected on this model.
 */
export class AnthropicClient implements ModelClient {
  private readonly sdk: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(opts: AnthropicClientOpts = {}) {
    this.sdk = opts.sdk ?? new Anthropic();
    this.model = opts.model ?? DEFAULT_MODEL;
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  async respond(req: ModelRequest): Promise<ModelResponse> {
    const message = await this.sdk.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      thinking: { type: 'adaptive' },
      // The brief is the scene manifest for THIS turn, so it belongs with the
      // system prompt rather than in the thread — it describes the world the
      // tools act on, not something the user said.
      system: `${req.system ?? SYSTEM_PROMPT}\n\n${req.brief}`,
      tools: [...req.tools.map(toolParam), ANSWER_TOOL],
      messages: toMessages(req),
    });

    if (message.stop_reason === 'refusal') {
      return {
        kind: 'answer',
        text: 'The model declined to answer this request.',
      };
    }

    return toResponse(message);
  }
}

/** The tool list this client offers, for tests and for a recorder's manifest. */
export const OFFERED_TOOLS = (): readonly unknown[] => [
  ...TOOL_SPECS.map(toolParam),
  ANSWER_TOOL,
];

export type { Json };
