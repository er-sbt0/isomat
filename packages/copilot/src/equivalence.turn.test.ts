/**
 * equivalence.turn.test.ts — the canonical M5 interaction, end to end (roadmap
 * M5b: the flagship evidence flow).
 *
 * The whole loop against a real QuickJS-folded Workspace, driven by a
 * ScriptedClient — free, deterministic. This proves the roadmap's flagship
 * question, *"is d/dx of f equal to g?"*, all the way through:
 *
 *  - the model supplies its derivative candidate as TEXT (it is fallible — the
 *    test never differentiates symbolically; there is no CAS anywhere here);
 *  - the engine `plot`s that text into a live `fn`, then SAMPLES it against `g`
 *    with `numericEquivalence`;
 *  - the answer rests on `sampled` evidence, phrased as sampled agreement, never
 *    a proof — and `evidenceGrounded` confirms a probe actually sampled;
 *  - the load-bearing negative: a WRONG derivative is CAUGHT — the probe returns
 *    `equivalent: false` with a real `maxAbsDiff ≈ 1`, so the engine surfaces the
 *    model's error rather than laundering its opinion into a proof.
 *
 * ## The engine-minted plot id
 *
 * `plot`'s write mints `plot@<log.length>` (tools.ts) — an engine id the model
 * does not choose. The first `plot` in a turn runs against the START log (length
 * 1), so the candidate lands as `plot@1`, deterministic under re-fold. Each turn
 * here starts fresh from START, so the id is `plot@1` in both. Crucially, `plot`
 * and the following `numericEquivalence` are scripted as SEPARATE tool-call
 * batches: the loop re-folds the live scene only between iterations, so the
 * candidate is visible to the probe only on the batch after the one that wrote
 * it. A single combined batch would read a pre-commit scene and miss it.
 */

import { describe, expect, it } from 'vitest';
import { lint } from '@isomat/sandbox';
import { fold, tryFold } from '@isomat/workspace/node';
import type { WorkspaceLog } from '@isomat/workspace';
import { runTurn, ScriptedClient } from './index.js';
import type { CompileFragment, ModelMessage, ModelResponse, SceneMap, TurnDeps } from './index.js';

// f = x², g = 2·x — two live plotted fns with explicit ids. d/dx of f IS g, so a
// correct derivative candidate "2*x" agrees with g at every sample; a wrong one
// ("2*x + 1") is off by a constant 1. Native `plot` verbs, the turn.test.ts style.
const PROGRAM = [
  'plot((x) => x * x, { domain: [0, 4], label: "f", id: "f" });',
  'plot((x) => 2 * x, { domain: [0, 4], label: "g", id: "g" });',
].join('\n');

const compile: CompileFragment = (source) => {
  const gated = lint(source);
  return gated.ok
    ? { ok: true, js: source }
    : { ok: false, errors: gated.findings.map((f) => `${f.rule}: ${f.message}`) };
};

const deps: TurnDeps = { fold: tryFold, compile };

const START: WorkspaceLog = [{ kind: 'author', js: PROGRAM, source: PROGRAM, by: 'user', turn: 0 }];

// The engine mints the derivative candidate's id off the log position: the first
// `plot` in a turn runs against START (length 1) → `plot@1`.
const CANDIDATE_ID = 'plot@1';

const QUESTION = 'is d/dx of f equal to g?';

function idByLabel(scene: SceneMap, label: string, kind?: string): string {
  for (const h of scene.values()) {
    if ((h as { label?: unknown }).label === label && (kind === undefined || h.kind === kind)) return h.id;
  }
  throw new Error(`no object labeled "${label}"`);
}

async function ids() {
  const w = await fold(START);
  if (!w.ok) throw new Error('the start log did not fold');
  const scene = w.workspace.objects;
  return {
    f: idByLabel(scene, 'f', 'fn'),
    g: idByLabel(scene, 'g', 'fn'),
    scene,
  };
}

/**
 * The numericEquivalence result the model saw fed back, pulled from the request
 * thread the loop built — the surest proof the probe reached the "model". `null`
 * until a tool batch carrying that result appears in a request's messages.
 */
function equivResultInThread(messages: readonly ModelMessage[]): { equivalent: boolean; maxAbsDiff: number } | null {
  for (const m of messages) {
    if (m.role !== 'tool') continue;
    for (const r of m.results) {
      if (r.tool === 'numericEquivalence' && r.result.ok) {
        return r.result.value as unknown as { equivalent: boolean; maxAbsDiff: number };
      }
    }
  }
  return null;
}

describe('runTurn — "is d/dx of f equal to g?" → sampled evidence, never a proof', () => {
  it('correct derivative: the model plots "2*x", samples it against g, and answers sampled-grounded', async () => {
    const { g } = await ids();

    // the model reaches the probe result back through the thread; captured here to
    // prove the numericEquivalence outcome provably fed back before the answer
    let equivSeenByModel: { equivalent: boolean; maxAbsDiff: number } | null = null;
    const script: ModelResponse[] = [
      // batch 1: plot the (correct) derivative candidate as TEXT → a new live fn (plot@1)
      { kind: 'tool-calls', calls: [{ tool: 'plot', text: '2*x', domain: { from: 0, to: 4 } }] },
      // batch 2 (next iteration: the scene has re-folded so plot@1 is now live):
      // sample the candidate against g
      {
        kind: 'tool-calls',
        calls: [{ tool: 'numericEquivalence', idA: CANDIDATE_ID, idB: g, from: 0, to: 4, count: 21 }],
      },
      // batch 3: answer as SAMPLED AGREEMENT — not a proof
      {
        kind: 'answer',
        text: 'They match at every sampled point across [0, 4] (maxAbsDiff 0), so d/dx of f agrees with g by sampling — not a symbolic proof.',
        evidence: 'sampled',
      },
    ];
    const client = new ScriptedClient(script, {
      onRequest: (req) => {
        const seen = equivResultInThread(req.messages);
        if (seen) equivSeenByModel = seen;
      },
    });

    const out = await runTurn(START, QUESTION, client, deps);

    expect(out.kind).toBe('agentic');
    if (out.kind !== 'agentic') return;
    expect(out.modelCalls).toBe(3);

    // the answer rests on SAMPLED evidence, and a probe that actually sampled backs it
    expect(out.evidence).toBe('sampled');
    expect(out.evidenceGrounded).toBe(true);

    // the plot committed: the log advanced with the candidate's introduce act
    expect(out.log).toHaveLength(2);
    expect(out.log[1]).toMatchObject({ kind: 'introduce', id: CANDIDATE_ID, by: 'copilot' });

    // the numericEquivalence probe ran against the real engine and reported agreement
    const equivStep = out.steps.find((s) => s.call.tool === 'numericEquivalence')!;
    expect(equivStep.result.ok).toBe(true);
    if (equivStep.result.ok) {
      expect(equivStep.result.value).toMatchObject({ equivalent: true, maxAbsDiff: 0 });
    }

    // and that result provably fed back to the model before it answered
    expect(equivSeenByModel).not.toBeNull();
    expect(equivSeenByModel!.equivalent).toBe(true);
    expect(equivSeenByModel!.maxAbsDiff).toBe(0);
  });

  it('wrong derivative: the engine catches it — numericEquivalence reports not-equivalent, maxAbsDiff ≈ 1', async () => {
    const { g } = await ids();

    let equivSeenByModel: { equivalent: boolean; maxAbsDiff: number } | null = null;
    const script: ModelResponse[] = [
      // batch 1: plot a WRONG derivative candidate ("2*x + 1", off by a constant 1)
      { kind: 'tool-calls', calls: [{ tool: 'plot', text: '2*x + 1', domain: { from: 0, to: 4 } }] },
      // batch 2: sample it against g — the engine surfaces the mismatch
      {
        kind: 'tool-calls',
        calls: [{ tool: 'numericEquivalence', idA: CANDIDATE_ID, idB: g, from: 0, to: 4, count: 21 }],
      },
      // batch 3: the correct behavior — the model does NOT claim equivalence
      {
        kind: 'answer',
        text: 'No — the candidate is off by about 1 at every sampled point (maxAbsDiff ≈ 1), so d/dx of f does not equal g.',
        evidence: 'sampled',
      },
    ];
    const client = new ScriptedClient(script, {
      onRequest: (req) => {
        const seen = equivResultInThread(req.messages);
        if (seen) equivSeenByModel = seen;
      },
    });

    const out = await runTurn(START, QUESTION, client, deps);

    expect(out.kind).toBe('agentic');
    if (out.kind !== 'agentic') return;

    // the load-bearing negative: the SAMPLED probe contradicts equivalence
    const equivStep = out.steps.find((s) => s.call.tool === 'numericEquivalence')!;
    expect(equivStep.result.ok).toBe(true);
    if (equivStep.result.ok) {
      const v = equivStep.result.value as { equivalent: boolean; maxAbsDiff: number };
      expect(v.equivalent).toBe(false);
      expect(v.maxAbsDiff).toBeCloseTo(1, 12);
    }

    // the engine's finding — not the model's opinion — reached the model, and it is not-equivalent
    expect(equivSeenByModel).not.toBeNull();
    expect(equivSeenByModel!.equivalent).toBe(false);
    expect(equivSeenByModel!.maxAbsDiff).toBeCloseTo(1, 12);

    // the answer honestly rejects equivalence and is still sampled-grounded (a probe ran)
    expect(out.answer.toLowerCase()).toContain('not equal');
    expect(out.evidence).toBe('sampled');
    expect(out.evidenceGrounded).toBe(true);
  });
});
