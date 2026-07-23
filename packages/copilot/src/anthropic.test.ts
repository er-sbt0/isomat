/**
 * anthropic.test.ts — the real client's translation, proven WITHOUT a billed call.
 *
 * `AnthropicClient` takes an injected SDK, so the entire request/response
 * translation is testable against a stub. That matters more than convenience:
 * the translation is where this client can be wrong in ways that cost money to
 * discover — a malformed schema doesn't error, the model just sends arguments
 * the executor rejects, and you find out during a paid session.
 *
 * Nothing here contacts Anthropic. No API key is read, and none is needed.
 */

import { describe, expect, it, vi } from 'vitest';
import { TOOL_SPECS } from './index.js';
import type { ModelRequest } from './index.js';
import { AnthropicClient, schemaFor } from './anthropic.js';

/** A stub standing in for `Anthropic` — records params, returns a canned message. */
function stubSdk(content: unknown[], stopReason = 'tool_use') {
  const create = vi.fn(async (_params: Record<string, unknown>) => ({
    content,
    stop_reason: stopReason,
  }));
  return { sdk: { messages: { create } } as never, create };
}

const request = (over: Partial<ModelRequest> = {}): ModelRequest => ({
  system: 'SYSTEM',
  brief: 'BRIEF',
  messages: [{ role: 'user', content: 'is d/dx of f equal to g?' }],
  tools: TOOL_SPECS,
  ...over,
});

describe('tool schemas', () => {
  it('every offered tool has a hand-written schema', () => {
    // The guard that turns "someone added a tool" into a build failure rather
    // than a silent gap the model discovers mid-session.
    for (const spec of TOOL_SPECS) {
      const schema = schemaFor(spec.name);
      expect(schema, `no JSON Schema for tool "${spec.name}"`).toBeDefined();
      expect(schema).toMatchObject({ type: 'object', additionalProperties: false });
    }
  });

  it('compound inputs are real schemas, not the shorthand DSL', () => {
    // `ToolSpec.input` says `'{ from: number, to: number }'` — prose, not schema.
    // This is the case a naive auto-translation would get wrong.
    const plot = schemaFor('plot') as { properties: Record<string, unknown> };
    expect(plot.properties.domain).toMatchObject({
      type: 'object',
      properties: { from: { type: 'number' }, to: { type: 'number' } },
      required: ['from', 'to'],
    });
    const counterfactual = schemaFor('counterfactual') as { properties: Record<string, unknown> };
    expect(counterfactual.properties.set).toMatchObject({ type: 'array' });
  });

  it('optional inputs are absent from `required`, not typed away', () => {
    const bisect = schemaFor('bisectFlip') as { required: string[] };
    expect(bisect.required).toContain('lo');
    expect(bisect.required).not.toContain('maxProbes'); // `'number?'` in the DSL
  });
});

describe('request translation', () => {
  it('sends the model, adaptive thinking, and no sampling parameters', async () => {
    const { sdk, create } = stubSdk([{ type: 'text', text: 'hi' }], 'end_turn');
    await new AnthropicClient({ sdk }).respond(request());

    const params = create.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(params.model).toBe('claude-opus-4-8');
    expect(params.thinking).toEqual({ type: 'adaptive' });

    // These are REJECTED on this model — sending any of them is a 400.
    expect(params).not.toHaveProperty('temperature');
    expect(params).not.toHaveProperty('top_p');
    expect(params).not.toHaveProperty('top_k');
    expect(params).not.toHaveProperty('budget_tokens');
  });

  it('offers every tool plus the terminal `answer` tool', async () => {
    const { sdk, create } = stubSdk([{ type: 'text', text: 'hi' }], 'end_turn');
    await new AnthropicClient({ sdk }).respond(request());

    const params = create.mock.calls[0]![0] as unknown as { tools: Array<{ name: string }> };
    const names = params.tools.map((t) => t.name);
    for (const spec of TOOL_SPECS) expect(names).toContain(spec.name);
    expect(names).toContain('answer');
  });

  it('carries the scene brief in the system prompt, not the thread', async () => {
    const { sdk, create } = stubSdk([{ type: 'text', text: 'hi' }], 'end_turn');
    await new AnthropicClient({ sdk }).respond(request());

    const params = create.mock.calls[0]![0] as unknown as { system: string; messages: unknown[] };
    expect(params.system).toContain('SYSTEM');
    expect(params.system).toContain('BRIEF');
    // The brief describes the world the tools act on — it is not something the
    // user said, so it must not appear as a user turn.
    expect(params.messages).toHaveLength(1);
  });

  it('replays a probe round as tool_use + matching tool_result ids, in one user message', async () => {
    const { sdk, create } = stubSdk([{ type: 'text', text: 'hi' }], 'end_turn');
    await new AnthropicClient({ sdk }).respond(
      request({
        messages: [
          { role: 'user', content: 'q' },
          { role: 'assistant', calls: [{ tool: 'inspect', id: 'a@1' }] },
          {
            role: 'tool',
            results: [{ tool: 'inspect', result: { ok: true, value: { kind: 'parameter' } } }],
          },
        ],
      }),
    );

    const params = create.mock.calls[0]![0] as unknown as { messages: Array<Record<string, never>> };
    expect(params.messages).toHaveLength(3);

    const assistant = params.messages[1] as unknown as {
      role: string;
      content: Array<{ type: string; id: string; name: string; input: unknown }>;
    };
    expect(assistant.role).toBe('assistant');
    expect(assistant.content[0]!.type).toBe('tool_use');
    expect(assistant.content[0]!.name).toBe('inspect');
    // The discriminant must not leak into the arguments.
    expect(assistant.content[0]!.input).toEqual({ id: 'a@1' });

    const toolMsg = params.messages[2] as unknown as {
      role: string;
      content: Array<{ type: string; tool_use_id: string; is_error: boolean }>;
    };
    expect(toolMsg.role).toBe('user'); // tool results ride a user turn
    // Splitting results across messages teaches the model to stop calling tools
    // in parallel — they must all sit in ONE message...
    expect(toolMsg.content).toHaveLength(1);
    // ...and reference the id the assistant turn used.
    expect(toolMsg.content[0]!.tool_use_id).toBe(assistant.content[0]!.id);
    expect(toolMsg.content[0]!.is_error).toBe(false);
  });

  it('marks a failed probe as an error result rather than dropping it', async () => {
    const { sdk, create } = stubSdk([{ type: 'text', text: 'hi' }], 'end_turn');
    await new AnthropicClient({ sdk }).respond(
      request({
        messages: [
          { role: 'user', content: 'q' },
          { role: 'assistant', calls: [{ tool: 'inspect', id: 'nope' }] },
          {
            role: 'tool',
            results: [
              { tool: 'inspect', result: { ok: false, error: { code: 'unknown-id', message: 'no' } } },
            ],
          },
        ],
      }),
    );
    const params = create.mock.calls[0]![0] as unknown as { messages: unknown[] };
    const toolMsg = params.messages[2] as { content: Array<{ is_error: boolean }> };
    expect(toolMsg.content[0]!.is_error).toBe(true);
  });
});

describe('response translation', () => {
  it('tool_use blocks become tool calls, with the discriminant restored', async () => {
    const { sdk } = stubSdk([
      { type: 'tool_use', id: 't1', name: 'evalAt', input: { id: 'f', args: [2] } },
    ]);
    const res = await new AnthropicClient({ sdk }).respond(request());
    expect(res).toEqual({
      kind: 'tool-calls',
      calls: [{ tool: 'evalAt', id: 'f', args: [2] }],
    });
  });

  it('a call to `answer` becomes the answer, carrying its declared evidence', async () => {
    const { sdk } = stubSdk([
      {
        type: 'tool_use',
        id: 't1',
        name: 'answer',
        input: { text: 'They agree at every sample.', evidence: 'sampled' },
      },
    ]);
    const res = await new AnthropicClient({ sdk }).respond(request());
    expect(res).toEqual({
      kind: 'answer',
      text: 'They agree at every sample.',
      evidence: 'sampled',
    });
  });

  it('an evidence value outside the closed enum is DROPPED, not passed through', async () => {
    // The no-CAS line made mechanical: a model must not be able to invent an
    // evidence type and have the UI render it as an earned verdict.
    const { sdk } = stubSdk([
      { type: 'tool_use', id: 't1', name: 'answer', input: { text: 'trust me', evidence: 'proof' } },
    ]);
    const res = await new AnthropicClient({ sdk }).respond(request());
    expect(res).toEqual({ kind: 'answer', text: 'trust me' });
    expect(res).not.toHaveProperty('evidence');
  });

  it('plain prose with no `answer` call is an answer with NO evidence', async () => {
    const { sdk } = stubSdk([{ type: 'text', text: 'I think so.' }], 'end_turn');
    const res = await new AnthropicClient({ sdk }).respond(request());
    expect(res).toEqual({ kind: 'answer', text: 'I think so.' });
  });

  it('a refusal is surfaced as an answer, not thrown', async () => {
    const { sdk } = stubSdk([], 'refusal');
    const res = await new AnthropicClient({ sdk }).respond(request());
    expect(res.kind).toBe('answer');
    if (res.kind === 'answer') expect(res.text).toMatch(/declined/i);
  });
});
